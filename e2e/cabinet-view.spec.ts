import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest, takesTap } from './sheetRest';
import { goToFirstFigure } from './goTo';
import { touchPinch } from './touch';
import { project, type Camera } from '../src/components/display/caseCamera';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';
import { surfaceSlots, wallLayout } from '../src/components/display/packCabinets';
import { cabinetBox } from '../src/components/display/caseFraming';
import { boxCorners } from '../src/components/display/caseCamera';
import { ALPHA_READS_AT_ONCE, ALPHA_READ_DEADLINE_MS, ALPHA_READ_TURN_MS } from '../src/components/display/alphaMargin';

/**
 * The faithful cabinets in a real browser (CASE-FIX, CASE-CABINET,
 * CASE-ADAPT): a tap on a figure opens it and a tap on the cabinet opens
 * nothing; the browser draws each figure exactly where the camera maths
 * puts it, standing on its surface; the wall packs without overlap; the CC4
 * swipe walks the camera or pans the picture; the IC1 tabs
 * sit above the raised +. Fixture mode on the committed synthetic art.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

// NAV-SCOPE (Ross 11-18): the case has one view, the wall's; no view is stored. The camera the one-shelf view stood is Go
// to's (goToFirstFigure); the one-cabinet view's went with it
interface Prefs {
  pattern?: string;
}

/** Open the case and settle it: every figure, or every one but those named `stalled` (whose pictures are held back). */
async function openCase(page: Page, size: { width: number; height: number }, query = '', prefs: Prefs = {}, stalled?: RegExp) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize(size);
  // NAV-GRAD: Look arms after a 1 s hold here, so on a loaded host a drag whose first move comes late still walks
  await page.goto(`/?layout=case&lookhold=1000${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await settle(page, stalled);
}

/**
 * Every picture decoded and every figure grounded (its transparent margin
 * measured), but those named `stalled`: the rest within 3 s, never waiting
 * on them.
 */
async function settle(page: Page, stalled?: RegExp) {
  await page.waitForFunction(
    (skip) =>
      Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'))
        .filter((b) => !(skip && new RegExp(skip).test(b.getAttribute('aria-label')!)))
        .every((b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0)),
    stalled?.source,
    stalled ? { timeout: 3_000 } : undefined,
  );
}

interface World {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
  surface: number;
}

async function cameraOf(page: Page): Promise<Camera> {
  const c = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!);
  return { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
}

/** Each figure's on-screen box (CSS px, relative to the scene) and the box the camera maths predicts for it. */
async function drawnVsPredicted(page: Page) {
  const camera = await cameraOf(page);
  const pan = 0;
  // the frame the picture is drawn in (CASE-FB1: centred in the scene, cropped narrower on a wide panel)
  const scene = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const figures = await page.locator('button.cab-figure').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label')!, world: (el as HTMLElement).dataset.world!, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  return figures.map((f) => {
    const w = JSON.parse(f.world) as World;
    const corners = [project(camera, [w.x0, w.y0, w.z]), project(camera, [w.x1, w.y0, w.z]), project(camera, [w.x0, w.y1, w.z]), project(camera, [w.x1, w.y1, w.z])];
    return {
      name: f.name,
      world: w,
      drawn: { left: f.left - scene.x, right: f.right - scene.x, top: f.top - scene.y, bottom: f.bottom - scene.y },
      predicted: {
        left: Math.min(...corners.map((c) => c.x)) + pan,
        right: Math.max(...corners.map((c) => c.x)) + pan,
        top: Math.min(...corners.map((c) => c.y)),
        bottom: Math.max(...corners.map((c) => c.y)),
      },
    };
  });
}

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

for (const size of CASE_VIEWPORTS) {
  test(`a tap on a figure opens it, a tap on the cabinet opens nothing: ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    await openCase(page, size, '');
    const figure = page.locator('button.cab-figure').nth(2);
    const name = await figure.getAttribute('aria-label');
    // the cabinet itself, between two shelves, away from every figure: nothing opens
    const scene = (await page.locator('.cabinet-scene').boundingBox())!;
    await page.touchscreen.tap(scene.x + 6, scene.y + scene.height - 6);
    await page.waitForTimeout(250);
    await expect(page.locator('.pswp, .detail-pane')).toHaveCount(0);

    await figure.tap();
    const dual = size.width >= 640;
    const opened = page.locator(dual ? '.detail-pane' : '.pswp');
    await expect(opened).toBeVisible();
    await expect(page.locator(dual ? '.detail-pane' : '.figure-viewer-sheet')).toContainText(name!);
  });
}

for (const size of FOLD8) {
  for (const view of ['wall', 'go to'] as const) {
    test(`the browser draws every figure where the camera maths puts it: ${view}, ${size.name}`, async ({ page }) => {
      await openCase(page, size, '');
      if (view === 'go to') await goToFirstFigure(page);
      const rows = await drawnVsPredicted(page);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          expect(Math.abs(r.drawn[edge] - r.predicted[edge]), `${r.name} ${edge}`).toBeLessThan(1.5);
        }
      }
    });
  }
}

/** The lowest scene y (CSS px) of what the wall frames: the focus cabinet's front feet. */
async function framedBottomPx(page: Page): Promise<number> {
  const camera = await cameraOf(page);
  const host = page.locator('.cabinet-scene');
  const focus = Number(await host.getAttribute('data-focus'));
  const slot = wallLayout(Array.from({ length: focus + 1 }, () => IKEA_KLINGSBO)).cabinets[focus];
  const b = cabinetBox(slot, 0);
  return Math.max(...boxCorners(b.x0, b.x1, 0, 0, b.z0, b.z1).map((c) => project(camera, c).y));
}

/**
 * NAV-SCOPE: the wall is the case's one view, so the above-the-tabs family below runs on it alone (the one-cabinet and
 * one-shelf views' cases, and their Shelf below steps, went with those views).
 */
type View = 'wall';

/** Open the case at the wall. */
async function openFramed(page: Page, size: { width: number; height: number }, _view: View) {
  await openCase(page, size, '&fx=3');
}

/** The scene runs from wherever the layout above it ends down to 4 px above the pull-up tabs, never under them. */
async function expectSceneAboveTabs(page: Page, label: string) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const tabsTop = Math.min(
    (await page.locator('.case-tabs').boundingBox())!.y,
    ...(await page.locator('.case-tabs [data-tab]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))),
  );
  const sceneBottom = scene.y + scene.height;
  expect(sceneBottom, `${label}: the scene ends 4 px above the tabs`).toBeLessThanOrEqual(tabsTop - 3);
  expect(sceneBottom, `${label}: the scene reaches down to the tabs`).toBeGreaterThanOrEqual(tabsTop - 6);
  return { scene, tabsTop, sceneBottom };
}

/**
 * The scene runs from wherever the layout above it ends down to 4 px above
 * the pull-up tabs, never under them, and the camera frames the cabinet
 * (its feet, or the shelf's edge) inside it.
 */
async function expectFramedAboveTabs(page: Page, _view: View, label: string) {
  const { scene, tabsTop, sceneBottom } = await expectSceneAboveTabs(page, label);
  const bottom = scene.y + (await framedBottomPx(page));
  expect(bottom, `${label}: framed inside the scene`).toBeLessThanOrEqual(sceneBottom);
  expect(bottom, `${label}: framed above the tabs`).toBeLessThanOrEqual(tabsTop);
}

/**
 * The filter sheet at rest, up at its detent: unmoved for ten frames. A
 * press while it still springs up stops it where it is (framer-motion's
 * drag), and two still frames can be the top of its overshoot.
 */
async function expectSheetAtRest(page: Page) {
  await expect
    .poll(() =>
      page.locator('.detent-sheet').evaluate(
        (el) =>
          new Promise<boolean>((done) => {
            const top = el.getBoundingClientRect().top;
            let frames = 0;
            const step = () => {
              if (Math.abs(el.getBoundingClientRect().top - top) > 0.01) return done(false);
              if (++frames < 10) requestAnimationFrame(step);
              else done(top < innerHeight * 0.9);
            };
            requestAnimationFrame(step);
          }),
      ),
    )
    .toBe(true);
}

/** expectFramedAboveTabs once the scene and its camera have followed a change of layout. */
async function expectReframedAboveTabs(page: Page, view: View, label: string) {
  await expect(async () => expectFramedAboveTabs(page, view, label)).toPass({ timeout: 5_000 });
}

/** The eye's pose: x, y, z, yaw and pitch (spec 6.6 keeps these through a fold; the frame and the lens's px follow it). */
async function eyeOf(page: Page) {
  const c = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!);
  return { pose: [c.x, c.y, c.z, c.yaw, c.pitch] as number[], frame: { width: c.width, height: c.height } };
}

