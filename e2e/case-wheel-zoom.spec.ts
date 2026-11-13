import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * NAV-DESKTOP-ZOOM (Ross 11-13: "Pinch zoom is just that... no desktop equiv yet"): on a desktop the mouse wheel is the
 * pinch, the same magnification, at the cursor; the page never scrolls under it, and it settles once the wheel stops.
 * Shift+wheel is kept for depth (a later unit): it zooms nothing. A desktop Chromium with a mouse, a fresh device (Free
 * camera, the default), the fixture collection.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

async function openCase(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.goto('/?layout=case&fx=40');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 400);
}

type Zoom = { k: number; x: number; y: number };
const zoomOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!) as Zoom;
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;
const scrolled = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('.cabinet-scene')!;
    return [window.scrollX, window.scrollY, host.scrollLeft, host.scrollTop, document.scrollingElement?.scrollTop ?? 0];
  });

test('the mouse wheel zooms in at the cursor, the page never scrolling; it settles where it is once the wheel stops', async ({ page }, testInfo) => {
  await openCase(page);
  const f = await frameBox(page);
  // the cursor off the frame's centre: the zoom is at the cursor, not the middle
  const at = { x: f.width * 0.35, y: f.height * 0.4 };
  await page.mouse.move(f.x + at.x, f.y + at.y);
  await settle(page);
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
  const camera = await page.locator('.cabinet-scene').getAttribute('data-camera');
  const before = await scrolled(page);
  await page.screenshot({ path: testInfo.outputPath('wheel-zoom-before.png') });

  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await zoomOf(page)).k).toBeGreaterThan(1);
  const z = await zoomOf(page);
  // the picture's point under the cursor is still under it (data-zoom is rounded to the 1000th)
  expect(Math.abs(at.x * z.k + z.x - at.x)).toBeLessThan(0.5);
  expect(Math.abs(at.y * z.k + z.y - at.y)).toBeLessThan(0.5);
  expect(await scrolled(page)).toEqual(before);
  // the zoom is a layer over the camera's picture: the camera never moved
  expect(await page.locator('.cabinet-scene').getAttribute('data-camera')).toBe(camera);

  // let go: the layer is no longer live and the zoom stays (well over the snap back to 1x)
  await settle(page, 400);
  await expect(page.locator('.cabinet-scene__zoom')).not.toHaveClass(/cabinet-scene__zoom--live/);
  expect((await zoomOf(page)).k).toBeCloseTo(z.k, 3);
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('wheel-zoom-after.png') });

  // and back out: a turn toward the user past 1x settles at exactly 1x
  await page.mouse.wheel(0, 600);
  await settle(page, 600);
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
  expect(await scrolled(page)).toEqual(before);
});

test('Shift+wheel is kept for depth: it zooms nothing', async ({ page }) => {
  await openCase(page);
  const f = await frameBox(page);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Shift');
  await settle(page);
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
});
