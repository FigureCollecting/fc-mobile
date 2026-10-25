import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown, touchSwipe } from './touch';
import { watchPull } from './pullWatch';

/**
 * NAV-PTR-1 (Ross 10-25, his Fold8): "when dragging to pan/move to a higher vantage point, it would activate refresh".
 * A finger moving down on the case raises its camera (or slides its photo); the app's pull-to-refresh round the case
 * took the same drag as a pull. Fixture mode, the KLINGSBO wall, through Chromium's own touch pipeline (CDP touches),
 * at the Fold8's four panels. Chrome's own pull-to-refresh is the browser's, not the page's: headless Chromium has none,
 * so only the CSS that asks it off is checked here; the device shows the rest.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

async function openCase(page: Page, size: { width: number; height: number }, swipe: 'camera' | 'pan') {
  await page.addInitScript((mode) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', swipe: mode }));
  }, swipe);
  await page.setViewportSize(size);
  // a wall of several pages, so a sideways swipe walks
  await page.goto('/?layout=case&fx=40');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 800);
}

const sceneState = async (page: Page) => {
  const host = page.locator('.cabinet-scene');
  return {
    x: Number(await host.getAttribute('data-camera-x')),
    y: (JSON.parse((await host.getAttribute('data-camera'))!) as { y: number }).y,
    panY: Number(await host.getAttribute('data-pan-y')),
  };
};
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;

/**
 * A finger down at 20 % of the frame's height (`fromX` of its width), moved by (dx, dy) and lifted. While it is still
 * down: how tall the pull-to-refresh's indicator is, and how far the frame's top has moved.
 */
async function dragHeld(page: Page, fromX: number, dx: number, dy: number) {
  const f = await frameBox(page);
  const x = f.x + f.width * fromX;
  const y = f.y + f.height * 0.2;
  const finger = await touchDown(page, x, y);
  await finger.to(x + dx, y + dy, 8, 16);
  const indicatorPx = await page.locator('.pull-to-refresh__indicator').evaluate((e) => e.getBoundingClientRect().height);
  const frameMovedPx = (await frameBox(page)).y - f.y;
  await finger.end();
  await settle(page);
  return { indicatorPx, frameMovedPx };
}

async function expectNoPull(page: Page, seen: () => Promise<{ tallestPx: number; refreshed: boolean }>, held: { indicatorPx: number; frameMovedPx: number }) {
  expect(held.indicatorPx, 'nothing is pulled down over the case while the finger is down').toBe(0);
  expect(held.frameMovedPx, "the frame's top stays where it was").toBe(0);
  await expect(page.locator('.pull-to-refresh__spinner--active'), 'no refresh after the finger lifts').toHaveCount(0);
  expect(await seen(), 'no pull and no refresh at any moment of the drag').toEqual({ tallestPx: 0, refreshed: false });
}

for (const panel of FOLD8) {
  test(`NAV-PTR-1 ${panel.name}: a drag down in camera mode raises the camera and never pulls to refresh`, async ({ page }) => {
    await openCase(page, panel, 'camera');
    const before = await sceneState(page);
    const seen = await watchPull(page);
    const held = await dragHeld(page, 0.5, 0, (await frameBox(page)).height * 0.6);
    await expectNoPull(page, seen, held);
    expect((await sceneState(page)).y, 'the camera rose').toBeGreaterThan(before.y);
  });

  test(`NAV-PTR-1 ${panel.name}: a drag down in pan mode slides the photo and never pulls to refresh`, async ({ page }) => {
    await openCase(page, panel, 'pan');
    const before = await sceneState(page);
    const seen = await watchPull(page);
    const held = await dragHeld(page, 0.5, 0, (await frameBox(page)).height * 0.6);
    await expectNoPull(page, seen, held);
    expect((await sceneState(page)).panY, 'the photo slid').not.toBe(before.panY);
  });

  test(`NAV-PTR-1 ${panel.name}: a sideways walk that drifts 100 px down walks and never pulls to refresh`, async ({ page }) => {
    await openCase(page, panel, 'camera');
    const before = await sceneState(page);
    const seen = await watchPull(page);
    const held = await dragHeld(page, 0.8, -(await frameBox(page)).width * 0.6, 100);
    await expectNoPull(page, seen, held);
    expect((await sceneState(page)).x, 'the camera walked').not.toBe(before.x);
  });
}