type Eye = Awaited<ReturnType<typeof eyeOf>>;

/** The eye once it stands still: the same pose read twice, longer than a spring (200 ms) apart. */
async function steadyEye(page: Page): Promise<Eye> {
  let eye = await eyeOf(page);
  await expect(async () => {
    await page.waitForTimeout(250);
    const again = await eyeOf(page);
    const same = JSON.stringify(again) === JSON.stringify(eye);
    eye = again;
    expect(same, 'the eye stands still').toBe(true);
  }).toPass({ timeout: 5_000 });
  return eye;
}

// Spec 6.6, by design: a fold, a banner or a turn of the phone keeps the eye's pose (CabinetScene's frame-change hold;
// also CabinetSceneFreeCamera.test.tsx and case-free-camera.spec.ts). Where the new frame is shorter than the old one,
// the cabinet therefore stays at the old frame's framing and its feet end below the scene. The combination below asserts
// that: the pose unchanged and the miss below the scene's bottom as measured (CSS px). It turns red if a frame change ever
// re-fits the eye (NAV-SCOPE: the cabinet and shelf views' six combinations went with those views).
const KEPT_POSE_MISS_PX = new Map([['turn: wall, fold8-cover to fold8-cover-sideways', 71.457]]);
// identical to 1e-6 px in every run so far; the +-0.5 px band absorbs sub-pixel layout, float rounding and a 1 px layout
// change (the lens follows the frame size, so the miss moves about 0.4 px) and fails from 2 px; a re-fit moves the miss
// 12 px or more
const KEPT_POSE_MISS_TOLERANCE_PX = 0.5;

/** After a change of the frame: the scene above the tabs, the pose as `before`, the framed bottom `missPx` below the scene. */
async function expectPoseKeptAboveTabs(page: Page, _view: View, label: string, before: Eye, missPx: number) {
  await expect(async () => {
    const { scene, sceneBottom } = await expectSceneAboveTabs(page, label);
    const now = await eyeOf(page);
    expect(now.frame, `${label}: the frame changed`).not.toEqual(before.frame);
    expect(now.pose, `${label}: the pose kept (spec 6.6)`).toEqual(before.pose);
    const miss = scene.y + (await framedBottomPx(page)) - sceneBottom;
    expect(miss, `${label}: the framed bottom below the scene`).toBeGreaterThanOrEqual(missPx - KEPT_POSE_MISS_TOLERANCE_PX);
    expect(miss, `${label}: the framed bottom below the scene`).toBeLessThanOrEqual(missPx + KEPT_POSE_MISS_TOLERANCE_PX);
  }).toPass({ timeout: 5_000 });
}

// NAV-SCOPE (plan section 9): Reset view is zoom-only and never moves the camera, so NAV-RESET-FRAME's test (Reset view
// after a turn of the phone stands the eye at the new frame's framing, marked test.fail) has no case left: deleted.

for (const size of FOLD8) {
  for (const view of ['wall'] as const) {
    test(`the whole framed cabinet stands above the pull-up tabs and the tab bar: ${view}, ${size.name}`, async ({ page }) => {
      await openFramed(page, size, view);
      await expectFramedAboveTabs(page, view, 'at load');
    });

    const offlineKey = `offline: ${view}, ${size.name}`;
    const offlineWhat = KEPT_POSE_MISS_PX.has(offlineKey) ? 'the pose is kept above the tabs (spec 6.6)' : 'the scene is re-fitted above the tabs';
    test(`${offlineWhat} when the phone goes offline and the banner pushes the page down: ${view}, ${size.name}`, async ({ page, context }) => {
      const kept = KEPT_POSE_MISS_PX.get(offlineKey);
      await openFramed(page, size, view);
      await expectFramedAboveTabs(page, view, 'online');
      const online = await steadyEye(page);
      await context.setOffline(true);
      await expect(page.locator('.offline-banner')).toBeVisible();
      // spec 6.6: under the banner's shorter frame the eye keeps the taller one's pose
      if (kept === undefined) await expectReframedAboveTabs(page, view, 'offline');
      else await expectPoseKeptAboveTabs(page, view, 'offline', online, kept);
      await context.setOffline(false);
      await expect(page.locator('.offline-banner')).toHaveCount(0);
      await expectReframedAboveTabs(page, view, 'back online');
      if (kept !== undefined) expect((await eyeOf(page)).pose, 'back online: the pose kept').toEqual(online.pose);
    });

    test(`still above the tabs when the chips row comes and goes above the scene: ${view}, ${size.name}`, async ({ page }) => {
      await openFramed(page, size, view);
      // clear the default chips: the scene grows up into their row
      while ((await page.locator('.applied-chips__chip').count()) > 0) await page.locator('.applied-chips__chip').first().click();
      await expectReframedAboveTabs(page, view, 'chips cleared');
      // come back later with no chips, then add a filter: its chip row pushes the scene down
      await page.reload();
      await page.waitForSelector('button.cab-figure');
      await expect(page.locator('.applied-chips')).toHaveCount(0);
      await expectFramedAboveTabs(page, view, 'reloaded without chips');
      await page.getByRole('button', { name: 'Refine' }).click();
      await expectSheetAtRest(page);
      // Refine applies at once (SHEETS-FB1); Done closes it, and the filter row it brought stays
      await page.getByRole('group', { name: 'Holding' }).getByRole('button', { name: /^Owned/ }).click();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.locator('.applied-chips')).toHaveCount(1);
      await expectReframedAboveTabs(page, view, 'a chip added');
    });
  }
}

// NAV-SCOPE: close-out 3 (ruling 27) and close-out 4 (ruling 32), the mixed wall paged by Next and Prev, went with the
// step keys; a walk standing every cabinet of the mixed wall whole is CabinetScene.test.tsx's

// the open Fold8 shows a tapped figure in a pane beside the case: the case column must still end above the tabs
for (const size of FOLD8.filter((v) => v.name === 'fold8-open' || v.name === 'fold8-open-rotated')) {
  test(`still above the tabs with the detail pane open, then offline: ${size.name}`, async ({ page, context }) => {
    await openFramed(page, size, 'wall');
    await page.locator('button.cab-figure').nth(1).tap();
    await expect(page.locator('.detail-pane')).toBeVisible();
    await expectReframedAboveTabs(page, 'wall', 'detail pane open');
    await context.setOffline(true);
    await expect(page.locator('.offline-banner')).toBeVisible();
    await expectReframedAboveTabs(page, 'wall', 'detail pane open, offline');
  });
}

