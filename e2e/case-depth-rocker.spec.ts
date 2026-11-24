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
async function openFree(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0 }));
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=40');
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

  // LOD-HOLD (Ross 11-22): the rail held still after an approach draws the figures as sharp as its lift does, before the
  // lift. The longest frame around that rest render and around the lift's render are recorded (annotations), not gated
  test(`LOD-HOLD ${panel.name}: held still after an approach, the figures are as sharp as the lift draws them`, async ({ page }, testInfo) => {
    await openFree(page, panel);
    const sharpest = () =>
      page.evaluate(() => Math.max(...Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => Number(b.style.getPropertyValue('--s')))));
    // every frame's time from here on, to find the longest around each render
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      w.__frames = [];
      const on = (t: number) => {
        w.__frames.push(t);
        requestAnimationFrame(on);
      };
      requestAnimationFrame(on);
    });
    const now = () => page.evaluate(() => performance.now());
    const longest = (t0: number, t1: number) =>
      page.evaluate(
        ([a, b]) => {
          const f = (window as unknown as { __frames: number[] }).__frames.filter((t) => t >= a && t <= b);
          return Math.max(...f.slice(1).map((t, i) => t - f[i]));
        },
        [t0, t1],
      );
    const far = await sharpest();
    const at = await centreOf(rocker(page));
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 600);
    // back to the centre, still held: the eye rests
    await f.to(1, at.x, at.y, 6);
    const rested = await now();
    await hold(page, 800);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    const held = await sharpest();
    const restMs = await longest(rested, rested + 800);
    expect(held, 'sharper at rest, before the lift').toBeGreaterThan(far);
    // still held: nothing more is drawn (no figure restyled, no camera written), so no render loop at rest
    const redrawn = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const scene = document.querySelector('.cabinet-scene')!;
          const o = new MutationObserver((records) => {
            n += records.filter((r) => r.attributeName === 'data-camera' || (r.target as Element).matches('button.cab-figure')).length;
          });
          o.observe(scene, { attributes: true, subtree: true, attributeFilter: ['style', 'data-camera'] });
          setTimeout(() => {
            o.disconnect();
            resolve(n);
          }, 1000);
        }),
    );
    expect(redrawn, 'nothing redrawn while held still').toBe(0);
    await f.up(1);
    const lifted = await now();
    await hold(page, 800);
    expect(await sharpest(), 'the lift draws them no sharper').toBe(held);
    const liftMs = await longest(lifted, lifted + 800);
    const measured = JSON.stringify({ panel: panel.name, far, held, restLongestFrameMs: restMs, liftLongestFrameMs: liftMs });
    testInfo.annotations.push({ type: 'lod-hold', description: measured });
    console.log(`lod-hold ${measured}`);
  });

  // LOD-STEP (Ross 11-24): on a long approach the figures sharpen on the way in, before the rail rests; the room's faces
  // keep their px per mm till the rest render (a step-up re-rasters the figures only)
  test(`LOD-STEP ${panel.name}: a long approach sharpens the figures while the eye still closes in`, async ({ page }) => {
    await openFree(page, panel);
    // every frame: the eye's z, the sharpest figure's px per mm and the room's
    await page.evaluate(() => {
      const w = window as unknown as { __seen: { z: number; figures: number; room: number }[] };
      w.__seen = [];
      const scene = document.querySelector<HTMLElement>('.cabinet-scene')!;
      const root = document.querySelector<HTMLElement>('.cabinet-scene__root')!;
      const on = () => {
        const figures = Math.max(...Array.from(scene.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => Number(b.style.getPropertyValue('--s'))));
        w.__seen.push({ z: JSON.parse(scene.dataset.camera!).z, figures, room: Number(root.style.getPropertyValue('--s')) });
        requestAnimationFrame(on);
      };
      requestAnimationFrame(on);
    });
    const at = await centreOf(rocker(page));
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x, at.y - DEPTH_FULL_PX / 2, 6);
    // a loaded runner's long frames move the eye less a frame (JOG_MAX_STEP_MS): held till the figures are sharper, then
    // on a little (the near stop is far past where they first need 1.5x)
    await page.waitForFunction(() => {
      const seen = (window as unknown as { __seen: { figures: number }[] }).__seen;
      return seen.some((s) => s.figures >= 1.5 * seen[0].figures);
    }, undefined, { timeout: 20_000 });
    await hold(page, 400);
    await f.up(1);
    const seen = await page.evaluate(() => (window as unknown as { __seen: { z: number; figures: number; room: number }[] }).__seen);
    const { figures: far, room } = seen[0];
    const stepped = seen.findIndex((s) => s.figures >= 1.5 * far && s.room === room);
    expect(stepped, 'sharper figures, the room as it was').toBeGreaterThan(0);
    expect(Math.min(...seen.slice(stepped + 1).map((s) => s.z)), 'the eye still closing in').toBeLessThan(seen[stepped].z);
  });

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
