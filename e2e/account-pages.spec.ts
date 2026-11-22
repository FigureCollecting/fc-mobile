import { test, expect } from './fixtures';
import { E2E_SUB, seedSignedIn, stubOffMachine } from './signedIn';

/**
 * FCINV-MOBILE: Profile's account rows open the sign-in server's own pages in this tab, and the onboarding's Create
 * Account explains that accounts are by invitation instead of starting a sign-in that has no sign-up. Every request
 * that would leave the machine is answered by a stub (e2e/signedIn.ts), so the sign-in server is never reached.
 */

const IDP = 'https://auth.mindsignals1.com';

test('Profile: Change Password, Change Email and Two-Factor open the sign-in server in this tab', async ({ page, context }) => {
  const offMachine = await stubOffMachine(context);
  await seedSignedIn(page);
  await page.goto('/profile');
  await expect(page.getByText(`Account ${E2E_SUB.slice(0, 8)}`)).toBeVisible({ timeout: 15_000 });

  const rows = {
    'Change Password': `${IDP}/if/flow/fc-password-change/`,
    'Change Email': `${IDP}/if/flow/fc-email-change/`,
    'Two-Factor Authentication': `${IDP}/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D`,
  };
  for (const [name, href] of Object.entries(rows)) {
    const row = page.getByRole('link', { name, exact: true });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href', href);
    await expect(row).not.toHaveAttribute('target', /.+/);
  }
  expect(offMachine, 'nothing left the machine before a row was chosen').toEqual([]);

  const pages = context.pages().length;
  await page.getByRole('link', { name: 'Change Password', exact: true }).click();
  await page.waitForURL(rows['Change Password']);
  expect(context.pages()).toHaveLength(pages);
  expect(offMachine).toEqual([rows['Change Password']]);
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
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeInViewport({ ratio: 0.99 });
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await page.evaluate(() => localStorage.getItem('onboarding_complete'))).toBeNull();
  expect(offMachine).toEqual([]);
});
