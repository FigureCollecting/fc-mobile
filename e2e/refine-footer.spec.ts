import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest } from './sheetRest';
import { touchSwipe, touchTap } from './touch';

/**
 * REFINE-SHEET-1 (Ross 10-18, screenshot on his Fold8): the Refine card's footer (the Maker, Scale, Tags strip and
 * Clear, Done) is cut off at the bottom at its top detent. Whatever the window ends in, a gesture bar or Android's
 * 48 dp three-button bar (simulated as a bottom safe-area inset), the whole footer stands inside what is visible at
 * every detent, and Clear and Done take a tap.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

/**
 * The four Fold8 panels, and the installed app's cover window as Ross's screenshot shows it: 1248 x 1972 px at 2.8125,
 * less the 110 px status bar and the 136 px navigation bar the window stands between = 443 x 614 CSS px.
 */
const FOLD8 = [...CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8')), { name: 'cover-installed', width: 443, height: 614 }];
/** Android's three-button navigation bar, in CSS px (dp). */
const NAV_BAR_PX = 48;
/** Sub-pixel rounding of the boxes. */
const EPS = 0.5;

async function open(page: Page, size: { width: number; height: number }, bottomInset: number) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: bottomInset } });
  await page.goto('/?layout=case&fx=3');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

async function expectFooterVisible(page: Page, bottomInset: number, where: string) {
  const windowBottom = await page.evaluate(() => window.innerHeight);
  // the footer card as a whole, its own padding included, stands in the window and at its bottom edge
  const footer = (await page.locator('.detent-sheet__footer').boundingBox())!;
  expect.soft(footer.y, `${where}: the footer starts on screen (top ${footer.y})`).toBeGreaterThanOrEqual(-EPS);
  expect.soft(footer.y + footer.height, `${where}: the footer ends inside the window (bottom ${(footer.y + footer.height).toFixed(1)}, window ${windowBottom})`).toBeLessThanOrEqual(windowBottom + EPS);
  expect.soft(windowBottom - (footer.y + footer.height), `${where}: the footer stands at the window's bottom edge, not floating above it`).toBeLessThanOrEqual(1);
  // what it holds stands above the bottom bar, which takes the last `bottomInset` px (the footer's padding is that bar's room)
  for (const [label, selector] of [
    ['Maker, Scale, Tags', '.filter-sheet2__tabs'],
    ['Clear', '.filter-sheet2__btn--clear'],
    ['Done', '.filter-sheet2__btn--done'],
  ] as const) {
    const b = (await page.locator(selector).boundingBox())!;
    expect.soft(b.y + b.height, `${where}: ${label} ends above the bottom bar (bottom ${(b.y + b.height).toFixed(1)}, clear to ${windowBottom - bottomInset})`).toBeLessThanOrEqual(windowBottom - bottomInset + EPS);
  }
  // and a finger on Done and on Clear lands on them
  for (const selector of ['.filter-sheet2__btn--clear', '.filter-sheet2__btn--done']) {
    const b = (await page.locator(selector).boundingBox())!;
    const hit = await page.evaluate(([x, y, sel]) => document.elementFromPoint(x as number, y as number)?.closest(sel as string) !== null, [b.x + b.width / 2, b.y + b.height / 2, selector]);
    expect.soft(hit, `${where}: a tap at the centre of ${selector} reaches it`).toBe(true);
  }
}

for (const size of FOLD8) {
  for (const inset of [0, NAV_BAR_PX]) {
    test(`Refine's footer stands whole above a ${inset} px bottom bar at its half and its top detent: ${size.name}`, async ({ page }) => {
      await open(page, size, inset);
      await touchTap(page, ...(await centreOf(page, 'button[aria-label="Refine"], .case-tabs [data-tab="refine"]')));
      const sheet = page.locator('.detent-sheet');
      await expect(sheet).toBeVisible();
      await atRest(sheet);
      await expect(sheet).toHaveAttribute('data-detent', 'half');
      await expectFooterVisible(page, inset, `half detent, ${size.name}, bar ${inset}`);

      // up to the top detent: the handle, dragged well past the half the card opens on
      const handle = (await page.locator('.detent-sheet__handle-area').boundingBox())!;
      await touchSwipe(page, handle.x + handle.width / 2, handle.y + handle.height / 2, 0, -Math.round(size.height * 0.6), 10, 16);
      await atRest(sheet);
      await expect(sheet).toHaveAttribute('data-detent', 'full');
      await expectFooterVisible(page, inset, `top detent, ${size.name}, bar ${inset}`);
    });
  }
}

async function centreOf(page: Page, selector: string): Promise<[number, number]> {
  const b = (await page.locator(selector).first().boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
}
