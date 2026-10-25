import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest } from './sheetRest';
import { touchTap } from './touch';

/**
 * CARD-VIEW-1 (Ross 10-25, Fold8): "not every card view had zoom available nor an x to close card view". Every figure card
 * the collection opens, from the case and from the tiles: the full-screen viewer on the cover panels, the pane beside the
 * case or the tiles on the open ones. Each has a visible X that closes it, and a picture that zooms (a visible control).
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const OPEN = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open')!;

async function openCollection(page: Page, size: { width: number; height: number }, layout: 'case' | 'rows') {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto(`/?layout=${layout}`);
  await page.waitForSelector(layout === 'case' ? 'button.cab-figure' : 'button.jrows__item');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** Touch-tap a figure the case's frame shows whole, or the first tile. */
async function openFigure(page: Page, layout: 'case' | 'rows') {
  if (layout === 'rows') {
    const b = (await page.locator('button.jrows__item').first().boundingBox())!;
    await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
    return;
  }
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

for (const layout of ['case', 'rows'] as const) {
  test(`the viewer (cover panel), opened from the ${layout === 'case' ? 'case' : 'tiles'}: its X closes it, and its picture zooms by a visible control: ${COVER.name}`, async ({ page }) => {
    await openCollection(page, COVER, layout);
    await openFigure(page, layout);
    const viewer = page.locator('.pswp');
    await expect(viewer).toBeVisible();
    // zoom: PhotoSwipe's control, visible, and it zooms the picture (once the gallery has opened: a zoom in its opening is none)
    const zoom = page.locator('.pswp__button--zoom');
    await expect(zoom).toBeVisible();
    const current = page.locator('.pswp__item[aria-hidden="false"] img.pswp__img');
    await atRest(current);
    await atRest(page.locator('.figure-viewer-sheet'));
    await expect(viewer).toHaveClass(/pswp--zoom-allowed/);
    const whole = await box(current);
    await zoom.click();
    await expect.poll(async () => (await box(current)).width, { timeout: 5000 }).toBeGreaterThan(whole.width * 1.5);
    await expect(viewer).toHaveClass(/pswp--zoomed-in/);
    await zoom.click();
    await expect.poll(async () => Math.round((await box(current)).width), { timeout: 5000 }).toBe(Math.round(whole.width));
    // the X: visible, and it closes the card
    const x = page.getByRole('button', { name: 'Close', exact: true });
    await expect(x).toBeVisible();
    await x.tap();
    await expect(viewer).toHaveCount(0);
  });

  test(`the pane (open panel), opened from the ${layout === 'case' ? 'case' : 'tiles'}: its X closes it, and its picture zooms by a visible control and a double-tap: ${OPEN.name}`, async ({ page }) => {
    await openCollection(page, OPEN, layout);
    await openFigure(page, layout);
    const pane = page.locator('.detail-pane');
    await expect(pane).toBeVisible();
    const frame = pane.locator('.zoomable');
    await expect(frame).toHaveAttribute('data-zoomed', '0');
    // the picture's box is the one the bare <img> had: the pane's width, the picture's height at that width, at most 55 % of
    // the pane where the pane's height is set (the case; the tiles' pane grows with the page, as it did)
    await expect.poll(() => frame.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const natural = await frame.locator('img').evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
    const p = await box(pane);
    const f = await box(frame);
    const atWidth = (f.width * natural.h) / natural.w;
    expect(f.height).toBeCloseTo(layout === 'case' ? Math.min(atWidth, p.height * 0.55) : atWidth, 0);
    const img = await box(frame.locator('img'));
    expect(Math.abs(img.height - f.height), 'the picture fills its box: object-fit lays it whole inside').toBeLessThanOrEqual(1);
    expect(Math.abs(img.width - f.width)).toBeLessThanOrEqual(1);
    // the zoom control: visible, inside the picture, clear of the X
    const control = pane.getByRole('button', { name: 'Zoom in' });
    await expect(control).toBeVisible();
    const c = await box(control);
    expect(c.x >= f.x && c.x + c.width <= f.x + f.width && c.y >= f.y && c.y + c.height <= f.y + f.height).toBe(true);
    await control.tap();
    await expect(frame).toHaveAttribute('data-zoomed', '1');
    expect(await frame.locator('img').evaluate((el) => (el as HTMLElement).style.transform)).toMatch(/scale\(2\)/);
    await pane.getByRole('button', { name: 'Zoom out' }).tap();
    await expect(frame).toHaveAttribute('data-zoomed', '0');
    // a double-tap zooms too
    await page.waitForTimeout(350);
    const at = { x: f.x + f.width * 0.3, y: f.y + f.height * 0.4 };
    await touchTap(page, at.x, at.y);
    await page.waitForTimeout(80);
    await touchTap(page, at.x, at.y);
    await expect(frame).toHaveAttribute('data-zoomed', '1');
    // the X: visible, and it closes the card
    const x = pane.getByRole('button', { name: 'Close detail' });
    await expect(x).toBeVisible();
    await x.tap();
    await expect(pane).toHaveCount(0);
  });
}
