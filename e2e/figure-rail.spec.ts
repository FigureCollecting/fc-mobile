import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { touchTap } from './touch';

/**
 * SIDE-RAIL-1 (Ross 10-17, 10-18): the figure (Info) card's sections stand on a RIGHT-side rail (a banner at the top steals
 * taps), 24 px in from the screen edge so the back-swipe never fires, stacked icon over a short label. In the full-screen
 * viewer (cover panels) it rides the sheet's top edge; in the Fold-open pane (open panels) it stands at the pane's edge.
 * The photo and the text keep to its left; the viewer's prev/next arrows never meet it. At the Fold8's four panels.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const DUAL_PANE_MIN_WIDTH = 640;
const INSET = 24;

async function openCase(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

async function openFigure(page: Page) {
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = page.locator('button.cab-figure');
  for (let i = 0; i < (await figures.count()); i++) {
    const b = await figures.nth(i).boundingBox();
    if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) {
      await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
      return;
    }
  }
  throw new Error('no figure stands whole in the frame');
}

const box = async (l: Locator) => (await l.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every rule the rail answers to, as numbers off the page: where it is, how its buttons are built. */
async function checkRail(page: Page, size: { width: number; height: number }, rail: Locator) {
  const r = await box(rail);
  expect(size.width - (r.x + r.width), 'the rail stands 24 px in from the right edge').toBeGreaterThanOrEqual(INSET - 1);
  expect(size.width - (r.x + r.width)).toBeLessThanOrEqual(INSET + 1);
  expect(r.y, 'on the screen').toBeGreaterThanOrEqual(0);
  expect(r.y + r.height).toBeLessThanOrEqual(size.height);
  const buttons = rail.getByRole('button');
  await expect(buttons).toHaveText(['Details', 'Photos', 'Copies']);
  for (let i = 0; i < 3; i++) {
    const b = buttons.nth(i);
    const icon = await box(b.locator('svg'));
    const label = await box(b.locator('.side-rail__label'));
    expect(label.y, 'the label is under the icon, stacked').toBeGreaterThanOrEqual(icon.y + icon.height - 1);
    expect(await b.locator('.side-rail__label').evaluate((el) => getComputedStyle(el).writingMode), 'never sideways text').toBe('horizontal-tb');
    const bb = await box(b);
    expect(bb.height, 'a thumb\'s height').toBeGreaterThanOrEqual(44);
  }
}

for (const size of FOLD8) {
  test(`the figure card's sections stand on a right rail, 24 px in, stacked icon over label: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await openFigure(page);
    if (size.width < DUAL_PANE_MIN_WIDTH) {
      const sheet = page.locator('.figure-viewer-sheet');
      await expect(sheet).toBeVisible();
      const rail = sheet.locator('.side-rail');
      await expect(rail).toBeVisible();
      await expect.poll(async () => (await box(sheet)).y, { timeout: 8000 }).toBeLessThan(size.height - 20);
      // at rest on the summary
      await page.waitForTimeout(700);
      await checkRail(page, size, rail);
      const r = await box(rail);
      expect(r.y + r.height, 'above the sheet').toBeLessThanOrEqual((await box(sheet)).y + 1);
      // the photo keeps to its left
      const img = page.locator('.pswp__item[aria-hidden="false"] img.pswp__img');
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const photo = await box(img);
      expect(photo.x + photo.width, 'the photo stands left of the rail').toBeLessThanOrEqual(r.x - 4);
      // the prev/next arrows (shown by a tap on the picture) never meet the rail
      await touchTap(page, photo.x + photo.width / 2, photo.y + photo.height / 2);
      for (const arrow of ['prev', 'next']) {
        const a = page.locator(`.pswp__button--arrow--${arrow}`);
        if ((await a.count()) === 0) continue;
        expect(overlap(await box(a), r), `the ${arrow} arrow clear of the rail`).toBe(false);
      }
      // Details takes the sheet up and the rail rides it, still on the screen; again, it comes back down
      await rail.getByRole('button', { name: 'Details' }).tap();
      await expect(sheet).toHaveAttribute('data-detent', 'all');
      await page.waitForTimeout(700);
      const up = await box(rail);
      expect(up.y, 'the rail is not pushed off the top').toBeGreaterThanOrEqual(0);
      expect(up.y + up.height).toBeLessThanOrEqual((await box(sheet)).y + 1);
      await rail.getByRole('button', { name: 'Details' }).tap();
      await expect(sheet).toHaveAttribute('data-detent', 'summary');
    } else {
      const pane = page.locator('.detail-pane');
      await expect(pane).toBeVisible();
      const rail = pane.locator('.side-rail');
      await expect(rail).toBeVisible();
      await checkRail(page, size, rail);
      const r = await box(rail);
      // the pane's picture and text keep to its left
      const content = await box(pane.locator('.detail-pane__content'));
      expect(content.x + content.width, 'the text stands left of the rail').toBeLessThanOrEqual(r.x - 4);
      const image = pane.locator('.detail-pane__image');
      if ((await image.count()) > 0) expect((await box(image)).x + (await box(image)).width).toBeLessThanOrEqual(r.x - 4);
      // the close button is not under it
      expect(overlap(await box(pane.getByRole('button', { name: 'Close detail' })), r)).toBe(false);
    }
  });
}