for (const [from, to] of [
  ['fold8-cover', 'fold8-cover-sideways'],
  ['fold8-open', 'fold8-open-rotated'],
] as const) {
  for (const view of ['wall'] as const) {
    const turnKey = `turn: ${view}, ${from} to ${to}`;
    const turnWhat = KEPT_POSE_MISS_PX.has(turnKey) ? 'keeps the pose above the tabs (spec 6.6)' : 're-fits the scene above the tabs';
    test(`turning the phone with the case open ${turnWhat}: ${view}, ${from} to ${to}`, async ({ page }) => {
      const kept = KEPT_POSE_MISS_PX.get(turnKey);
      await openFramed(page, FOLD8.find((v) => v.name === from)!, view);
      const upright = await steadyEye(page);
      await page.setViewportSize(FOLD8.find((v) => v.name === to)!);
      // spec 6.6: turned sideways the eye keeps the upright cover's pose (the feet far below the scene)
      if (kept === undefined) await expectReframedAboveTabs(page, view, to);
      else await expectPoseKeptAboveTabs(page, view, to, upright, kept);
    });
  }
}

/**
 * Every figure as drawn now: what it shows on screen (relative to the
 * scene), its picture or, while that picture is read, its plate; its world
 * boxes; and the clear fractions of its picture's alpha on each side of the
 * figure, measured here with a canvas on the picture itself (the mask, for
 * masked art), independent of the app's own measurement. A framed copy or a
 * plate is an opaque box: no clear margins. A picture that has not arrived
 * draws nothing.
 */
async function drawnFigures(page: Page) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const rows = await page.locator('button.cab-figure').evaluateAll(async (els) => {
    const out: { name: string; kind: string; world: string; art: string; left: number; width: number; top: number; height: number; clear: { above: number; below: number; left: number; right: number } }[] = [];
    for (const b of els as HTMLElement[]) {
      const box = b.querySelector<HTMLElement>('.cab-figure__box')!;
      const el = Array.from(box.children).find((c) => getComputedStyle(c).visibility !== 'hidden') as HTMLElement | undefined;
      if (!el || (el instanceof HTMLImageElement && !(el.complete && el.naturalWidth > 0))) continue;
      const kind = el.classList.contains('cab-figure__plate') ? 'plate' : b.dataset.art!;
      const clear = { above: 0, below: 0, left: 0, right: 0 };
      if (kind === 'cutout' || kind === 'masked') {
        const img = new Image();
        img.src = el.dataset.maskUrl ?? (el as HTMLImageElement).src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width;
        let x1 = -1;
        let y0 = c.height;
        let y1 = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] <= 10) continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
        Object.assign(clear, { above: y0 / c.height, below: (c.height - 1 - y1) / c.height, left: x0 / c.width, right: (c.width - 1 - x1) / c.width });
      }
      const r = el.getBoundingClientRect();
      out.push({ name: b.getAttribute('aria-label')!, kind, world: b.dataset.world!, art: b.dataset.artBox!, left: r.left, width: r.width, top: r.top, height: r.height, clear });
    }
    return out;
  });
  return rows.map((r) => {
    const art = JSON.parse(r.art) as World;
    const w = art.x1 - art.x0;
    // where the figure itself is drawn along the wall, mm: its opaque columns
    const opaque = { x0: art.x0 + r.clear.left * w, x1: art.x1 - r.clear.right * w };
    return { ...r, left: r.left - scene.x, top: r.top - scene.y, world: JSON.parse(r.world) as World, art, opaque, clearAbove: r.clear.above, clearBelow: r.clear.below };
  });
}

/** The cut-out and masked figures (drawnFigures): pictures that carry their own clear margins. */
async function pictureAlpha(page: Page) {
  return (await drawnFigures(page)).filter((r) => r.kind === 'cutout' || r.kind === 'masked');
}

/**
 * Neighbours on one surface (all cabinets of the wall, one row per surface
 * height and depth), left to right: none reaches over the next, by its tap
 * box (data-world) or by what it draws (its opaque columns); and no figure
 * draws past its surface's usable width into the cabinet's side panel (the
 * default wall: KLINGSBOs).
 */
async function expectNoOverlap(page: Page, label: string) {
  const { tapOverlaps, drawnOverlaps, intoPanels, pairs } = overlapsOf(await drawnFigures(page));
  expect.soft(tapOverlaps, `${label}: tap boxes overlap`).toEqual([]);
  expect.soft(drawnOverlaps, `${label}: drawn neighbours overlap`).toEqual([]);
  expect.soft(intoPanels, `${label}: drawn into the side panel`).toEqual([]);
  expect(pairs, label).toBeGreaterThan(0);
}

/** What expectNoOverlap checks, on figures as drawn (their tap boxes and opaque columns), on a wall of `cabinets` KLINGSBOs at most. */
function overlapsOf(rows: { name: string; kind: string; world: World; opaque: { x0: number; x1: number } }[], cabinets = rows.length) {
  const wall = wallLayout(Array.from({ length: cabinets }, () => IKEA_KLINGSBO)).cabinets;
  const slots = surfaceSlots(IKEA_KLINGSBO);
  const mm = (v: number) => v.toFixed(1);
  const intoPanels: string[] = [];
  for (const r of rows) {
    const cx = (r.world.x0 + r.world.x1) / 2;
    const cabinet = wall.find((c) => cx >= c.leftMm && cx <= c.rightMm)!;
    const slot = slots.find((s) => Math.abs(s.topMm - r.world.surface) < 0.01)!;
    const [lo, hi] = [cabinet.centerMm - slot.widthMm / 2, cabinet.centerMm + slot.widthMm / 2];
    if (r.opaque.x0 < lo - 0.01 || r.opaque.x1 > hi + 0.01) intoPanels.push(`${r.kind} ${r.name} drawn [${mm(r.opaque.x0)}..${mm(r.opaque.x1)}], its surface [${mm(lo)}..${mm(hi)}]`);
  }
  const rowsOf = new Map<string, typeof rows>();
  for (const r of rows) rowsOf.set(`${r.world.surface}:${r.world.z}`, [...(rowsOf.get(`${r.world.surface}:${r.world.z}`) ?? []), r]);
  let pairs = 0;
  const tapOverlaps: string[] = [];
  const drawnOverlaps: string[] = [];
  for (const row of rowsOf.values()) {
    row.sort((a, b) => a.world.x0 - b.world.x0);
    for (let i = 1; i < row.length; i++) {
      pairs++;
      const [a, b] = [row[i - 1], row[i]];
      if (b.world.x0 < a.world.x1 - 1e-6) tapOverlaps.push(`${a.name} / ${b.name}: ${mm(a.world.x1 - b.world.x0)} mm`);
      if (b.opaque.x0 < a.opaque.x1 - 0.01) drawnOverlaps.push(`${a.kind} ${a.name} [${mm(a.opaque.x0)}..${mm(a.opaque.x1)}] / ${b.kind} ${b.name} [${mm(b.opaque.x0)}..${mm(b.opaque.x1)}]: ${mm(a.opaque.x1 - b.opaque.x0)} mm`);
    }
  }
  return { tapOverlaps, drawnOverlaps, intoPanels, pairs };
}

