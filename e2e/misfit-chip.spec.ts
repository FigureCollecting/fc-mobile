import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { CASE_VIEWPORTS } from './caseViewports';
import { touchDown, touchSwipe } from './touch';

/**
 * MISFIT-CHIP-1 (Ross 10-18): the "N figures do not fit" banner is a small chip (a warning glyph and the count), bottom
 * left, clear of the tab bar and the + button; it opens the list, which scrolls at the length Ross's collection has
 * (16); a dismiss on the list or a long press on the chip hides it until a figure that was not there misfits; the View
 * card's "Doesn't fit (N)" brings the list back whether or not the chip is hidden. Fixture mode, ?fxmisfit=16.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

async function openCase(page: Page, size: { width: number; height: number }, misfits = 16) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await pinLegacyCamera(page);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case&fx=2&fxmisfit=${misfits}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

const chip = (page: Page) => page.locator('.cabinet-scene__misfit');
const list = (page: Page) => page.locator('.cabinet-scene__fit');
const box = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const size of FOLD8) {
  test(`the chip is small, bottom left, inset from the edge, over none of the tab bar, the +, the arrows or the shelf steps: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await expect(page.locator('.cabinet-scene__fit')).toHaveCount(0);
    await expect(chip(page)).toHaveText('16');
    await expect(chip(page)).toHaveAttribute('aria-label', '16 figures do not fit');
    const c = await box(chip(page));
    const scene = await box(page.locator('.cabinet-scene'));
    expect(c.x - scene.x, 'inset from the left edge').toBeGreaterThanOrEqual(20);
    expect(c.height, 'small').toBeLessThanOrEqual(36);
    expect(c.width, 'small').toBeLessThanOrEqual(110);
    expect(c.y, 'in the lower half').toBeGreaterThan(scene.y + scene.height / 2);
    expect(c.y + c.height, 'inside the scene').toBeLessThanOrEqual(scene.y + scene.height);
    for (const other of ['.case-tabs', '.tab-bar', '.case-tabs__dock', '.cabinet-scene__step', '.cabinet-scene__reset', 'button[aria-label="Add figures"]']) {
      for (const el of await page.locator(other).all()) {
        const b = await el.boundingBox();
        if (b) expect(overlap(c, b), `the chip over ${other}`).toBe(false);
      }
    }
  });
}

test('a tap opens the list: 16 entries in a box that scrolls under a finger, never moving the case; a tap again closes it', async ({ page }) => {
  await openCase(page, FOLD8.find((v) => v.name === 'fold8-cover-sideways')!);
  await chip(page).tap();
  await expect(list(page)).toBeVisible();
  await expect(list(page).locator('li')).toHaveCount(16);
  const metrics = await list(page).evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }));
  expect(metrics.scroll, 'a long list on a short panel scrolls').toBeGreaterThan(metrics.client + 20);
  const scene = await box(page.locator('.cabinet-scene'));
  const l = await box(list(page));
  expect(l.y, 'short of the top of the scene').toBeGreaterThanOrEqual(scene.y);
  expect(l.y + l.height).toBeLessThanOrEqual(scene.y + scene.height);
  const camera = await page.locator('.cabinet-scene').getAttribute('data-camera');
  await touchSwipe(page, l.x + l.width / 2, l.y + l.height - 20, 0, -(l.height - 50));
  await page.waitForTimeout(150);
  const after = await list(page).evaluate((el) => el.scrollTop);
  expect(after, 'the finger scrolled the list').toBeGreaterThan(metrics.top + 20);
  expect(await page.locator('.cabinet-scene').getAttribute('data-camera'), 'and did not move the case').toBe(camera);
  // the last entry can be brought into view
  await list(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const last = await box(list(page).locator('li').last());
  const lb = await box(list(page));
  expect(last.y + last.height).toBeLessThanOrEqual(lb.y + lb.height + 1);
  await chip(page).tap();
  await expect(list(page)).toHaveCount(0);
});

test('× on the list hides the chip and closes the list; it stays hidden after a reload; the View card still brings the list back', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-open')!;
  await openCase(page, size);
  await chip(page).tap();
  await list(page).locator('.cabinet-scene__fit-dismiss').tap();
  await expect(list(page)).toHaveCount(0);
  await expect(chip(page)).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('button.cab-figure');
  await page.waitForTimeout(300);
  await expect(chip(page)).toHaveCount(0);
  // always recallable: the View card's entry opens the same list with the chip hidden
  await page.getByRole('button', { name: 'View' }).tap();
  await page.getByRole('button', { name: "Doesn't fit (16)" }).tap();
  await expect(list(page)).toBeVisible();
  await expect(list(page).locator('li')).toHaveCount(16);
  await expect(chip(page)).toHaveCount(0);
});

test('a figure that newly misfits brings the chip back with the new count', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-open')!;
  await openCase(page, size);
  await chip(page).tap();
  await list(page).locator('.cabinet-scene__fit-dismiss').tap();
  await expect(chip(page)).toHaveCount(0);
  await page.goto('/?layout=case&fx=2&fxmisfit=17');
  await page.waitForSelector('button.cab-figure');
  await expect(chip(page)).toHaveText('17');
  // one fewer than were dismissed: nothing new, hidden again
  await chip(page).tap();
  await list(page).locator('.cabinet-scene__fit-dismiss').tap();
  await page.goto('/?layout=case&fx=2&fxmisfit=15');
  await page.waitForSelector('button.cab-figure');
  await page.waitForTimeout(300);
  await expect(chip(page)).toHaveCount(0);
});

test('a long press on the chip hides it without opening the list', async ({ page }) => {
  await openCase(page, FOLD8.find((v) => v.name === 'fold8-cover')!);
  const c = await box(chip(page));
  const finger = await touchDown(page, c.x + c.width / 2, c.y + c.height / 2);
  await page.waitForTimeout(700);
  await finger.end();
  await expect(chip(page)).toHaveCount(0);
  await expect(list(page)).toHaveCount(0);
});
