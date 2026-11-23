import { test, expect } from './fixtures';
import { E2E_SUB, seedSignedIn, stubOffMachine } from './signedIn';

/**
 * FCINV-MOBILE: Profile's account rows open the sign-in server's own pages in this tab, and the onboarding's Create
 * Account explains that accounts are by invitation instead of starting a sign-in that has no sign-up. Every request
 * that would leave the machine is answered by a stub (e2e/signedIn.ts), so the sign-in server is never reached.
 */

const IDP = 'https://auth.mindsignals1.com';
// Change Password runs fc's own flow (current password, a second factor, then the new one), never the user settings'
// password card (the stock flow, which asks for neither). Two-Factor opens the user settings' Credentials tab.
const ROWS = {
  'Change Password': `${IDP}/if/flow/fc-password-change/`,
  'Two-Factor Authentication': `${IDP}/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D`,
};
/** Long enough for a late read (a microtask, a timer) to have moved the rows if anything could. */
const SETTLE_MS = 1500;

test('Profile: Change Password opens fc-password-change and Two-Factor the user settings, in this tab', async ({ page, context }) => {
  const offMachine = await stubOffMachine(context);
  await seedSignedIn(page);
  await page.goto('/profile');
  await expect(page.getByText(`Account ${E2E_SUB.slice(0, 8)}`)).toBeVisible({ timeout: 15_000 });

  for (const [name, href] of Object.entries(ROWS)) {
    const row = page.getByRole('link', { name, exact: true });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href', href);
    await expect(row).not.toHaveAttribute('target', /.+/);
  }
  // The sign-in server's settings flow changes the name only, so the email row waits for a later unit.
  await expect(page.getByText(/change email/i)).toHaveCount(0);
  expect(offMachine, 'nothing left the machine before a row was chosen').toEqual([]);

  const pages = context.pages().length;
  await page.getByRole('link', { name: 'Change Password', exact: true }).click();
  await page.waitForURL(ROWS['Change Password']);
  expect(context.pages()).toHaveLength(pages);
  expect(offMachine).toEqual([ROWS['Change Password']]);
});

test('Profile: a hostile ?idp=, settings hash or stored host cannot move the account rows, even once settled', async ({ page, context }) => {
  const offMachine = await stubOffMachine(context);
  await seedSignedIn(page);
  await page.evaluate(() => {
    for (const store of [localStorage, sessionStorage]) {
      for (const key of ['fc.idp', 'idp', 'VITE_OIDC_ORIGIN']) store.setItem(key, 'https://evil.example');
    }
    window.name = 'https://evil.example';
  });
  const evilTab = encodeURIComponent(JSON.stringify({ page: 'page-sessions', next: 'https://evil.example/' }));
  await page.goto(`/profile?idp=https%253A%252F%252Fevil.example&next=%2F%5Cevil.example%2F#/settings;${evilTab}`);
  await expect(page.getByText(`Account ${E2E_SUB.slice(0, 8)}`)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(SETTLE_MS);
  const hrefs = await page.locator('a.profile__item').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(Object.values(ROWS));
  for (const href of hrefs) expect(href).not.toMatch(/next|evil|page-sessions/);
  expect(offMachine).toEqual([]);

  // The app's hostile query and hash must not ride along: the flow opens bare, with no next= and no hash.
  await page.getByRole('link', { name: 'Change Password', exact: true }).click();
  await page.waitForURL(ROWS['Change Password']);
  expect(page.url()).toBe(ROWS['Change Password']);
  expect(offMachine).toEqual([ROWS['Change Password']]);

  await page.goBack();
  await expect(page.getByText(`Account ${E2E_SUB.slice(0, 8)}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Two-Factor Authentication', exact: true }).click();
  await page.waitForURL(ROWS['Two-Factor Authentication']);
  expect(page.url()).toBe(ROWS['Two-Factor Authentication']);
  expect(offMachine).toEqual([ROWS['Change Password'], `${IDP}/if/user/`]);
});

test('Onboarding: Create Account says accounts are by invitation, starts nothing, and keeps Sign In', async ({ page, context }) => {
  const offMachine = await stubOffMachine(context);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Page 4' }).click();
  const create = page.getByRole('button', { name: 'Create Account', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(create).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#onboarding-invite')).toHaveText(
    'Accounts are by invitation. If you have an invitation link, open it to create your account.',
  );
  await expect(page.locator('#onboarding-invite')).toHaveAttribute('role', 'status');
  // Text in the DOM is not enough: the note must be seen (a display:none or off-screen note passes toHaveText).
  await expect(page.locator('#onboarding-invite')).toBeVisible();
  await expect(page.locator('#onboarding-invite')).toBeInViewport({ ratio: 0.99 });
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeInViewport({ ratio: 0.99 });
  await page.waitForTimeout(500);
  // toBeVisible counts opacity 0 as visible and reads no colour: the note and its ancestors must be painted, in a
  // colour that is not transparent.
  const paint = await page.locator('#onboarding-invite').evaluate((el) => {
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    const color = getComputedStyle(el).color;
    const channels = color.match(/[\d.]+%?/g) ?? [];
    // Alpha is the last number of rgba(...) or the one after "/" in the space-separated forms; otherwise opaque.
    const last = color.startsWith('rgba(') || color.includes('/') ? channels[channels.length - 1]! : '1';
    const alpha = last.endsWith('%') ? Number(last.slice(0, -1)) / 100 : Number(last);
    return { opacity, color, alpha };
  });
  expect(paint.opacity, JSON.stringify(paint)).toBeGreaterThan(0.9);
  expect(paint.alpha, JSON.stringify(paint)).toBeGreaterThan(0.9);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await page.evaluate(() => localStorage.getItem('onboarding_complete'))).toBeNull();
  expect(offMachine).toEqual([]);
});