for (const branch of ['cut-out', 'masked'] as const) {
  for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
    test(`true scale, ${branch}: the drawn figure (its opaque rows) is exactly its labelled height, feet on the surface: Go to's shelf framing, ${size.name}`, async ({ page }) => {
      await openCase(page, size, branch === 'masked' ? '&fxbranch=masked' : '');
      await goToFirstFigure(page);
      const camera = await cameraOf(page);
      // the shelf framing looks level: a figure facing the camera is drawn without foreshortening
      expect(camera.pitch).toBe(0);
      const rows = await pictureAlpha(page);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const cx = (r.world.x0 + r.world.x1) / 2;
        const feet = project(camera, [cx, r.world.surface, r.world.z]).y;
        const head = project(camera, [cx, r.world.y1, r.world.z]).y;
        // the box under test: a labelled height, standing on the surface
        expect(r.world.y0).toBeCloseTo(r.world.surface, 6);
        const drawnHead = r.top + r.clearAbove * r.height;
        const drawnFeet = r.top + (1 - r.clearBelow) * r.height;
        expect(Math.abs(drawnFeet - feet), `${r.name} feet`).toBeLessThan(1.5);
        expect(Math.abs(drawnHead - head), `${r.name} head: drawn ${(drawnFeet - drawnHead).toFixed(1)} px for ${(feet - head).toFixed(1)} px`).toBeLessThan(1.5);
      }
    });
  }

  // the committed art and the off-centre art (?fxasym=1), whose pictures are moved so the figures stand centred
  for (const asym of ['', '&fxasym=1'] as const) {
    // (NAV-SCOPE: the one-cabinet view this stood in is gone; the wall's framing stands its camera farther back)
    test(`true scale, ${branch}${asym ? ', off-centre art' : ''}: the wall draws each picture where its world box is, the figure in it its labelled height`, async ({ page }) => {
      await openCase(page, FOLD8[0], `${branch === 'masked' ? '&fxbranch=masked' : ''}${asym}`);
      const camera = await cameraOf(page);
      for (const r of await pictureAlpha(page)) {
        const pictureH = r.art.y1 - r.art.y0;
        // in the world: the opaque rows of the picture run from the surface to the labelled height above it
        expect(Math.abs(r.art.y0 + r.clearBelow * pictureH - r.world.surface), `${r.name} feet, mm`).toBeLessThan(0.5);
        expect(Math.abs(r.art.y1 - r.clearAbove * pictureH - r.world.y1), `${r.name} head, mm`).toBeLessThan(0.5);
        // and the browser draws the picture exactly over that world box
        const cx = (r.art.x0 + r.art.x1) / 2;
        const top = project(camera, [cx, r.art.y1, r.art.z]).y;
        const bottom = project(camera, [cx, r.art.y0, r.art.z]).y;
        expect(Math.abs(r.top - top), `${r.name} picture top`).toBeLessThan(1.5);
        expect(Math.abs(r.top + r.height - bottom), `${r.name} picture bottom`).toBeLessThan(1.5);
        // and along the wall: its corners where the camera puts the art box's
        const xs = [r.art.x0, r.art.x1].flatMap((x) => [r.art.y0, r.art.y1].map((y) => project(camera, [x, y, r.art.z]).x));
        expect(Math.abs(r.left - Math.min(...xs)), `${r.name} picture left`).toBeLessThan(1.5);
        expect(Math.abs(r.left + r.width - Math.max(...xs)), `${r.name} picture right`).toBeLessThan(1.5);
      }
    });
  }
}

// NAV-SCOPE: "views switch in place" went with the Case views menu; the whole wall's no-overlap cases below stay

for (const branch of ['', 'masked', 'framed', 'silhouette'] as const) {
  test(`no drawn figure reaches over its neighbour: ${branch || 'cut-out'} art, the whole wall`, async ({ page }) => {
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3${branch ? `&fxbranch=${branch}` : ''}`, {});
    await expectNoOverlap(page, branch || 'cut-out');
  });
}

// what keeps neighbours apart is the case packing by what each picture draws, not labels fitted to the fixtures
for (const [widths, what] of [
  ['none', 'no labelled width'],
  ['narrow', 'labelled narrower than its cut-out draws, as the real sign-off cut-outs are'],
] as const) {
  for (const branch of ['', 'masked'] as const) {
    test(`no drawn figure reaches over its neighbour, ${what}: ${branch || 'cut-out'} art, the whole wall`, async ({ page }) => {
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3&fxwidth=${widths}${branch ? `&fxbranch=${branch}` : ''}`, {});
      await expectNoOverlap(page, `${widths} ${branch || 'cut-out'}`);
    });
  }
}