// NAV-PTR-1 (Ross 10-25: "Reset view appears too easily (and/or too largely)"): a walk is navigation and shows none; a
// real raise of the camera shows a small button low at the right, in thumb reach (the misfit chip's mirror)
test('NAV-PTR-1 fold8-cover: a walk shows no Reset view; a 200 px raise shows a small one, low at the right', async ({ page }) => {
  await openCase(page, FOLD8.find((v) => v.name === 'fold8-cover')!, 'camera');
  const f = await frameBox(page);
  const x = (await sceneState(page)).x;
  await touchSwipe(page, f.x + f.width * 0.8, f.y + f.height * 0.5, -f.width * 0.6, 0);
  await settle(page);
  expect((await sceneState(page)).x, 'the camera walked').not.toBe(x);
  await expect(page.locator('.cabinet-scene__reset'), 'no Reset view after a walk').toHaveCount(0);
  await touchSwipe(page, f.x + f.width / 2, f.y + f.height * 0.2, 0, 200);
  await settle(page);
  const reset = page.locator('.cabinet-scene__reset');
  await expect(reset, 'Reset view after a raise').toHaveCount(1);
  const b = (await reset.boundingBox())!;
  const s = (await page.locator('.cabinet-scene').boundingBox())!;
  expect(b.width, 'small').toBeLessThanOrEqual(44);
  expect(b.height, 'small').toBeLessThanOrEqual(44);
  expect(b.y + b.height / 2, "in the scene's lower quarter").toBeGreaterThan(s.y + s.height * 0.75);
  expect(Math.abs(s.x + s.width - (b.x + b.width) - 24), "24 px in from the scene's right").toBeLessThanOrEqual(2);
});

// NAV-PTR-1 (Ross 10-25: "arrow movements weren't working"): a press on an arrow was also the scene's, so a thumb that
// travelled 8 px lifted the camera instead, and Chrome makes no click past its own tap slop; an arrow now steps on its pointerup
for (const panel of FOLD8) {
  test(`NAV-PTR-1 ${panel.name}: a tap on Next whose finger travels 10 px pages on once, and a tap on Previous comes back`, async ({ page }) => {
    await openCase(page, panel, 'camera');
    const next = page.locator('.cabinet-scene__step--next');
    await expect(next).toBeEnabled();
    const b = (await next.boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const before = await sceneState(page);
    const finger = await touchDown(page, at.x, at.y);
    await finger.to(at.x, at.y + 10, 4, 16);
    await finger.end();
    await settle(page);
    const after = await sceneState(page);
    expect(after.x, 'the page advanced').toBeGreaterThan(before.x);
    expect(after.y, 'the camera did not rise').toBe(before.y);
    // one step, not two: a plain tap on Previous is back where the wall opened
    await page.locator('.cabinet-scene__step--prev').tap();
    await settle(page);
    expect((await sceneState(page)).x, 'back at the first page').toBe(before.x);
  });

  // a walk started at the edge, on the arrow, leaves it as a drag: the scene's, as if it had started there
  test(`NAV-PTR-1 ${panel.name}: a swipe that starts on Next walks the wall as the same swipe on the scene does`, async ({ page }) => {
    await openCase(page, panel, 'camera');
    const f = await frameBox(page);
    const swipeFrom = async (x: number, y: number) => {
      const finger = await touchDown(page, x, y);
      await finger.to(x - f.width * 0.6, y, 8, 16);
      await finger.end();
      await settle(page);
      return sceneState(page);
    };
    const start = await sceneState(page);
    const b = (await page.locator('.cabinet-scene__step--next').boundingBox())!;
    const fromScene = await swipeFrom(b.x - 24, b.y + b.height / 2);
    expect(fromScene.x, 'a swipe on the scene walks').toBeGreaterThan(start.x);
    await page.reload();
    await page.waitForSelector('button.cab-figure');
    // the splash takes the touches until it goes
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
    await settle(page, 800);
    expect((await sceneState(page)).x).toBe(start.x);
    const fromArrow = await swipeFrom(b.x + b.width / 2, b.y + b.height / 2);
    expect(fromArrow, 'walked, as from the scene').toEqual(fromScene);
  });
}

test("NAV-PTR-1: the page asks the browser for no pull-to-refresh of its own (the CSS shipped; headless Chromium has no browser refresh to show)", async ({ page }) => {
  await openCase(page, FOLD8[0], 'camera');
  const css = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    // the -y longhand only: a desktop's horizontal swipe back stays the browser's
    htmlX: getComputedStyle(document.documentElement).overscrollBehaviorX,
    content: getComputedStyle(document.querySelector('.app-content')!).overscrollBehaviorY,
    pull: getComputedStyle(document.querySelector('.pull-to-refresh')!).overscrollBehaviorY,
  }));
  expect(css).toEqual({ html: 'none', htmlX: 'auto', content: 'contain', pull: 'contain' });
});
