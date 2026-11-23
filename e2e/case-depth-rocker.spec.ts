import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchFingers } from './touch';
import { centreOf, depth, hat } from './navControls';
import { DEPTH_FULL_PX } from '../src/components/display/caseDepth';
import { JOG_FULL_PX, JOG_MAX_STEP_MS } from '../src/components/display/casePose';

/**
 * NAV-DEPTH-3 (Ross 11-13), in Chromium at the Fold8's open and cover panels, fixture mode, through Chromium's own touch
 * pipeline (CDP touches): the depth control moves the eye toward the wall (data-camera z falls) and away (z rises), never
 * sideways (x kept); the lift stops it; held with the hat, both move. NAV-FLOAT (handoff FINAL 11-17): it is the floating
 * Z rail, lower-left, vertical only (the View card's horizontal slider is retired, and its test with it).
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const PANELS = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-open' || v.name === 'fold8-cover');

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

/** `ms` and as many frames as a drive counts in `ms` (a loaded runner's frames come far apart): see case-free-camera's jogHold. */
const hold = (page: Page, ms: number) =>
  page.evaluate(
    ({ ms, frames }) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        let n = 0;
        const onFrame = () => (++n >= frames && performance.now() - t0 >= ms ? resolve() : void requestAnimationFrame(onFrame));
        requestAnimationFrame(onFrame);
      }),
    { ms, frames: Math.ceil(ms / JOG_MAX_STEP_MS) },
  );

/** The case in Free camera (the default) at `size`; the prefs are seeded once a tab, so a reload keeps what the page saved. */
async function openFree(page: Page, size: { width: number; height: number }, query = '/?layout=case&fx=40') {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0 }));
  });
  await page.setViewportSize(size);
  await page.goto(query);
  await ready(page);
}

async function ready(page: Page) {
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await settle(page, 500);
}

type Cam = { x: number; y: number; z: number; yaw: number; pitch: number };
const cameraOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Cam;
const rocker = depth;

// NAV-DOLLY (Ross 11-22: "I hit the rack and stop... cannot move closer"): on the Fold8's cover, a dense wall of
// KLINGSBOs and the eye below the framing's height, the walk in passed the GPU ceiling some 450 mm short of the doors
// (the open mesh shelves alone cost 1.7 viewports there) and the Z rail stopped. The scene now coarsens to fit (its mesh
// shelves first), so the rail takes the eye to the shelves' margin.
for (const lowerMm of [0, 200]) {
  test(`NAV-DOLLY fold8-cover, a dense wall, the eye ${lowerMm} mm below the framing's height: the Z rail at full reach takes the eye to the shelves' margin`, async ({ page }) => {
    test.setTimeout(90_000);
    const cover = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
    await openFree(page, cover, '/?layout=case&fx=170&fxbranch=framed&fxwidth=narrow&labels=1');
    const scene = page.locator('.cabinet-scene');
    const f = await touchFingers(page);
    const c0 = await cameraOf(page);
    if (lowerMm > 0) {
      // the hat, thumb down, until the eye is that much lower
      const h = await centreOf(hat(page));
      await f.down(1, h.x, h.y);
      await f.to(1, h.x, h.y + JOG_FULL_PX / 2, 6);
      await expect.poll(async () => (await cameraOf(page)).y, { intervals: [50], timeout: 20_000 }).toBeLessThanOrEqual(c0.y - lowerMm);
      await f.up(1);
      await settle(page);
    }
    const boxes = JSON.parse((await scene.getAttribute('data-wall'))!) as number[][];
    // the fronts' margin: 100 mm (EYE_MARGIN_MM) off the cabinets' feet
    const margin = Math.max(...boxes.map((b) => b[4])) + 100;
    const at = await centreOf(rocker(page));
    await f.down(2, at.x, at.y);
    await f.to(2, at.x, at.y - DEPTH_FULL_PX, 6);
    await expect.poll(async () => (await cameraOf(page)).z, { intervals: [100], timeout: 30_000 }).toBeLessThanOrEqual(margin + 1);
    await hold(page, 300);
    await expect(scene, 'the furniture, not the budget, holds it').toHaveAttribute('data-dolly-held', 'room');
    await f.up(2);
    await settle(page, 500);
    const c1 = await cameraOf(page);
    expect(c1.z).toBeGreaterThanOrEqual(margin);
    expect(c1.z).toBeLessThanOrEqual(margin + 1);
    // close in, the mesh shelves are drawn coarser than the figures' scene, never the other way
    const [s, mesh] = [Number(await scene.getAttribute('data-px-per-mm')), Number(await scene.getAttribute('data-mesh-px-per-mm'))];
    expect(mesh).toBeLessThanOrEqual(s);
  });
}