// a figure off-centre in its picture (?fxasym=1: Rem 18 %, Spike 30 % of the picture's width right of its centre, Rem into her
// neighbour, Spike into the side panel): the case centres the figure, not the picture
for (const widths of ['', 'none', 'narrow'] as const) {
  for (const branch of ['', 'masked'] as const) {
    test(`no drawn figure reaches over its neighbour or into the side panel, off-centre art${widths ? `, widths ${widths}` : ''}: ${branch || 'cut-out'} art, the whole wall`, async ({ page }) => {
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3&fxasym=1${widths ? `&fxwidth=${widths}` : ''}${branch ? `&fxbranch=${branch}` : ''}`, {});
      const leaning = (await drawnFigures(page)).filter((r) => r.name === 'Rem' || r.name.startsWith('Spike'));
      // the art under test: the figures stand off-centre in their pictures
      expect(new Set(leaning.map((r) => r.name)).size).toBe(2);
      for (const r of leaning) expect(Math.abs(r.clear.left - r.clear.right), r.name).toBeGreaterThan(0.3);
      await expectNoOverlap(page, `off-centre ${widths || 'labelled'} ${branch || 'cut-out'}`);
    });
  }
}

test.describe('a slow or stalled picture never holds the other figures back', () => {
  // the app's service worker would answer the pictures from its precache, round these routes
  test.use({ serviceWorkers: 'block' });
  const RYUKO = /\/assets\/ryuuko-[^/]*\.png$/;
  const ryuko = /^Ryuko/;

  async function groundedOf(page: Page, name: RegExp) {
    const all = await page.locator('button.cab-figure').evaluateAll((els) => els.map((b) => ({ name: b.getAttribute('aria-label')!, grounded: (b as HTMLElement).dataset.grounded })));
    return all.filter((f) => name.test(f.name)).map((f) => f.grounded);
  }

  /** The most any figure named so is off true scale, mm: its opaque rows from the surface to its labelled height (none drawn yet: Infinity). */
  async function offTrueScale(page: Page, named: (name: string) => boolean) {
    const rows = (await pictureAlpha(page)).filter((r) => named(r.name));
    const off = rows.flatMap((r) => {
      const h = r.art.y1 - r.art.y0;
      return [Math.abs(r.art.y0 + r.clearBelow * h - r.world.surface), Math.abs(r.art.y1 - r.clearAbove * h - r.world.y1)];
    });
    return off.length > 0 ? Math.max(...off) : Infinity;
  }

  for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
    test(`a picture that never arrives: every other figure grounded and packed by what it draws, at once: ${size.name}`, async ({ page }) => {
      await page.route(RYUKO, () => {
        /* never answers */
      });
      // labels narrower than the cut-outs draw: a figure packed by its label while its picture is read would overlap
      await openCase(page, size, '&fx=3&fxwidth=narrow', {}, ryuko);
      const stalled = await groundedOf(page, ryuko);
      expect(stalled.length).toBeGreaterThan(0);
      expect(stalled, 'the stalled picture alone waits, on its plate').toEqual(stalled.map(() => '0'));
      await expectNoOverlap(page, `${size.name}, Ryuko stalled`);
    });

    test(`a picture 4 s late: the others grounded meanwhile, then it lands and the case relays out around it: ${size.name}`, async ({ page }) => {
      await page.route(RYUKO, async (route) => {
        // 4 s after the 3 s splash (SPLASH_MIN_MS), which the case is opened behind
        await new Promise((r) => setTimeout(r, 3_000 + 4_000));
        // on to the hands-off guard, which sends it
        await route.fallback();
      });
      await openCase(page, size, '&fx=3&fxwidth=narrow', {}, ryuko);
      const late = await groundedOf(page, ryuko);
      expect(late.length).toBeGreaterThan(0);
      expect(late, 'still on its way').toEqual(late.map(() => '0'));
      await expectNoOverlap(page, `${size.name}, Ryuko on its way`);
      await settle(page);
      await expectNoOverlap(page, `${size.name}, Ryuko landed`);
    });
  }

  test(`a cut-out whose alpha read fails to fetch its picture (a network error) before its own picture loads: that load reads it again, and it ends at true scale`, async ({ page }) => {
    // its own picture comes 3 s late; the app's first alpha read of it (its crossOrigin canvas read) fails at once, as a
    // network error does: decode() rejects for it as for a broken picture
    await page.route(RYUKO, async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.fallback();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __ryukoReads: number };
      w.__ryukoReads = 0;
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (this.crossOrigin !== 'anonymous' || !/\/ryuuko-[^/]*\.png$/.test(this.src)) return decode.call(this);
        return w.__ryukoReads++ === 0 ? Promise.reject(new DOMException('network error', 'EncodingError')) : decode.call(this);
      };
    });
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow', {}, ryuko);
    await expect.poll(() => offTrueScale(page, (name) => ryuko.test(name)), { timeout: 15_000, intervals: [500] }).toBeLessThan(0.5);
    // read twice: the failed read, then the one its load sent
    expect(await page.evaluate(() => (window as unknown as { __ryukoReads: number }).__ryukoReads)).toBe(2);
    await expectNoOverlap(page, 'Ryuko read again on its load');
  });

  test(`a cut-out whose own picture loads while its alpha read waits in line, that read then never decoding it (its fetch failed): read again at once, and it ends at true scale`, async ({ page }) => {
    // a cut-out loads as a CORS image and its alpha read shares that one request, so a failed fetch of the read alone is
    // staged as the existing case above stages it: decode() rejects for that read, as for a network error
    await page.addInitScript((n) => {
      // the app's alpha reads (its crossOrigin canvas reads, the only images it decodes): the first n keep their turns 3 s,
      // so the next waits in line while its own picture loads; that read then never decodes it, once
      const w = window as unknown as { __reads: { src: string; loaded: boolean; failed: boolean }[] };
      w.__reads = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (this.crossOrigin !== 'anonymous') return decode.call(this);
        const order = [...new Set(w.__reads.map((r) => r.src))];
        const nth = order.includes(this.src) ? order.indexOf(this.src) : order.length;
        const loaded = Array.from(document.querySelectorAll<HTMLImageElement>('img.cab-figure__art')).some((img) => img.src === this.src && img.complete && img.naturalWidth > 0);
        const failed = nth === n && !w.__reads.some((r) => r.src === this.src);
        w.__reads.push({ src: this.src, loaded, failed });
        if (failed) return Promise.reject(new DOMException('network error', 'EncodingError'));
        if (nth < n) return new Promise<void>((r) => setTimeout(r, 3_000)).then(() => decode.call(this));
        return decode.call(this);
      };
    }, ALPHA_READS_AT_ONCE);
    const reads = () => page.evaluate(() => (window as unknown as { __reads: { src: string; loaded: boolean; failed: boolean }[] }).__reads);
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow', {}, /./);
    await expect.poll(async () => (await reads()).some((r) => r.failed), { timeout: 15_000 }).toBe(true);
    const failed = (await reads()).find((r) => r.failed)!;
    expect(failed.loaded, 'its own picture had loaded: the load found its read waiting in line').toBe(true);
    const names = await page.evaluate(
      (v) => Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).filter((b) => b.querySelector<HTMLImageElement>('img.cab-figure__art')?.src === v).map((b) => b.getAttribute('aria-label')!),
      failed.src,
    );
    expect(names.length).toBeGreaterThan(0);
    await expect.poll(() => offTrueScale(page, (name) => names.includes(name)), { timeout: 15_000, intervals: [500] }).toBeLessThan(0.5);
    // read twice: the read that never decoded it, then the one sent again at once
    expect((await reads()).filter((r) => r.src === failed.src).map((r) => r.failed)).toEqual([true, false]);
    await expectNoOverlap(page, 'read again after it never decoded');
  });

  test(`8 pictures whose alpha reads stall for good: every other figure is still grounded within ${ALPHA_READ_DEADLINE_MS + 3 * ALPHA_READ_TURN_MS} ms (the stalled reads' first deadline, ${ALPHA_READ_DEADLINE_MS} ms, and three turns)`, async ({ page }) => {
    await page.addInitScript((n) => {
      // the app's alpha reads (its crossOrigin canvas reads) of the first n pictures it reads never end; the pictures themselves load
      const w = window as unknown as { __stalled: string[] };
      w.__stalled = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (this.crossOrigin !== 'anonymous') return decode.call(this);
        if (!w.__stalled.includes(this.src) && w.__stalled.length < n) w.__stalled.push(this.src);
        return w.__stalled.includes(this.src) ? new Promise<void>(() => {}) : decode.call(this);
      };
    }, 2 * ALPHA_READS_AT_ONCE);
    // each copy's picture at its own URL, as a real collection's: 21 pictures; no figure is waited for here
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxuniq=1', {}, /./);
    const stalledOf = () =>
      page.evaluate(() => {
        const stalled = (window as unknown as { __stalled: string[] }).__stalled;
        return Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => ({
          name: b.getAttribute('aria-label')!,
          stalled: stalled.includes(b.querySelector<HTMLImageElement>('img.cab-figure__art')?.src ?? ''),
          grounded: b.dataset.grounded === '1',
        }));
      });
    // the stalled reads are abandoned at their first deadline, so the others are read meanwhile (in about 9 s here)
    await expect
      .poll(async () => (await stalledOf()).filter((f) => !f.stalled && !f.grounded).map((f) => f.name), { timeout: ALPHA_READ_DEADLINE_MS + 3 * ALPHA_READ_TURN_MS })
      .toEqual([]);
    const figures = await stalledOf();
    expect(figures.filter((f) => f.stalled)).toHaveLength(2 * ALPHA_READS_AT_ONCE);
    expect(figures.filter((f) => !f.stalled).length).toBe(figures.length - 2 * ALPHA_READS_AT_ONCE);
    expect(figures.filter((f) => f.stalled && f.grounded), 'a stalled picture, still read again: on its plate').toEqual([]);
    await expectNoOverlap(page, '8 reads stalled');
  });

  test(`a slow link, no stall, the HTTP cache off (as under every e2e route): every picture ${ALPHA_READ_DEADLINE_MS + 2_000} ms on its way, longer than a read's first deadline; every figure ends grounded at true scale, and at no frame does a figure reach over its neighbour or into a side panel`, async ({ page }) => {
    test.setTimeout(180_000);
    const PICTURES = /\/assets\/[^/?]+\.png(\?copy=\d+)?$/;
    await page.route(PICTURES, async (route) => {
      await new Promise((r) => setTimeout(r, ALPHA_READ_DEADLINE_MS + 2_000));
      // on to the hands-off guard, which sends it; a read abandoned meanwhile has dropped its request
      await route.fallback().catch(() => {});
    });
    await page.addInitScript(() => {
      // every layout the scene shows, frame by frame: per figure, what it draws (its plate, or its picture once loaded) and where
      const w = window as unknown as { __layouts: { figures: number; rows: { name: string; kind: string; src: string; world: string; art: string }[] }[]; __alphaReads: number };
      w.__layouts = [];
      w.__alphaReads = 0;
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        // the app's alpha reads: its crossOrigin canvas reads
        if (this.crossOrigin === 'anonymous') w.__alphaReads++;
        return decode.call(this);
      };
      const seen = new Set<string>();
      const watch = () => {
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'));
        const rows = buttons.flatMap((b) => {
          const box = b.querySelector<HTMLElement>('.cab-figure__box');
          const el = box && (Array.from(box.children).find((c) => getComputedStyle(c).visibility !== 'hidden') as HTMLElement | undefined);
          if (!el || (el instanceof HTMLImageElement && !(el.complete && el.naturalWidth > 0))) return [];
          const plate = el.classList.contains('cab-figure__plate');
          const src = plate ? '' : (el.dataset.maskUrl ?? (el as HTMLImageElement).src);
          return [{ name: b.getAttribute('aria-label')!, kind: plate ? 'plate' : b.dataset.art!, src, world: b.dataset.world!, art: b.dataset.artBox! }];
        });
        const key = JSON.stringify(rows);
        if (!seen.has(key)) {
          seen.add(key);
          w.__layouts.push({ figures: buttons.length, rows });
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    // each copy's picture at its own URL, labels narrower than the cut-outs draw: a picture drawn on its label packing would overlap
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxuniq=1&fxwidth=narrow', {}, /./);
    await expect
      .poll(() => page.locator('button.cab-figure[data-grounded="0"]').count(), { timeout: 150_000, intervals: [1_000] })
      .toBe(0);
    const figures = await page.locator('button.cab-figure').count();
    // the reads ran out of time and were read again: no picture read in one go
    expect(await page.evaluate(() => (window as unknown as { __alphaReads: number }).__alphaReads)).toBeGreaterThan(figures);
    await page.unroute(PICTURES);
    const layouts = await page.evaluate(() => (window as unknown as { __layouts: { figures: number; rows: { name: string; kind: string; src: string; world: string; art: string }[] }[] }).__layouts);
    expect(layouts.some((l) => l.rows.some((r) => r.kind === 'plate')), 'figures stood on their plates on the way').toBe(true);
    // the clear sides of each picture drawn, measured here on the picture itself
    const srcs = [...new Set(layouts.flatMap((l) => l.rows.map((r) => r.src)).filter((s) => s))];
    const clear = await page.evaluate(async (urls) => {
      const out: Record<string, { left: number; right: number }> = {};
      for (const url of urls) {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let [x0, x1] = [c.width, -1];
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] <= 10) continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
          }
        }
        out[url] = { left: x0 / c.width, right: (c.width - 1 - x1) / c.width };
      }
      return out;
    }, srcs);
    const problems = layouts.flatMap((l, i) => {
      const rows = l.rows.map((r) => {
        const art = JSON.parse(r.art) as World;
        const side = clear[r.src] ?? { left: 0, right: 0 };
        const w = art.x1 - art.x0;
        return { name: r.name, kind: r.kind, world: JSON.parse(r.world) as World, opaque: { x0: art.x0 + side.left * w, x1: art.x1 - side.right * w } };
      });
      const o = overlapsOf(rows, l.figures);
      return [...o.tapOverlaps, ...o.drawnOverlaps, ...o.intoPanels].map((p) => `layout ${i + 1} of ${layouts.length}: ${p}`);
    });
    expect(problems).toEqual([]);
    // at the end, every picture at true scale: its opaque rows from the surface to the labelled height
    const rows = await pictureAlpha(page);
    expect(rows).toHaveLength(figures);
    for (const r of rows) {
      const pictureH = r.art.y1 - r.art.y0;
      expect(Math.abs(r.art.y0 + r.clearBelow * pictureH - r.world.surface), `${r.name} feet, mm`).toBeLessThan(0.5);
      expect(Math.abs(r.art.y1 - r.clearAbove * pictureH - r.world.y1), `${r.name} head, mm`).toBeLessThan(0.5);
    }
    await expectNoOverlap(page, 'slow link, every picture read');
  });

  test('a filter removed: the figures already measured stay grounded while the new pictures load', async ({ page }) => {
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow&mfr=Good%20Smile%20Company', {});
    const measured = /^(Rem|Nendoroid Hatsune Miku|Hatsune Miku: Deep Sea Girl)$/;
    expect((await groundedOf(page, measured)).length).toBeGreaterThan(0);
    // the pictures new to the list arrive 2 s late (a phone on a slow network)
    const NEW = /\/assets\/(dark-angel|madoka|spike|ryuuko)-[^/]*\.png$/;
    await page.route(NEW, async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      // on to the hands-off guard, which sends it
      await route.fallback();
    });
    await page.getByRole('listitem', { name: 'Remove filter Good Smile Company' }).click();
    await expect(page.locator('button.cab-figure[aria-label="Spike Spiegel"]').first()).toBeAttached();
    const during = await groundedOf(page, measured);
    expect(during, 'already measured: grounded at once').toEqual(during.map(() => '1'));
    await expectNoOverlap(page, 'new pictures on their way');
    await settle(page);
    await expectNoOverlap(page, 'new pictures landed');
  });
});

