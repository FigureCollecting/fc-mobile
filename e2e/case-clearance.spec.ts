import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * CLEAR-1 (Ross 10-18): every compartment keeps a clearance above a figure, 1 in to begin with, set in the View card with
 * the room's ceiling (0 to 2 in in quarter inches), kept on the device. It decides what stands in a stock compartment and
 * what needs a shelf out: with less of it, fewer shelves come out. Fixture mode, the KLINGSBO wall.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

async function openCase(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=8');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

/** The shelves taken out across the wall, as the scene publishes them. */
const removed = async (page: Page) => {
  const held = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-held'))!) as [number, number, number[]][];
  return held.reduce((n, h) => n + h[2].length, 0);
};

for (const size of FOLD8) {
  test(`the View card sets the clearance: 1 in to begin with, more of it takes more shelves out, kept after a reload: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await page.getByRole('button', { name: 'View' }).tap();
    const input = page.getByRole('spinbutton', { name: /clearance above a figure/i });
    await expect(input).toHaveValue('1');
    await expect(input).toHaveAttribute('min', '0');
    await expect(input).toHaveAttribute('max', '2');
    await expect(input).toHaveAttribute('step', '0.25');
    const atInch = await removed(page);
    await input.fill('2');
    await expect.poll(() => removed(page), 'with 2 in, more shelves come out for the fixture figures').toBeGreaterThan(atInch);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).clearanceMm).toBe(50.8);
    await input.fill('0.25');
    await expect(input).toHaveValue('0.25');
    await expect.poll(() => removed(page)).toBeLessThanOrEqual(atInch);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).clearanceMm).toBeCloseTo(6.35, 6);
    // out of range or blank: ignored, the last good value stays
    await input.fill('3');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).clearanceMm).toBeCloseTo(6.35, 6);
    await input.fill('2');
    const big = await removed(page);
    await page.reload();
    await page.waitForSelector('button.cab-figure');
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(300);
    expect(await removed(page)).toBe(big);
    await page.getByRole('button', { name: 'View' }).tap();
    await expect(page.getByRole('spinbutton', { name: /clearance above a figure/i })).toHaveValue('2');
  });
}
