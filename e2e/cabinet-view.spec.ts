import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, SHOT_VIEWPORTS } from './caseViewports';
import { atRest, takesTap } from './sheetRest';
import { touchPinch } from './touch';
import { project, unprojectToPlaneZ, type Camera } from '../src/components/display/caseCamera';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../src/components/display/cabinetPresets';
import { surfaceSlots, wallLayout } from '../src/components/display/packCabinets';
import { cabinetBox } from '../src/components/display/caseFraming';
import { boxCorners } from '../src/components/display/caseCamera';
import { ALPHA_READS_AT_ONCE, ALPHA_READ_DEADLINE_MS, ALPHA_READ_TURN_MS } from '../src/components/display/alphaMargin';

/**
 * The faithful cabinets in a real browser (CASE-FIX, CASE-CABINET,
 * CASE-ADAPT): a tap on a figure opens it and a tap on the cabinet opens
 * nothing; the browser draws each figure exactly where the camera maths
 * puts it, standing on its surface; switching views relays out without
 * overlap; the CC4 swipe walks the camera or pans the picture; the IC1 tabs
 * sit above the raised +. Fixture mode on the committed synthetic art.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

interface Prefs {
  view?: 'wall' | 'cabinet' | 'shelf';
  pattern?: string;
  swipe?: 'camera' | 'pan';
}

/** Open the case and settle it: every figure, or every one but those named `stalled` (whose pictures are held back). */
async function openCase(page: Page, size: { width: number; height: number }, query = '', prefs: Prefs = {}, stalled?: RegExp) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    if (Object.keys(p).length > 0) localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case${query}`);
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

/** Each figure's on-screen box (CSS px, relative to the scene) and the box the camera maths predicts for it, slid by the pan. */
async function drawnVsPredicted(page: Page) {
  const camera = await cameraOf(page);
  const pan = Number(await page.locator('.cabinet-scene').getAttribute('data-pan'));
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
    await openCase(page, size, '', { view: 'cabinet' });
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
  for (const view of ['wall', 'cabinet', 'shelf'] as const) {
    test(`the browser draws every figure where the camera maths puts it: ${view}, ${size.name}`, async ({ page }) => {
      await openCase(page, size, '', { view });
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

for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`the browser draws every figure where the camera maths puts it: panned past the slide, the photo retaken farther along, ${size.name}`, async ({ page }) => {
    // about 1,200 figures, the whole wall; six swipes slide the picture to its edge and walk its camera on (CC6)
    await openCase(page, size, '&fx=170', { view: 'wall', swipe: 'pan' });
    const x0 = (await cameraOf(page)).x;
    for (let i = 0; i < 6; i++) await swipe(page, -400);
    await settle(page);
    expect((await cameraOf(page)).x, 'the camera walked on').toBeGreaterThan(x0 + 1000);
    expect(Number(await page.locator('.cabinet-scene').getAttribute('data-pan')), 'the picture slid').toBeLessThan(-100);
    const rows = await drawnVsPredicted(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        expect(Math.abs(r.drawn[edge] - r.predicted[edge]), `${r.name} ${edge}`).toBeLessThan(1.5);
      }
    }
  });
}

/** The lowest scene y (CSS px) of what the view frames: the focus cabinet's front feet, or the shelf view's surface edge. */
async function framedBottomPx(page: Page, view: 'wall' | 'cabinet' | 'shelf'): Promise<number> {
  const camera = await cameraOf(page);
  const host = page.locator('.cabinet-scene');
  const focus = Number(await host.getAttribute('data-focus'));
  const slot = wallLayout(Array.from({ length: focus + 1 }, () => IKEA_KLINGSBO)).cabinets[focus];
  if (view !== 'shelf') {
    const b = cabinetBox(slot, 0);
    return Math.max(...boxCorners(b.x0, b.x1, 0, 0, b.z0, b.z1).map((c) => project(camera, c).y));
  }
  const s = surfaceSlots(IKEA_KLINGSBO)[Number(await host.getAttribute('data-shelf'))];
  const surface = IKEA_KLINGSBO.surfaces[s.surfaceIndex];
  const lo = surface.topMm - surface.thicknessMm;
  return Math.max(...[slot.leftMm, slot.rightMm].map((x) => project(camera, [x, lo, 0]).y));
}

type View = 'wall' | 'cabinet' | 'shelf';

/** Open the case in `view`; the shelf view frames shelf 1 (the top step, shelf 0, frames its band up to the ceiling, TOP1). */
async function openFramed(page: Page, size: { width: number; height: number }, view: View) {
  await openCase(page, size, '&fx=3', { view });
  if (view === 'shelf') {
    await page.getByRole('button', { name: 'Shelf below' }).click();
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-shelf', '1');
  }
}

/**
 * The scene runs from wherever the layout above it ends down to 4 px above
 * the pull-up tabs, never under them, and the camera frames the cabinet
 * (its feet, or the shelf's edge) inside it.
 */
async function expectFramedAboveTabs(page: Page, view: View, label: string) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const tabsTop = Math.min(
    (await page.locator('.case-tabs').boundingBox())!.y,
    ...(await page.locator('.case-tabs [data-tab]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))),
  );
  const sceneBottom = scene.y + scene.height;
  expect(sceneBottom, `${label}: the scene ends 4 px above the tabs`).toBeLessThanOrEqual(tabsTop - 3);
  expect(sceneBottom, `${label}: the scene reaches down to the tabs`).toBeGreaterThanOrEqual(tabsTop - 6);
  const bottom = scene.y + (await framedBottomPx(page, view));
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

for (const size of FOLD8) {
  for (const view of ['wall', 'cabinet', 'shelf'] as const) {
    test(`the whole framed cabinet stands above the pull-up tabs and the tab bar: ${view}, ${size.name}`, async ({ page }) => {
      await openFramed(page, size, view);
      await expectFramedAboveTabs(page, view, 'at load');
    });

    test(`still above the tabs when the phone goes offline and the banner pushes the page down: ${view}, ${size.name}`, async ({ page, context }) => {
      await openFramed(page, size, view);
      await expectFramedAboveTabs(page, view, 'online');
      await context.setOffline(true);
      await expect(page.locator('.offline-banner')).toBeVisible();
      await expectReframedAboveTabs(page, view, 'offline');
      await context.setOffline(false);
      await expect(page.locator('.offline-banner')).toHaveCount(0);
      await expectReframedAboveTabs(page, view, 'back online');
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
      if (view === 'shelf') {
        await page.getByRole('button', { name: 'Shelf below' }).click();
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-shelf', '1');
      }
      await expectFramedAboveTabs(page, view, 'reloaded without chips');
      await page.getByRole('button', { name: 'Refine' }).click();
      await expectSheetAtRest(page);
      // Refine applies at once (SHEETS-FB1); Done closes it, and the filter row it brought stays
      await page.getByRole('group', { name: 'Holding' }).getByRole('button', { name: /^Owned/ }).click();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.locator('.applied-chips')).toHaveCount(1);
      if (view === 'shelf') {
        // CASE-FB2a: a new filter starts the view again at the wall's start, its top first; on to shelf 1 as at load
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-shelf', '0');
        await page.getByRole('button', { name: 'Shelf below' }).click();
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-shelf', '1');
      }
      await expectReframedAboveTabs(page, view, 'a chip added');
    });
  }
}

// close-out 3, ruling 27: the mixed wall paged to its end on the Fold8 as the installed app (full screen), where a
// snap to three whole once left the last cabinet out of every page and made every other press go nowhere
for (const size of SHOT_VIEWPORTS.filter((v) => /^fold8-.*-full$/.test(v.name))) {
  test(`the mixed wall pages to its last cabinet, each press moving on and every cabinet whole on its page: ${size.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openCase(page, size, '&fx=30', { view: 'wall', swipe: 'camera', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' });
    const host = page.locator('.cabinet-scene');
    const n = (JSON.parse((await host.getAttribute('data-wall'))!) as number[][]).length;
    expect(n).toBeGreaterThan(8);
    const wall = wallLayout(Array.from({ length: n }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    // whole: the body, side to side at the height the frame aims at
    const whole = async () => {
      const camera = await cameraOf(page);
      const lookY = unprojectToPlaneZ(camera, camera.frame.width / 2, camera.frame.height / 2, 0)![1];
      return wall.cabinets.flatMap((slot, i) =>
        [slot.leftMm, slot.rightMm].every((x) => {
          const p = project(camera, [x, lookY, 0]).x;
          return p >= -1e-6 && p <= camera.frame.width + 1e-6;
        })
          ? [i]
          : [],
      );
    };
    const next = page.getByRole('button', { name: 'Next cabinet' });
    const paged = new Set(await whole());
    let x = (await cameraOf(page)).x;
    for (let k = 0; k < n && (await next.isEnabled()); k++) {
      await next.click();
      await expect.poll(async () => (await cameraOf(page)).x, { message: `press ${k}` }).toBeGreaterThan(x);
      x = (await cameraOf(page)).x;
      (await whole()).forEach((i) => paged.add(i));
    }
    await expect(next).toBeDisabled();
    expect(await whole(), 'the last page').toContain(n - 1);
    expect([...paged].sort((a, b) => a - b)).toEqual(wall.cabinets.map((_, i) => i));
  });
}

// close-out 4, ruling 32: on the mixed wall a walk could settle on the stop halfway between two cabinets where the next
// page opened, so the next press of Next went nowhere (the button only went off); from wherever a walk settles, on
// any page, Next moves the camera on and Prev back
for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open-rotated')) {
  test(`the mixed wall: after a walk on any page, Next moves the camera on and Prev back: ${size.name}`, async ({ page }) => {
    test.setTimeout(600_000);
    await openCase(page, size, '&fx=30', { view: 'wall', swipe: 'camera', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' });
    const next = page.getByRole('button', { name: 'Next cabinet' });
    const prev = page.getByRole('button', { name: 'Previous cabinet' });
    const x = async () => (await cameraOf(page)).x;
    let moves = 0;
    let last = false;
    for (let p = 0; p < 40 && !last; p++) {
      const opened = await x();
      last = await next.isDisabled();
      for (const dx of [-45, -70, -100, -130, -170, -220, -290, 70, 130]) {
        // a finger moving left walks on, so Next is the press that could find itself where it stands
        const button = dx < 0 ? next : prev;
        await swipe(page, dx);
        await page.waitForTimeout(100);
        const walked = await x();
        const at = `page ${p} walk ${dx} to ${walked} focus ${await page.locator('.cabinet-scene').getAttribute('data-focus')}`;
        if (await button.isEnabled()) {
          await button.click();
          await expect.poll(async () => Math.sign((await x()) - walked), { message: `${at}: ${dx < 0 ? 'Next' : 'Prev'}` }).toBe(dx < 0 ? 1 : -1);
          moves++;
        }
        // back to this page as it opened: the pages open left to right (a walk within the first page leaves Prev off)
        if ((await prev.isDisabled()) && (await x()) !== opened) await next.click();
        while ((await x()) > opened && (await prev.isEnabled())) await prev.click();
        while ((await x()) < opened && (await next.isEnabled())) await next.click();
        expect(await x(), at).toBe(opened);
      }
      if (!last) await next.click();
    }
    expect(moves).toBeGreaterThan(40);
  });
}

// the open Fold8 shows a tapped figure in a pane beside the case: the case column must still end above the tabs
for (const size of FOLD8.filter((v) => v.name === 'fold8-open' || v.name === 'fold8-open-rotated')) {
  test(`still above the tabs with the detail pane open, then offline: ${size.name}`, async ({ page, context }) => {
    await openFramed(page, size, 'cabinet');
    await page.locator('button.cab-figure').nth(1).tap();
    await expect(page.locator('.detail-pane')).toBeVisible();
    await expectReframedAboveTabs(page, 'cabinet', 'detail pane open');
    await context.setOffline(true);
    await expect(page.locator('.offline-banner')).toBeVisible();
    await expectReframedAboveTabs(page, 'cabinet', 'detail pane open, offline');
  });
}

for (const [from, to] of [
  ['fold8-cover', 'fold8-cover-sideways'],
  ['fold8-open', 'fold8-open-rotated'],
] as const) {
  for (const view of ['wall', 'cabinet', 'shelf'] as const) {
    test(`turning the phone with the case open re-fits the scene above the tabs: ${view}, ${from} to ${to}`, async ({ page }) => {
      await openFramed(page, FOLD8.find((v) => v.name === from)!, view);
      await page.setViewportSize(FOLD8.find((v) => v.name === to)!);
      await expectReframedAboveTabs(page, view, to);
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
    test(`true scale, ${branch}: the drawn figure (its opaque rows) is exactly its labelled height, feet on the surface: shelf view, ${size.name}`, async ({ page }) => {
      await openCase(page, size, branch === 'masked' ? '&fxbranch=masked' : '', { view: 'shelf' });
      const camera = await cameraOf(page);
      // the shelf view looks level: a figure facing the camera is drawn without foreshortening
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
    test(`true scale, ${branch}${asym ? ', off-centre art' : ''}: the tilted cabinet view draws each picture where its world box is, the figure in it its labelled height`, async ({ page }) => {
      await openCase(page, FOLD8[0], `${branch === 'masked' ? '&fxbranch=masked' : ''}${asym}`, { view: 'cabinet' });
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

// the labelled widths as given, none at all, and labels narrower than the cut-outs draw (as the real sign-off cut-outs have)
for (const widths of ['', 'none', 'narrow'] as const) {
  test(`views switch in place: no figure overlaps another on its surface, the scene keeps its size${widths ? `, widths ${widths}` : ''}`, async ({ page }) => {
    const size = FOLD8.find((v) => v.name === 'fold8-open')!;
    await openCase(page, size, `&fx=3${widths ? `&fxwidth=${widths}` : ''}`);
    const sceneBox = await page.locator('.cabinet-scene').boundingBox();
    for (const view of ['One cabinet', 'One shelf', 'Whole cabinets', 'One cabinet'] as const) {
      await page.getByRole('button', { name: 'View' }).click();
      await page.getByRole('radio', { name: view }).click();
      await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
      await expect(page.getByRole('radio', { name: view })).toHaveCount(0);
      await settle(page);
      expect(await page.locator('.cabinet-scene').boundingBox()).toEqual(sceneBox);
      await expectNoOverlap(page, view);
    }
  });
}

for (const branch of ['', 'masked', 'framed', 'silhouette'] as const) {
  test(`no drawn figure reaches over its neighbour: ${branch || 'cut-out'} art, the whole wall`, async ({ page }) => {
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3${branch ? `&fxbranch=${branch}` : ''}`, { view: 'wall' });
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
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3&fxwidth=${widths}${branch ? `&fxbranch=${branch}` : ''}`, { view: 'wall' });
      await expectNoOverlap(page, `${widths} ${branch || 'cut-out'}`);
    });
  }
}

// a figure off-centre in its picture (?fxasym=1: Rem 18 %, Spike 30 % of the picture's width right of its centre, Rem into her
// neighbour, Spike into the side panel): the case centres the figure, not the picture
for (const widths of ['', 'none', 'narrow'] as const) {
  for (const branch of ['', 'masked'] as const) {
    test(`no drawn figure reaches over its neighbour or into the side panel, off-centre art${widths ? `, widths ${widths}` : ''}: ${branch || 'cut-out'} art, the whole wall`, async ({ page }) => {
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, `&fx=3&fxasym=1${widths ? `&fxwidth=${widths}` : ''}${branch ? `&fxbranch=${branch}` : ''}`, { view: 'wall' });
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
      await openCase(page, size, '&fx=3&fxwidth=narrow', { view: 'wall' }, ryuko);
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
      await openCase(page, size, '&fx=3&fxwidth=narrow', { view: 'wall' }, ryuko);
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
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow', { view: 'wall' }, ryuko);
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
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow', { view: 'wall' }, /./);
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
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxuniq=1', { view: 'wall' }, /./);
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
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxuniq=1&fxwidth=narrow', { view: 'wall' }, /./);
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
    await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3&fxwidth=narrow&mfr=Good%20Smile%20Company', { view: 'wall' });
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
      await openCase(page, size, `&fx=3&fxwidth=narrow${branch ? '&fxbranch=masked' : ''}`, { view: 'wall' }, held);
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
      await openCase(page, FOLD8.find((v) => v.name === 'fold8-open')!, '&fx=3', { view: 'wall' }, /^(Ryuko|Spike)/);
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
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet', swipe: 'camera' });
  const before = await cameraOf(page);
  await swipe(page, -160);
  const after = await cameraOf(page);
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(await page.locator('.cabinet-scene').getAttribute('data-pan')).toBe('0');
  // and the drawing still follows the maths after the walk
  for (const r of await drawnVsPredicted(page)) expect(Math.abs(r.drawn.left - r.predicted.left)).toBeLessThan(1.5);
});

test('CC4 pan: a sideways swipe slides the drawn wall like a photo; the camera stays put', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet', swipe: 'pan' });
  // five cabinets: narrower than the frame at this zoom, but starting mid-screen, so the rest slides in
  const before = await cameraOf(page);
  const fig = page.locator('button.cab-figure').first();
  const x0 = (await fig.boundingBox())!.x;
  await swipe(page, -120);
  expect(await cameraOf(page)).toEqual(before);
  const pan = Number(await page.locator('.cabinet-scene').getAttribute('data-pan'));
  expect(pan).toBeLessThan(-100);
  expect((await fig.boundingBox())!.x).toBeCloseTo(x0 + pan, 0);
});

// PAN-KEEP-1 (Ross 10-20): choosing Pan the wall used to put the camera back at the default angle. In the wall and cabinet
// views the camera (its walk, its height, tilt, lens) and the pan now stay across Pan <-> Move the camera; Reset view is the
// deliberate way back, in either mode; the shelf view keeps its straight-on snap (TOP1). At the Fold8 cover and open panels.
async function dragBy(page: Page, dx: number, dy: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}
async function chooseSwipe(page: Page, name: 'Pan the wall' | 'Move the camera') {
  await page.getByRole('button', { name: /^Swipe/ }).click();
  await page.getByRole('menuitemradio', { name }).click();
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-swipe', name === 'Pan the wall' ? 'pan' : 'camera');
}
const sceneState = async (page: Page) => {
  const scene = page.locator('.cabinet-scene');
  return { camera: await scene.getAttribute('data-camera'), pan: await scene.getAttribute('data-pan'), panY: await scene.getAttribute('data-pan-y') };
};

for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  for (const view of ['wall', 'cabinet'] as const) {
    test(`PAN-KEEP-1 ${view} ${size.name}: a perspective set in camera mode is kept in pan mode, and Reset view is the way back`, async ({ page }) => {
      // a wall longer than the frame, so there is wall to pan along on the wide panel too
      await openCase(page, size, '&fx=24', { view, swipe: 'camera' });
      const home = await cameraOf(page);
      await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
      await dragBy(page, -160, 0);
      await dragBy(page, 0, -120);
      const set = await sceneState(page);
      const moved = await cameraOf(page);
      expect(moved.x, 'the camera walked').not.toBeCloseTo(home.x, 0);
      expect(moved.y, 'and rose').not.toBeCloseTo(home.y, 0);

      await chooseSwipe(page, 'Pan the wall');
      expect(await sceneState(page), 'switching to Pan keeps the camera (position, height, tilt, lens) as it was').toEqual(set);
      await expect(page.getByRole('button', { name: 'Reset view' }), 'Reset view is visible in pan mode').toBeVisible();
      // the camera went along the wall: the photo slides back toward its start, or on, whichever way there is wall to show
      await dragBy(page, 120, 0);
      let panned = await sceneState(page);
      if (panned.pan === '0') {
        await dragBy(page, -240, 0);
        panned = await sceneState(page);
      }
      expect(Number(panned.pan), 'a swipe pans from there').not.toBe(0);
      expect(panned.camera, 'the pan moves the picture, not the camera').toBe(set.camera);

      await chooseSwipe(page, 'Move the camera');
      expect(await sceneState(page), 'back in camera mode nothing moves').toEqual(panned);

      await page.getByRole('button', { name: 'Reset view' }).click();
      await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
      const back = await cameraOf(page);
      expect([back.y, back.z, back.pitch, back.focalPx], 'the default angle').toEqual([home.y, home.z, home.pitch, home.focalPx]);
      expect(await page.locator('.cabinet-scene').getAttribute('data-pan')).toBe('0');
    });
  }

  test(`PAN-KEEP-1 ${size.name}: the zoom stays with the camera across a mode switch`, async ({ page }) => {
    await openCase(page, size, '&fx=6', { view: 'wall', swipe: 'camera' });
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const m = { x: f.x + f.width / 2, y: f.y + f.height * 0.55 };
    await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 40, y: m.y }, { x: m.x + 40, y: m.y });
    await expect(page.locator('.cabinet-scene__zoom--live')).toHaveCount(0);
    await expect.poll(async () => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!).k).toBeGreaterThan(1.2);
    const zoomed = await page.locator('.cabinet-scene').getAttribute('data-zoom');
    await chooseSwipe(page, 'Pan the wall');
    expect(await page.locator('.cabinet-scene').getAttribute('data-zoom')).toBe(zoomed);
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  });
}

test('PAN-KEEP-1 shelf view: choosing a swipe mode there still starts from the straight-on frame (TOP1)', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'shelf', swipe: 'camera' });
  const home = await cameraOf(page);
  await dragBy(page, 0, -120);
  expect((await cameraOf(page)).y, 'the camera rose').not.toBeCloseTo(home.y, 0);
  await chooseSwipe(page, 'Pan the wall');
  expect((await cameraOf(page)).y, 'the frame again').toBeCloseTo(home.y, 0);
});

test('a swipe opens nothing; the next tap does', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet' });
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

test('IC1: View, an empty Reserved slot, the raised +, Info, Refine; the swipe is switched in the header, not the View card (CAM1)', async ({ page }) => {
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

  // CAM1: the View card no longer holds the swipe mode; the header's Swipe button and its menu do
  await page.getByRole('button', { name: 'View' }).click();
  await expect(page.locator('.bottom-sheet')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pan the wall' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Move the camera' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  await page.getByRole('button', { name: /^Swipe/ }).click();
  await page.getByRole('menuitemradio', { name: 'Pan the wall' }).click();
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-swipe', 'pan');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).swipe).toBe('pan');
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
    // three views and the cabinet walls (the swipe mode is in the header: CAM1)
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
    await page.getByRole('button', { name: 'View' }).click();
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
  await openCase(page, FOLD8[0], '&fxbranch=masked', { view: 'shelf' });
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