test.describe('a picture whose alpha read is slow while the picture itself is on time draws its plate meanwhile, never over a neighbour', () => {
  /**
   * Hold the app's alpha reads (its crossOrigin canvas reads) of the
   * pictures matching `slow` until the test releases them; every image the
   * scene shows loads as usual. And watch every frame from the first: the
   * names of figures not grounded whose picture shows.
   */
  async function holdReads(page: Page, slow: RegExp) {
    await page.addInitScript((source) => {
      const slowSrc = new RegExp(source);
      const w = window as unknown as { __releaseReads: () => void; __shownUngrounded: string[] };
      const held = new Promise<void>((r) => (w.__releaseReads = r));
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        return this.crossOrigin === 'anonymous' && slowSrc.test(this.src) ? held.then(() => decode.call(this)) : decode.call(this);
      };
      w.__shownUngrounded = [];
      const watch = () => {
        for (const b of document.querySelectorAll<HTMLElement>('button.cab-figure[data-grounded="0"]')) {
          const art = b.querySelector<HTMLElement>('.cab-figure__art');
          if (!art || getComputedStyle(art).visibility === 'hidden') continue;
          if (art instanceof HTMLImageElement && !(art.complete && art.naturalWidth > 0)) continue;
          const name = b.getAttribute('aria-label')!;
          if (!w.__shownUngrounded.includes(name)) w.__shownUngrounded.push(name);
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, slow.source);
  }

  async function groundedOf(page: Page, name: RegExp) {
    const all = await page.locator('button.cab-figure').evaluateAll((els) => els.map((b) => ({ name: b.getAttribute('aria-label')!, grounded: (b as HTMLElement).dataset.grounded })));
    return all.filter((f) => name.test(f.name)).map((f) => f.grounded);
  }

  const cases = [
    ...FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open').flatMap((size) =>
      (['', 'masked'] as const).map((branch) => ({ what: "Ryuko's read", slow: /\/ryuuko-[^/]*\.png$/, held: /^Ryuko/, size, branch })),
    ),
    // reads queued behind a long list: every picture shown before its read
    ...(['', 'masked'] as const).map((branch) => ({ what: 'every read', slow: /\.png$/, held: /./, size: FOLD8.find((v) => v.name === 'fold8-open')!, branch })),
  ];
  for (const { what, slow, held, size, branch } of cases) {
    test(`${what} slow, the pictures on time: a figure still being read draws its plate, over no neighbour or side panel; then its picture: ${branch || 'cut-out'}, ${size.name}`, async ({ page }) => {
      await holdReads(page, slow);
      // labels narrower than the cut-outs draw: a picture drawn on its label packing would overlap
      await openCase(page, size, `&fx=3&fxwidth=narrow${branch ? '&fxbranch=masked' : ''}`, {}, held);
      // the pictures themselves are here: only their reads wait
      await page.waitForFunction(
        (source) =>
          Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'))
            .filter((b) => new RegExp(source).test(b.getAttribute('aria-label')!))
            .every((b) => Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0)),
        held.source,
      );
      const waiting = await groundedOf(page, held);
      expect(waiting.length).toBeGreaterThan(0);
      expect(waiting, 'still being read').toEqual(waiting.map(() => '0'));
      // each drawn as its plate, where the camera puts its box in the world, and checked with its neighbours
      const camera = await cameraOf(page);
      const plates = (await drawnFigures(page)).filter((r) => held.test(r.name));
      expect.soft(plates.map((r) => r.kind)).toEqual(waiting.map(() => 'plate'));
      for (const r of plates) {
        const corners = [r.art.x0, r.art.x1].flatMap((x) => [r.art.y0, r.art.y1].map((y) => project(camera, [x, y, r.art.z])));
        const [xs, ys] = [corners.map((c) => c.x), corners.map((c) => c.y)];
        expect.soft(Math.abs(r.left - Math.min(...xs)), `${r.name} plate left`).toBeLessThan(1.5);
        expect.soft(Math.abs(r.left + r.width - Math.max(...xs)), `${r.name} plate right`).toBeLessThan(1.5);
        expect.soft(Math.abs(r.top - Math.min(...ys)), `${r.name} plate top`).toBeLessThan(1.5);
        expect.soft(Math.abs(r.top + r.height - Math.max(...ys)), `${r.name} plate bottom`).toBeLessThan(1.5);
      }
      await expectNoOverlap(page, `${size.name}, ${what} slow`);
      await page.evaluate(() => (window as unknown as { __releaseReads: () => void }).__releaseReads());
      await settle(page);
      await expectNoOverlap(page, `${size.name}, ${what} landed`);
      expect.soft(await page.evaluate(() => (window as unknown as { __shownUngrounded: string[] }).__shownUngrounded), 'a picture shown before it was read, at any frame').toEqual([]);
    });
  }
});

