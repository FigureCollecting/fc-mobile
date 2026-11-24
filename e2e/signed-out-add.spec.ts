import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { seedSignedIn, stubOffMachine } from './signedIn';

/**
 * SIGNED-OUT-ADD (Ross, phone, 11-23): signed out, the collection showed the tab bar's raised + and looked like the page
 * before the nav rework. Adding figures needs an account: at phone width a visitor with none sees no Add control on any
 * screen, and the bar keeps its dock so no tab moves; signed in, the collection's Add is in its header as before. Every
 * request that would leave the machine is answered by a stub (e2e/signedIn.ts). SIGNED_OUT_ADD_SHOTS=<dir> saves a
 * screenshot of each screen, taken before the checks so a failing run still leaves its picture.
 */

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const SHOTS = process.env.SIGNED_OUT_ADD_SHOTS;
const addControls = (page: Page) => page.getByRole('button', { name: /add figures/i });

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  // The static splash (src/pwa/preSplash.ts) stands over the first page for about 3 s.
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const SCREENS = [
  { path: '/', ready: (p: Page) => p.getByText('Sign in to see your collection') },
  { path: '/discover', ready: (p: Page) => p.getByRole('button', { name: 'Search', exact: true }) },
  { path: '/stats', ready: (p: Page) => p.getByRole('button', { name: 'Stats', exact: true }) },
  { path: '/profile', ready: (p: Page) => p.getByRole('button', { name: 'Profile', exact: true }) },
  { path: '/settings', ready: (p: Page) => p.getByRole('navigation', { name: 'Main navigation' }) },
] as const;

test('signed out at 412 x 915: no Add control on the collection, Search, Stats, Profile or Settings; the dock stays', async ({ page, context }) => {
  test.setTimeout(120_000);
  await stubOffMachine(context);
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page.getByRole('status').filter({ hasText: /sign in to sync your collection/i })).toBeVisible({ timeout: 15_000 });
    await expect(screen.ready(page)).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, `signed-out${screen.path === '/' ? '-collection' : screen.path.replace('/', '-')}`);
    // Soft: every screen is checked (and pictured) whatever an earlier one showed.
    await expect.soft(addControls(page), screen.path).toHaveCount(0);
    await expect.soft(page.locator('.tab-bar__add, .header-add'), screen.path).toHaveCount(0);
    await expect.soft(page.locator('.tab-bar__dock'), screen.path).toHaveCount(1);
    for (const tab of ['Collection', 'Search', 'Stats', 'Profile']) {
      await expect.soft(page.getByRole('button', { name: tab, exact: true }), `${screen.path} ${tab}`).toBeVisible();
    }
  }
});

test('a fresh visitor on the onboarding sees no Add control', async ({ page, context }) => {
  await stubOffMachine(context);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(addControls(page)).toHaveCount(0);
});

/** The Add controls on screen, read in one go: the header's Add and the bar's raised +. */
const addState = (page: Page) =>
  page.evaluate(() => ({
    header: document.querySelectorAll('.slim-header__actions .header-add').length,
    bar: document.querySelectorAll('.tab-bar__add').length,
  }));

/** Pictures the screen in `state`, read the same before and after the picture (a screen that flips is pictured again). */
async function shotIn(page: Page, name: string, state: { header: number; bar: number }): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await expect.poll(() => addState(page), { timeout: 15_000 }).toEqual(state);
    await shot(page, name);
    if (JSON.stringify(await addState(page)) === JSON.stringify(state)) return;
  }
  throw new Error(`${name}: the screen never held ${JSON.stringify(state)} for a picture`);
}

test('signed in at 412 x 915: the collection has its header Add and no raised +; Stats has the raised +', async ({ page, context }) => {
  await stubOffMachine(context);
  await seedSignedIn(page);
  await page.goto('/');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  // With no server here the collection's read fails and is retried, so the page moves between its loading state (the
  // header Add) and its error state (no header Add, the raised + back), as it does before this change: picture the first.
  await shotIn(page, 'signed-in-collection', { header: 1, bar: 0 });
  await page.getByRole('button', { name: 'Stats', exact: true }).tap();
  await expect(page.locator('.tab-bar__add')).toHaveCount(1);
});

test('dev fixture mode (the demo collection, no account): the header Add and no raised +, as before', async ({ page, context }) => {
  await stubOffMachine(context);
  await page.addInitScript(() => localStorage.setItem('fc-fixture-mode', 'on'));
  await page.goto('/');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.cabinet-scene')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shotIn(page, 'fixture-collection', { header: 1, bar: 0 });
});