for (const panel of PANELS) {
  test(`NAV-DEPTH-3 ${panel.name}: the Z rail left of the hat: up moves closer, down backs away, x kept; the lift stops it`, async ({ page }) => {
    await openFree(page, panel);
    await expect(rocker(page)).toHaveAttribute('aria-orientation', 'vertical');
    // left of the hat, clear of it, a thumb's target (>= 44 px) and taller than wide
    const r = (await rocker(page).boundingBox())!;
    const h = (await hat(page).boundingBox())!;
    expect(r.x + r.width).toBeLessThan(h.x);
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThan(r.width);

    const at = await centreOf(rocker(page));
    const c0 = await cameraOf(page);
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 600);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    await expect(rocker(page)).toHaveAttribute('data-rocking', '');
    const c1 = await cameraOf(page);
    expect(c1.z, 'up: closer').toBeLessThan(c0.z - 20);
    expect([c1.x, c1.y, c1.yaw, c1.pitch], 'only the depth moved').toEqual([c0.x, c0.y, c0.yaw, c0.pitch]);

    await f.to(1, at.x, at.y + DEPTH_FULL_PX, 6);
    await hold(page, 600);
    const c2 = await cameraOf(page);
    expect(c2.z, 'down: back').toBeGreaterThan(c1.z + 20);
    expect(c2.x).toBe(c0.x);

    await f.up(1);
    await settle(page);
    const c3 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page), 'stopped at the lift').toEqual(c3);
    expect(await page.locator('.cabinet-scene').getAttribute('data-gesture')).toBeNull();
    expect(await rocker(page).getAttribute('data-rocking')).toBeNull();
  });

  test(`NAV-DEPTH-3 ${panel.name}: the rocker and the hat held together: x and z both move; each lift stops its own`, async ({ page }) => {
    await openFree(page, panel);
    const hatAt = await centreOf(hat(page));
    const at = await centreOf(rocker(page));
    const c0 = await cameraOf(page);
    const f = await touchFingers(page);
    await f.down(1, hatAt.x, hatAt.y);
    await f.to(1, hatAt.x + JOG_FULL_PX, hatAt.y, 6);
    await f.down(2, at.x, at.y);
    await f.to(2, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 800);
    const c1 = await cameraOf(page);
    expect(c1.x, 'the hat: right').toBeGreaterThan(c0.x + 20);
    expect(c1.z, 'the rocker: closer').toBeLessThan(c0.z - 20);
    // the hat's lift: the depth goes on alone
    await f.up(1);
    await settle(page, 100);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    const c2 = await cameraOf(page);
    await hold(page, 400);
    const c3 = await cameraOf(page);
    expect(c3.x, 'the hat stopped').toBe(c2.x);
    expect(c3.z, 'the depth runs on').toBeLessThan(c2.z);
    await f.up(2);
    await settle(page);
    const c4 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page)).toEqual(c4);
  });

  // chal1 S1: the drive starts from rest the back way too (down), from a pose close enough to back away
  {
    test(`NAV-DEPTH-3 ${panel.name}: from rest the first push back backs away: z rises, x kept`, async ({ page }) => {
      await openFree(page, panel);
      const at = await centreOf(rocker(page));
      const closer = { x: at.x, y: at.y - DEPTH_FULL_PX };
      const back = { x: at.x, y: at.y + DEPTH_FULL_PX };
      const f = await touchFingers(page);
      await f.down(1, at.x, at.y);
      await f.to(1, closer.x, closer.y, 6);
      await hold(page, 500);
      await f.up(1);
      await settle(page);
      const c0 = await cameraOf(page);
      await f.down(2, at.x, at.y);
      await f.to(2, back.x, back.y, 6);
      await hold(page, 500);
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
      const c1 = await cameraOf(page);
      expect(c1.z, 'back from rest: farther').toBeGreaterThan(c0.z + 20);
      expect(c1.x).toBe(c0.x);
      await f.up(2);
    });
  }

  // chal1 NOTE-1 (ruled a fix): the capture released mid-push and the finger lifted off the rocker: no lift reaches it, so
  // the lost capture springs it back and stops the drive
  test(`NAV-DEPTH-3 ${panel.name}: the capture lost mid-push stops the drive; the lift elsewhere leaves nothing moving`, async ({ page }) => {
    await openFree(page, panel);
    await page.evaluate(() => {
      const w = window as unknown as { __rockerPid?: number };
      document.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest?.('[data-nav="depth"]')) w.__rockerPid = e.pointerId;
      }, true);
    });
    const at = await centreOf(rocker(page));
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 200);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    await page.evaluate(() => document.querySelector('[data-nav="depth"]')!.releasePointerCapture((window as unknown as { __rockerPid: number }).__rockerPid));
    await f.to(1, at.x + 200, at.y - 150, 6);
    await f.up(1);
    await settle(page, 200);
    const a = await cameraOf(page);
    await hold(page, 800);
    expect(await cameraOf(page), 'nothing moving after the lift').toEqual(a);
    expect(await page.locator('.cabinet-scene').getAttribute('data-gesture')).toBeNull();
    expect(await rocker(page).getAttribute('data-rocking')).toBeNull();
  });
}