test.describe('a read landing after a new list is drawn, before its effects run, still grounds its figure', () => {
  for (const when of ['between the render and its effects', 'after the effects (control)'] as const) {
    test(`Ryuko's read lands ${when}: grounded on the narrowed list`, async ({ page }) => {
      await page.addInitScript((mode) => {
        // the app's alpha reads of Ryuko and Spike decode for real, then wait for the test before they answer
        const held = new Map<string, () => void>();
        const w = window as unknown as { __release: (re: string) => void; __released: string[] };
        w.__released = [];
        w.__release = (re: string) => {
          for (const [src, go] of held) {
            if (!new RegExp(re).test(src)) continue;
            go();
            w.__released.push(src);
            held.delete(src);
          }
        };
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
          const real = decode.call(this);
          if (this.crossOrigin !== 'anonymous' || !/\/(ryuuko|spike)-[^/]*\.png$/.test(this.src)) return real;
          const src = this.src;
          return real.then(() => new Promise<void>((go) => held.set(src, go)));
        };
        // Ryuko's read answers the moment the narrowed list is in the DOM: a microtask, before the next frame runs its effects
        if (mode === 'between the render and its effects') {
          new MutationObserver(() => {
            const names = Array.from(document.querySelectorAll('button.cab-figure')).map((b) => b.getAttribute('aria-label'));
            if (names.length > 0 && names.every((n) => n === 'Ryuko Matoi')) w.__release('ryuuko');
          }).observe(document, { subtree: true, childList: true });
        }
      }, when);
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3', {}, /^(Ryuko|Spike)/);
      // the list narrows to the wished figures: Ryuko alone, still being read
      await page.getByRole('button', { name: 'Refine' }).click();
      await expectSheetAtRest(page);
      await page.getByRole('group', { name: 'Holding' }).getByRole('button', { name: /^Wished/ }).click();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.locator('button.cab-figure')).toHaveCount(3);
      if (when === 'after the effects (control)') {
        await page.waitForTimeout(500);
        await page.evaluate(() => (window as unknown as { __release: (re: string) => void }).__release('ryuuko'));
      }
      await expect.poll(() => page.evaluate(() => (window as unknown as { __released: string[] }).__released.length)).toBeGreaterThan(0);
      // answered: grounded within a frame or two of the read, never left on its plate until the list changes again
      await expect(page.locator('button.cab-figure[data-grounded="0"]')).toHaveCount(0, { timeout: 3_000 });
    });
  }
});

test('the case ends where the cabinets do: the room fills the rest, nothing stretches (Ross 09-26)', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size);
  const camera = await cameraOf(page);
  // one pinhole, one focal length: a small square facing the camera at the middle of the frame draws square
  const look = { x: camera.x, y: camera.y - camera.z * Math.tan(camera.pitch), z: 0 };
  const o = project(camera, [look.x, look.y, look.z]);
  const r = project(camera, [look.x + 10, look.y, look.z]);
  const u = project(camera, [look.x, look.y + 10, look.z]);
  const across = Math.hypot(r.x - o.x, r.y - o.y);
  const up = Math.hypot(u.x - o.x, u.y - o.y);
  expect(Math.abs(up / across - Math.cos(camera.pitch))).toBeLessThan(0.01);
  // and the browser draws the KLINGSBO's front post exactly there: 1645 mm of post over 155 mm legs, never resized to the screen
  const slot = wallLayout([IKEA_KLINGSBO]).cabinets[0];
  const sec = IKEA_KLINGSBO.base.leg!.sectionMm;
  const legTop = IKEA_KLINGSBO.base.heightMm;
  const H = IKEA_KLINGSBO.outer.heightMm;
  const corners = [
    project(camera, [slot.leftMm, legTop, 0]),
    project(camera, [slot.leftMm + sec, legTop, 0]),
    project(camera, [slot.leftMm, H, 0]),
    project(camera, [slot.leftMm + sec, H, 0]),
  ];
  const scene = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const post = (await page.locator('.cab[data-index="0"] .cab-post').first().locator('.f-front').boundingBox())!;
  expect(Math.abs(post.y - scene.y - Math.min(...corners.map((c) => c.y)))).toBeLessThan(1.5);
  expect(Math.abs(post.y + post.height - scene.y - Math.max(...corners.map((c) => c.y)))).toBeLessThan(1.5);
  expect(Math.abs(post.x - scene.x - Math.min(...corners.map((c) => c.x)))).toBeLessThan(1.5);
  // the scene stops above the tabs; whatever the cabinets leave is room, not stretched shelves
  const tabs = (await page.locator('.case-tabs').boundingBox())!;
  expect(scene.y + scene.height).toBeLessThanOrEqual(tabs.y + 1);
});

async function swipe(page: Page, dx: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}

test('CC4 camera: a sideways swipe walks the camera along the wall; the perspective re-renders', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6');
  const before = await cameraOf(page);
  await swipe(page, -160);
  const after = await cameraOf(page);
  expect(after.x).toBeGreaterThan(before.x + 100);
  // and the drawing still follows the maths after the walk
  for (const r of await drawnVsPredicted(page)) expect(Math.abs(r.drawn.left - r.predicted.left)).toBeLessThan(1.5);
});

