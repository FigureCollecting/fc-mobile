import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
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
  await expect(page.locator('#pre-splash')).toHaveCount(0);
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
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
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
        left: Math.min(...corners.map((c) => c.x)),
        right: Math.max(...corners.map((c) => c.x)),
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

/** Open the case in `view`; the shelf view frames shelf 1 (the top's band may not fit, the camera steps back only 3 in, CC4b). */
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
      await page.getByRole('button', { name: 'owned', exact: true }).click();
      await page.locator('.filter-sheet2__btn--apply').click();
      await expect(page.locator('.applied-chips__chip')).toHaveCount(1);
      await expectReframedAboveTabs(page, view, 'a chip added');
    });
  }
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
  const rows = await drawnFigures(page);
  const wall = wallLayout(Array.from({ length: rows.length }, () => IKEA_KLINGSBO)).cabinets;
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
  expect.soft(tapOverlaps, `${label}: tap boxes overlap`).toEqual([]);
  expect.soft(drawnOverlaps, `${label}: drawn neighbours overlap`).toEqual([]);
  expect.soft(intoPanels, `${label}: drawn into the side panel`).toEqual([]);
  expect(pairs, label).toBeGreaterThan(0);
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
        await new Promise((r) => setTimeout(r, 4_000));
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

  test(`8 pictures whose alpha reads stall for good: every other figure is still grounded, within the read deadline (${ALPHA_READ_DEADLINE_MS} ms)`, async ({ page }) => {
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
    // the stalled reads are abandoned at their deadline, so the others are read meanwhile
    await expect
      .poll(async () => (await stalledOf()).filter((f) => !f.stalled && !f.grounded).map((f) => f.name), { timeout: ALPHA_READ_DEADLINE_MS + 3 * ALPHA_READ_TURN_MS })
      .toEqual([]);
    const figures = await stalledOf();
    expect(figures.filter((f) => f.stalled)).toHaveLength(2 * ALPHA_READS_AT_ONCE);
    expect(figures.filter((f) => !f.stalled).length).toBe(figures.length - 2 * ALPHA_READS_AT_ONCE);
    expect(figures.filter((f) => f.stalled && f.grounded), 'a stalled picture, still read again: on its plate').toEqual([]);
    await expectNoOverlap(page, '8 reads stalled');
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
      await page.getByRole('button', { name: 'wished', exact: true }).click();
      await page.locator('.filter-sheet2__btn--apply').click();
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
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
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

test('a swipe opens nothing; the next tap does', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet' });
  await swipe(page, -80);
  await page.waitForTimeout(200);
  await expect(page.locator('.pswp')).toHaveCount(0);
  await page.locator('button.cab-figure').first().tap();
  await expect(page.locator('.pswp')).toBeVisible();
});

test('IC1: View, an empty Reserved slot, the raised +, Info, Refine; the View card switches the swipe', async ({ page }) => {
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

  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('radio', { name: 'Pan the wall' }).click();
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-swipe', 'pan');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).swipe).toBe('pan');
});

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

