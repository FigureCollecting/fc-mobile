import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest } from './sheetRest';
import { touchTap } from './touch';
import { FACE_ANCHOR, anchorOffset, faceZoom } from '../src/components/display/imageZoom';

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

// CARD-VIEW-1 part 2 (Ross 10-25: "rather than start by zooming to the pic's middle, should favor zooming card view towards 1/3 from
// top and midpoint horizontally of image"): the zoom control's first step, read off the zoomed picture's transform
test(`the viewer's zoom control zooms in on the face: half across and a third down the picture, in the middle of its room: ${COVER.name}`, async ({ page }) => {
  await openCollection(page, COVER, 'case');
  await openFigure(page, 'case');
  const current = page.locator('.pswp__item[aria-hidden="false"] img.pswp__img');
  await atRest(current);
  await atRest(page.locator('.figure-viewer-sheet'));
  // the whole picture stands in the middle of its room (the viewport less the sheet below and the rail at the right, from the top-left)
  const whole = await box(current);
  const room = { width: 2 * whole.x + whole.width, height: 2 * whole.y + whole.height };
  await page.locator('.pswp__button--zoom').click();
  await atRest(current);
  const zoomed = await box(current);
  expect(zoomed.width / whole.width, 'one step: the secondary level').toBeGreaterThan(1.5);
  const at = anchorOffset(room, { width: zoomed.width, height: zoomed.height });
  expect(Math.abs(zoomed.x - at.x), `left ${zoomed.x.toFixed(1)}, the face anchor puts it at ${at.x.toFixed(1)}`).toBeLessThanOrEqual(2);
  expect(Math.abs(zoomed.y - at.y), `top ${zoomed.y.toFixed(1)}, the face anchor puts it at ${at.y.toFixed(1)}`).toBeLessThanOrEqual(2);
  // a portrait figure zoomed past its room's height: its third down, not its middle, is what stands in the room's middle
  if (zoomed.height > room.height && at.y < 0 && at.y > room.height - zoomed.height) {
    expect(Math.abs(zoomed.y + zoomed.height * FACE_ANCHOR.y - room.height / 2)).toBeLessThanOrEqual(2);
  }
});

test(`the pane's zoom control zooms in on the face; its transform is the face anchor's: ${OPEN.name}`, async ({ page }) => {
  await openCollection(page, OPEN, 'case');
  await openFigure(page, 'case');
  const frame = page.locator('.detail-pane .zoomable');
  const img = frame.locator('img');
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const natural = await img.evaluate((el) => ({ width: (el as HTMLImageElement).naturalWidth, height: (el as HTMLImageElement).naturalHeight }));
  const f = await box(frame);
  await page.locator('.detail-pane').getByRole('button', { name: 'Zoom in' }).tap();
  await expect(frame).toHaveAttribute('data-zoomed', '1');
  const expected = faceZoom({ width: f.width, height: f.height }, natural, 2);
  const z = JSON.parse((await frame.getAttribute('data-zoom'))!) as { k: number; x: number; y: number };
  expect(z.k).toBe(2);
  expect(z.x).toBeCloseTo(expected.x, 0);
  expect(z.y).toBeCloseTo(expected.y, 0);
  // matrix(k, 0, 0, k, x, y), once its 200 ms glide is over
  const matrix = async () => (await img.evaluate((el) => getComputedStyle(el).transform)).match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number) ?? [1];
  await expect.poll(async () => (await matrix())[0], { timeout: 3000 }).toBeCloseTo(2, 3);
  const m = await matrix();
  expect(m[0]).toBeCloseTo(2, 3);
  expect(m[4]).toBeCloseTo(expected.x, 0);
  expect(m[5]).toBeCloseTo(expected.y, 0);
});