// PAN-KEEP-1 (Ross 10-20): Reset view was the deliberate way back to the default angle. NAV-2A2 (Ross 11-04): the swipe mode
// it kept the camera across is gone, and the tests of the switch with it. NAV-SCOPE (plan section 9, Ross 11-17: "reset
// view would only be used for pinch zoom"): it clears the zoom only, shown only while zoomed; the camera stays where the
// walk and the raise left it. At the Fold8 cover and open panels.
async function dragBy(page: Page, dx: number, dy: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`PAN-KEEP-1, NAV-SCOPE ${size.name}: a camera walked and raised shows no Reset view; pinched, Reset view clears only the zoom`, async ({ page }) => {
    await openCase(page, size, '&fx=24');
    const home = await cameraOf(page);
    const reset = page.getByRole('button', { name: 'Reset view' });
    await expect(reset).toHaveCount(0);
    await dragBy(page, -160, 0);
    await dragBy(page, 0, -120);
    const moved = await cameraOf(page);
    expect(moved.x, 'the camera walked').not.toBeCloseTo(home.x, 0);
    expect(moved.y, 'and rose').not.toBeCloseTo(home.y, 0);
    await expect(reset, 'a walk and a raise are no zoom').toHaveCount(0);
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const m = { x: f.x + f.width / 2, y: f.y + f.height * 0.55 };
    await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 60, y: m.y }, { x: m.x + 60, y: m.y });
    await expect(reset).toHaveCount(1);
    await page.waitForTimeout(400);
    await reset.click();
    await expect(reset).toHaveCount(0);
    expect((JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!) as { k: number }).k).toBe(1);
    expect(await cameraOf(page), 'the camera where the walk and the raise left it').toEqual(moved);
  });
}

test('a swipe opens nothing; the next tap does', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6');
  await swipe(page, -80);
  await page.waitForTimeout(200);
  await expect(page.locator('.pswp')).toHaveCount(0);
  // a figure the frame shows: framed to five cabinets on the cover, the cabinet's top may stand past the frame
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = page.locator('button.cab-figure');
  let shown = -1;
  for (let i = 0; i < (await figures.count()) && shown < 0; i++) {
    const b = await figures.nth(i).boundingBox();
    if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) shown = i;
  }
  expect(shown).toBeGreaterThanOrEqual(0);
  await figures.nth(shown).tap();
  await expect(page.locator('.pswp')).toBeVisible();
});

test('IC1: View, an empty Reserved slot, the raised +, Info, Refine; no swipe mode in the View card (CAM1) or the header (NAV-2A2)', async ({ page }) => {
  await openCase(page, FOLD8[0]);
  const tabs = page.locator('.case-tabs');
  const add = (await page.locator('.tab-bar__add').boundingBox())!;
  const bar = (await page.locator('.tab-bar').boundingBox())!;
  const tabBox = (await tabs.boundingBox())!;
  // the tabs rest on the tab bar; the + rises above the bar, between them
  expect(Math.abs(tabBox.y + tabBox.height - bar.y)).toBeLessThanOrEqual(1);
  expect(add.y).toBeLessThan(bar.y - add.height * 0.5);
  const order = await tabs.locator(':scope > [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab));
  expect(order).toEqual(['view', 'reserved', 'dock', 'info', 'refine']);
  await expect(tabs.locator('[data-tab="reserved"]')).toHaveText('');
  const dock = (await tabs.locator('[data-tab="dock"]').boundingBox())!;
  expect(Math.abs(dock.x + dock.width / 2 - (add.x + add.width / 2))).toBeLessThanOrEqual(1);

  // CAM1: the View card no longer holds the swipe mode; NAV-2A2: nor does the header
  await page.getByRole('button', { name: 'View' }).click();
  await expect(page.locator('.bottom-sheet')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pan the wall' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Move the camera' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Swipe/ })).toHaveCount(0);
});

for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`CC5 ${size.name}: the View card ends above the tab bar and its + and a tap reaches every choice in it`, async ({ page }) => {
    await openCase(page, size);
    await page.getByRole('button', { name: 'View' }).click();
    const card = page.locator('.bottom-sheet');
    await atRest(card);
    const bar = (await page.locator('.tab-bar').boundingBox())!;
    const shown = (await card.boundingBox())!;
    const add = (await page.locator('.tab-bar__add').boundingBox())!;
    expect.soft(shown.y + shown.height, 'the card ends above the tab bar').toBeLessThanOrEqual(bar.y + 0.5);
    expect.soft(shown.y + shown.height, 'the card ends above the raised +').toBeLessThanOrEqual(add.y + 0.5);
    const choices = card.locator('label.case-card__choice');
    // the back wall colours and the cabinet walls (the swipe mode and the view are in the header: CAM1, VIEWCARD-1)
    expect(await choices.count()).toBeGreaterThanOrEqual(7);
    const missed: string[] = [];
    for (const choice of await choices.all()) {
      const { hit, at } = await takesTap(choice, '.bottom-sheet__content');
      if (!hit) missed.push(`${(await choice.innerText()).trim()} @${at}`);
    }
    expect(missed).toEqual([]);
    // the card scrolled itself, never the screen behind it
    expect(await page.locator('.app-content').evaluate((el) => el.scrollTop)).toBe(0);
  });
}

for (const routePx of [325, 301]) {
  test(`CC5 a ${routePx} px route box (a short panel): the View card never rises past the top edge, and a tap reaches every choice`, async ({ page }) => {
    const sideways = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover-sideways')!;
    await openCase(page, sideways);
    // the route box runs from the top of the screen down to the tab bar: size the window so it is routePx tall
    const barAt = (await page.locator('.tab-bar').boundingBox())!.y;
    await page.setViewportSize({ width: sideways.width, height: Math.round(sideways.height + routePx - barAt) });
    await expect.poll(async () => Math.round((await page.locator('.tab-bar').boundingBox())!.y)).toBe(routePx);
    // (the tab by its exact name: the shorter window leaves the Free camera a Reset view, kept pose and all)
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const card = page.locator('.bottom-sheet');
    await atRest(card);
    const shown = (await card.boundingBox())!;
    const add = (await page.locator('.tab-bar__add').boundingBox())!;
    expect.soft(shown.y, 'the card keeps a gap below the top edge').toBeGreaterThanOrEqual(4);
    expect.soft(shown.y + shown.height, 'the card ends above the raised +').toBeLessThanOrEqual(add.y + 0.5);
    const missed: string[] = [];
    for (const choice of await card.locator('label.case-card__choice').all()) {
      const { hit, at } = await takesTap(choice, '.bottom-sheet__content');
      if (!hit) missed.push(`${(await choice.innerText()).trim()} @${at}`);
    }
    expect(missed).toEqual([]);
  });
}

test('masked art: the clean copy composited with its mask at display time (CSS mask-image)', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fxbranch=masked');
  const art = page.locator('.cab-figure__art--masked').first();
  const style = await art.evaluate((el) => {
    const cs = getComputedStyle(el);
    const abs = (u: string) => new URL(u, location.href).href;
    return {
      mask: cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image'),
      bg: cs.backgroundImage,
      maskUrl: abs((el as HTMLElement).dataset.maskUrl!),
      imageUrl: abs((el as HTMLElement).dataset.imageUrl!),
    };
  });
  // the build fingerprints the file names: the clean copy and its mask are two different files, each where it belongs
  expect(style.maskUrl).not.toBe(style.imageUrl);
  expect(style.mask).toBe(`url("${style.maskUrl}")`);
  expect(style.bg).toBe(`url("${style.imageUrl}")`);
  // the picture takes no tap: the figure's tap box does
  expect(await art.evaluate((el) => getComputedStyle(el.closest('.cab-figure__box')!).pointerEvents)).toBe('none');
});

