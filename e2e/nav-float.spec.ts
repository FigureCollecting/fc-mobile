import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR, SHOT_VIEWPORTS } from './caseViewports';
import { touchFingers, touchPinch, touchTap } from './touch';
import { centreOf, depth, hat, hatCircle, navControls } from './navControls';
import { DEPTH_FULL_PX } from '../src/components/display/caseDepth';
import { JOG_FULL_PX, JOG_MAX_STEP_MS } from '../src/components/display/casePose';
import { DEPTH_RAIL_PX, EYE_SLOT_DEG, HAT_RING_PX, NAV_EDGE_PX, NAV_LIFT_PX, NAV_MOUSE_SCALE } from '../src/components/display/navTuning';

/**
 * NAV-FLOAT (handoff FINAL 11-17), in Chromium at the Fold8's panels, fixture mode, through Chromium's own touch pipeline
 * (CDP touches): the Free camera's two controls float over the case, the Z rail lower-left and the XY hat lower-right,
 * where the centre cluster was. (a) where they sit; (b) two thumbs on the two controls move x and z and are never a
 * pinch or a tap; (c) a control takes a touch only inside its own shape: a figure beside it is still tapped; (d) a
 * capture lost on the hat stops its drive; and what stands round them: the header's Add, the three headers, the chips.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const OPEN = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open')!;
const TWO_THUMBS = [COVER, OPEN];

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

async function openFree(page: Page, size: { width: number; height: number }, opts: { query?: string; prefs?: Record<string, unknown> } = {}) {
  await page.addInitScript((prefs) => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0, ...prefs }));
  }, opts.prefs ?? {});
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&${opts.query ?? 'fx=40'}`);
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
const zoomOf = async (page: Page) => (JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!) as { k: number }).k;
/** A figure's Info, however this width shows it: the full-screen viewer, or the pane beside the case. */
const info = (page: Page) => page.locator('.pswp, .detail-pane');
type Box = { x: number; y: number; width: number; height: number };
const boxesOf = async (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box));
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// --- (a) where they sit ---------------------------------------------------------------------------------------------------

test('NAV-FLOAT (a): on every Fold8 panel the hat sits lower-right and the Z rail lower-left, inside the safe area and clear of every tab; the + is no jog and has left the bar for the header', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openFree(page, COVER);
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-free-camera', '1');
  await expect(hat(page)).toHaveCount(1);
  await expect(depth(page)).toHaveCount(1);
  // the bottom-centre button: no jog, and on the collection not in the bar at all; Add is the header's
  await expect(page.locator('[data-jog]')).toHaveCount(0);
  await expect(page.locator('.tab-bar__add')).toHaveCount(0);
  await expect(page.locator('.slim-header__actions').getByRole('button', { name: 'Add figures', exact: true })).toHaveCount(1);
  await expect(page.locator('.depth-rocker, .case-tabs__dock, [data-tab="reserved"]')).toHaveCount(0);

  const rows: { panel: string; inset: number; hat: number[]; rail: number[]; hits: string[] }[] = [];
  const panels = [...FOLD8, ...SHOT_VIEWPORTS.filter((v) => v.mobile)];
  for (const panel of panels) {
    await page.setViewportSize({ width: panel.width, height: panel.height });
    // an edge-to-edge app pads the gesture area and a landscape cutout (env(safe-area-inset-*)): modelled as 48 and 24 px
    for (const inset of [0, 48]) {
      const side = inset / 2;
      await page.evaluate(
        ([bottom, side]) => {
          const root = document.documentElement.style;
          root.setProperty('--safe-area-bottom', `${bottom}px`);
          root.setProperty('--safe-area-left', `${side}px`);
          root.setProperty('--safe-area-right', `${side}px`);
        },
        [inset, side],
      );
      await settle(page, 200);
      const h = (await hat(page).boundingBox())!;
      const r = (await depth(page).boundingBox())!;
      const scene = (await page.locator('.cabinet-scene').boundingBox())!;
      const strip = (await page.locator('.case-tabs').boundingBox())!;
      // chosen by the case's shorter side, not the width alone (fix1): a wide but short scene keeps the compact ring
      const ring = Math.min(scene.width, scene.height) >= HAT_RING_PX.wideFrom ? HAT_RING_PX.wide : HAT_RING_PX.compact;
      const what = `${panel.name} inset ${inset}`;
      // the ring: its size, 20 px in from the right safe edge, 16 px above the case tabs
      expect([h.width, h.height], `${what}: the ring`).toEqual([ring, ring]);
      expect(h.x + h.width, `${what}: the hat's right`).toBeCloseTo(panel.width - side - NAV_EDGE_PX, 1);
      expect(h.y + h.height, `${what}: the hat's bottom`).toBeCloseTo(strip.y - NAV_LIFT_PX, 1);
      // the rail: its target, the drawn rail 20 px in from the left safe edge and 16 px above the case tabs
      expect([r.width, r.height], `${what}: the rail's target`).toEqual([DEPTH_RAIL_PX.hitWidth, DEPTH_RAIL_PX.hitHeight]);
      const padX = (DEPTH_RAIL_PX.hitWidth - DEPTH_RAIL_PX.width) / 2;
      const padY = (DEPTH_RAIL_PX.hitHeight - DEPTH_RAIL_PX.height) / 2;
      expect(r.x + padX, `${what}: the rail's left`).toBeCloseTo(side + NAV_EDGE_PX, 1);
      expect(r.y + r.height - padY, `${what}: the rail's bottom`).toBeCloseTo(strip.y - NAV_LIFT_PX, 1);
      // both inside the window's safe area, and over the scene (never over the header)
      expect(h.x, what).toBeGreaterThanOrEqual(side);
      expect(r.x, what).toBeGreaterThanOrEqual(side);
      expect(h.y, `${what}: the hat under the scene's top`).toBeGreaterThanOrEqual(scene.y);
      expect(r.y, `${what}: the rail under the scene's top`).toBeGreaterThanOrEqual(scene.y);
      // lower-right and lower-left of the window (Chrome's own layout: nothing padded)
      if (inset === 0) {
        expect(h.x + h.width / 2, `${what}: the hat right of the middle`).toBeGreaterThan(panel.width / 2);
        expect(h.y + h.height / 2, `${what}: the hat below the middle`).toBeGreaterThan(panel.height / 2);
        expect(r.x + r.width / 2, `${what}: the rail left of the middle`).toBeLessThan(panel.width / 2);
        expect(r.y + r.height / 2, `${what}: the rail below the middle`).toBeGreaterThan(panel.height / 2);
      }
      // a thumb's full reach round the hat's centre stays in the window, above the gesture area
      expect(h.y + h.height / 2 + JOG_FULL_PX, `${what}: full reach below the hat`).toBeLessThanOrEqual(panel.height - inset);
      expect(h.x + h.width / 2 + JOG_FULL_PX, `${what}: full reach right of the hat`).toBeLessThanOrEqual(panel.width);
      const others = [
        ...(await boxesOf(page, '.tab-bar__item')).map((b) => ({ b, what: 'tab' })),
        ...(await boxesOf(page, '.case-tabs__tab')).map((b) => ({ b, what: 'case tab' })),
        ...(await boxesOf(page, '.slim-header')).map((b) => ({ b, what: 'header' })),
      ];
      const drawnRail = { x: r.x + padX, y: r.y + padY, width: DEPTH_RAIL_PX.width, height: DEPTH_RAIL_PX.height };
      const hits = [...others.filter((o) => overlaps(h, o.b)).map((o) => `hat over ${o.what}`), ...others.filter((o) => overlaps(drawnRail, o.b)).map((o) => `rail over ${o.what}`)];
      if (overlaps(h, r)) hits.push('hat over rail');
      rows.push({ panel: panel.name, inset, hat: [h.x, h.y, h.width, h.height].map(Math.round), rail: [r.x, r.y, r.width, r.height].map(Math.round), hits });
    }
  }
  await testInfo.attach('nav-geometry', { body: JSON.stringify(rows), contentType: 'application/json' });
  console.log(`NAV-GEOMETRY ${JSON.stringify(rows)}`);
  expect(rows).toHaveLength(panels.length * 2);
  for (const row of rows) expect(row.hits, `${row.panel} inset ${row.inset}`).toEqual([]);
});

test('NAV-FLOAT (a): the tiles float no control; back on the case they are there again', async ({ page }) => {
  await openFree(page, COVER);
  await expect(navControls(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^Tiles,/ }).click();
  await expect(page.locator('.cabinet-scene')).toHaveCount(0);
  await expect(navControls(page)).toHaveCount(0);
  await expect(page.locator('.tab-bar__add')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add figures', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Case', exact: true }).click();
  await ready(page);
  await expect(navControls(page)).toHaveCount(2);
});

test('NAV-FLOAT: Add in the header opens the Add sheet; on another screen the raised + is back in the bar', async ({ page }) => {
  await openFree(page, COVER);
  await page.getByRole('button', { name: 'Add figures', exact: true }).tap();
  await expect(page.getByText(/import your mfc export/i)).toBeVisible();
  await page.locator('.bottom-sheet__handle-area').click();
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stats', exact: true }).tap();
  await expect(page.locator('.tab-bar__add')).toHaveCount(1);
  await expect(navControls(page)).toHaveCount(0);
});

// --- (b) two thumbs: x and z move, never a pinch, never a tap ---------------------------------------------------------------

for (const panel of TWO_THUMBS) {
  test(`NAV-FLOAT (b) ${panel.name}: two thumbs held on the hat and the Z rail move x and z together; the zoom stays 1x and no figure opens; each lift stops its own`, async ({ page }) => {
    await openFree(page, panel);
    const hatAt = await centreOf(hat(page));
    const railAt = await centreOf(depth(page));
    const c0 = await cameraOf(page);
    expect(await zoomOf(page)).toBe(1);
    const f = await touchFingers(page);
    // the left thumb pushes the rail up while the right thumb goes out on a diagonal: both at once (half reach on the
    // rail: at full the eye is at the glass, its closest, before the hat lifts)
    const up = railAt.y - DEPTH_FULL_PX / 2;
    await f.down(1, railAt.x, railAt.y);
    await f.down(2, hatAt.x, hatAt.y);
    await f.to(1, railAt.x, up, 6);
    await f.to(2, hatAt.x + JOG_FULL_PX * 0.7, hatAt.y - JOG_FULL_PX * 0.7, 6);
    await hold(page, 800);
    await expect(hat(page)).toHaveAttribute('data-jogging', '');
    await expect(depth(page)).toHaveAttribute('data-rocking', '');
    const c1 = await cameraOf(page);
    expect(c1.x, 'the hat: right').toBeGreaterThan(c0.x + 20);
    expect(c1.y, 'the hat: up').toBeGreaterThan(c0.y + 10);
    expect(c1.z, 'the rail: closer').toBeLessThan(c0.z - 20);
    expect([c1.yaw, c1.pitch], 'never a look').toEqual([c0.yaw, c0.pitch]);
    expect(await zoomOf(page), 'two thumbs on the two controls are no pinch').toBe(1);
    await expect(info(page)).toHaveCount(0);
    // the thumbs spread and close, as a pinch would on the scene: still no zoom
    await f.to(1, railAt.x - 30, up, 4);
    await f.to(2, hatAt.x + JOG_FULL_PX + 30, hatAt.y, 4);
    await f.to(1, railAt.x + 40, up, 4);
    await f.to(2, hatAt.x - 40, hatAt.y, 4);
    await hold(page, 200);
    expect(await zoomOf(page), 'spread and closed: no pinch').toBe(1);
    // the hat's lift: the depth goes on alone
    await f.up(2);
    await settle(page, 100);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    const c2 = await cameraOf(page);
    await hold(page, 400);
    const c3 = await cameraOf(page);
    expect(c3.x, 'the hat stopped').toBe(c2.x);
    expect(c3.z, 'the depth runs on').toBeLessThan(c2.z);
    await f.up(1);
    await settle(page);
    const c4 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page), 'both lifted: nothing moves').toEqual(c4);
    expect(await zoomOf(page)).toBe(1);
    await expect(info(page)).toHaveCount(0);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    expect(await hat(page).getAttribute('data-jogging')).toBeNull();
    expect(await depth(page).getAttribute('data-rocking')).toBeNull();
  });
}

test('NAV-FLOAT: a thumb dragged far outside the ring keeps the hat: over the scene, the tabs and the tab bar the eye goes on, nothing is pressed', async ({ page }) => {
  await openFree(page, COVER);
  const url = page.url();
  const at = await centreOf(hat(page));
  const c0 = await cameraOf(page);
  const f = await touchFingers(page);
  await f.down(1, at.x, at.y);
  // far up and left over the figures, then down across the case tabs and the tab bar
  await f.to(1, at.x - 250, at.y - 200, 8);
  await hold(page, 400);
  const c1 = await cameraOf(page);
  expect(c1.x, 'left').toBeLessThan(c0.x - 20);
  expect(c1.y, 'up').toBeGreaterThan(c0.y + 10);
  await f.to(1, at.x - 150, COVER.height - 20, 8);
  await hold(page, 400);
  await expect(hat(page)).toHaveAttribute('data-jogging', '');
  const c2 = await cameraOf(page);
  expect(c2.y, 'down').toBeLessThan(c1.y);
  await f.up(1);
  await settle(page);
  expect(await zoomOf(page)).toBe(1);
  expect(page.url()).toBe(url);
  await expect(info(page)).toHaveCount(0);
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  expect(await hat(page).getAttribute('data-jogging')).toBeNull();
});

// --- (c) only the real hit shapes take a touch -----------------------------------------------------------------------------

/**
 * Round the hat, the first way (degrees, anticlockwise from the right) where a figure's tap box lies under the ring's
 * edge: 8 px outside the circle the figure is the top element, and 8 px inside it the hat is, with that figure under it.
 */
async function figureAtHatEdge(page: Page) {
  const c = await hatCircle(page);
  return page.evaluate(({ c }) => {
    for (let deg = 60; deg <= 240; deg += 2) {
      const [ux, uy] = [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
      const out = { x: c.x + ux * (c.r + 8), y: c.y + uy * (c.r + 8) };
      const inn = { x: c.x + ux * (c.r - 8), y: c.y + uy * (c.r - 8) };
      const top = document.elementFromPoint(out.x, out.y)?.closest('button.cab-figure') ?? null;
      if (top === null) continue;
      const under = document.elementsFromPoint(inn.x, inn.y);
      if (under[0]?.closest('[data-nav="hat"]') == null) continue;
      if (!under.some((el) => el.closest('button.cab-figure') === top)) continue;
      return { deg, out, inn, name: top.getAttribute('aria-label') };
    }
    return null;
  }, { c });
}

for (const panel of TWO_THUMBS) {
  test(`NAV-FLOAT (c) ${panel.name}: a tap on a figure 8 px outside the hat's circle opens its Info; a tap 8 px inside the circle, over the same figure, opens nothing and moves nothing`, async ({ page }) => {
    test.setTimeout(90_000);
    await openFree(page, panel, { query: 'fx=170' });
    // walk the eye with the hat until a figure's tap box lies under the ring's edge
    let found = await figureAtHatEdge(page);
    for (let i = 0; found === null && i < 12; i++) {
      const at = await centreOf(hat(page));
      const f = await touchFingers(page);
      await f.down(1, at.x, at.y);
      await f.to(1, at.x + (i % 2 === 0 ? 30 : 0), at.y + (i % 2 === 0 ? 0 : -24), 4);
      await hold(page, 250);
      await f.up(1);
      await settle(page, 300);
      found = await figureAtHatEdge(page);
    }
    expect(found, 'a figure under the ring\'s edge').not.toBeNull();
    console.log(`NAV-TAP ${panel.name} ${JSON.stringify(found)}`);
    const before = await cameraOf(page);
    // inside the circle: the hat's, a tap of which does nothing
    await touchTap(page, found!.inn.x, found!.inn.y);
    await settle(page, 500);
    await expect(info(page)).toHaveCount(0);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    expect(await cameraOf(page)).toEqual(before);
    // outside it, 16 px along the same line: the figure's
    await touchTap(page, found!.out.x, found!.out.y);
    await expect(info(page)).toHaveCount(1);
    await expect(page.locator(panel.width >= 640 ? '.detail-pane' : '.figure-viewer-sheet')).toContainText(found!.name!);
  });
}

test('NAV-FLOAT (c): the layer, the corners of the hat\'s box and the eye\'s slot take no touch; beside the Z rail\'s target a figure is tapped, inside it not', async ({ page }) => {
  test.setTimeout(90_000);
  await openFree(page, COVER, { query: 'fx=170' });
  // the corner of the hat's square box is outside its circle: the scene's, never the hat's or the layer's
  const h = (await hat(page).boundingBox())!;
  const corners = await page.evaluate(
    ({ h }) =>
      [
        [h.x + 3, h.y + 3],
        [h.x + h.width - 3, h.y + 3],
        [h.x + 3, h.y + h.height - 3],
      ].map(([x, y]) => {
        const el = document.elementFromPoint(x, y)!;
        return { nav: el.closest('[data-nav], .floating-nav') !== null, scene: el.closest('.cabinet-scene') !== null };
      }),
    { h },
  );
  expect(corners).toEqual([
    { nav: false, scene: true },
    { nav: false, scene: true },
    { nav: false, scene: true },
  ]);
  // the eye's slot: kept on the upper-left shoulder, drawing nothing and taking nothing
  const slot = (await page.locator('[data-nav-slot="eye"]').boundingBox())!;
  const c = await hatCircle(page);
  const slotAt = { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 };
  // (on the ring's inner edge: its 1.5 px line is outside what the slot is placed in)
  expect(Math.abs(Math.hypot(slotAt.x - c.x, slotAt.y - c.y) - c.r), 'the slot is centred on the ring').toBeLessThanOrEqual(2);
  expect(Math.atan2(c.y - slotAt.y, slotAt.x - c.x) * (180 / Math.PI), 'at 135 degrees').toBeCloseTo(EYE_SLOT_DEG, 0);
  expect(slotAt.x, 'on the inboard side').toBeLessThan(c.x);
  expect(slotAt.y, 'on the upper side').toBeLessThan(c.y);
  await expect(page.locator('[data-nav-slot="eye"]')).toHaveCSS('pointer-events', 'none');

  // the rail: 8 px right of its target a figure is the top element; walk until one is there
  const railEdge = async () => {
    const r = (await depth(page).boundingBox())!;
    return page.evaluate(({ r }) => {
      for (let y = r.y + 6; y <= r.y + r.height - 6; y += 4) {
        const out = { x: r.x + r.width + 8, y };
        const inn = { x: r.x + r.width - 8, y };
        const top = document.elementFromPoint(out.x, out.y)?.closest('button.cab-figure') ?? null;
        if (top === null) continue;
        const under = document.elementsFromPoint(inn.x, inn.y);
        // (16 px on, inside the target, the rail is the top element; the small figures here need not reach under it)
        if (under[0]?.closest('[data-nav="depth"]') == null) continue;
        return { out, inn, name: top.getAttribute('aria-label') };
      }
      return null;
    }, { r });
  };
  let found = await railEdge();
  for (let i = 0; found === null && i < 12; i++) {
    const at = await centreOf(hat(page));
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    // the eye goes right and up by turns: the figures come left and down, toward the rail
    await f.to(1, at.x + (i % 2 === 0 ? 30 : 0), at.y - (i % 2 === 0 ? 0 : 24), 4);
    await hold(page, 250);
    await f.up(1);
    await settle(page, 300);
    found = await railEdge();
  }
  expect(found, 'a figure under the rail target\'s edge').not.toBeNull();
  const before = await cameraOf(page);
  await touchTap(page, found!.inn.x, found!.inn.y);
  await settle(page, 500);
  await expect(info(page)).toHaveCount(0);
  expect(await cameraOf(page)).toEqual(before);
  await touchTap(page, found!.out.x, found!.out.y);
  await expect(info(page)).toHaveCount(1);
  await expect(page.locator('.figure-viewer-sheet')).toContainText(found!.name!);
});

// --- (d) the capture lost on the hat ----------------------------------------------------------------------------------------

for (const panel of TWO_THUMBS) {
  test(`NAV-FLOAT (d) ${panel.name}: the hat's capture lost mid-drag stops the drive; the lift elsewhere leaves nothing moving`, async ({ page }) => {
    await openFree(page, panel);
    await page.evaluate(() => {
      const w = window as unknown as { __hatPid?: number };
      document.addEventListener(
        'pointerdown',
        (e) => {
          if ((e.target as Element).closest?.('[data-nav="hat"]')) w.__hatPid = e.pointerId;
        },
        true,
      );
    });
    const at = await centreOf(hat(page));
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x - JOG_FULL_PX, at.y, 6);
    await hold(page, 200);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'jog');
    await page.evaluate(() => document.querySelector('[data-nav="hat"]')!.releasePointerCapture((window as unknown as { __hatPid: number }).__hatPid));
    await f.to(1, at.x - 200, at.y - 150, 6);
    await f.up(1);
    await settle(page, 200);
    const a = await cameraOf(page);
    await hold(page, 800);
    expect(await cameraOf(page), 'nothing moving after the lift').toEqual(a);
    expect(await page.locator('.cabinet-scene').getAttribute('data-gesture')).toBeNull();
    expect(await hat(page).getAttribute('data-jogging')).toBeNull();
    // and the hat takes the next press
    await f.down(2, at.x, at.y);
    await f.to(2, at.x + JOG_FULL_PX, at.y, 6);
    await hold(page, 300);
    expect((await cameraOf(page)).x, 'the next drag moves the eye').toBeGreaterThan(a.x);
    await f.up(2);
  });
}

// --- what stands round them ------------------------------------------------------------------------------------------------

test('NAV-FLOAT: the three headers stand together at the centre of the strip, a thumb\'s width each; a fourth and a fifth still fit, on the cover and a 412 px phone', async ({ page }) => {
  await openFree(page, COVER);
  for (const size of [COVER, CASE_VIEWPORTS.find((v) => v.name === 'android')!]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page, 200);
    const three = await boxesOf(page, '.case-tabs > [data-tab]');
    expect(three).toHaveLength(3);
    const mid = (three[0].x + three[2].x + three[2].width) / 2;
    expect(mid, `${size.name}: centred`).toBeCloseTo(size.width / 2, 0);
    for (const b of three) expect(b.width, `${size.name}: a header's width`).toBe(112);
    // two more headers (later panels): cloned in, all five fit the strip side by side
    await page.evaluate(() => {
      const strip = document.querySelector('.case-tabs')!;
      const last = strip.querySelector('[data-tab="refine"]')!;
      for (const name of ['four', 'five']) {
        const more = last.cloneNode(true) as HTMLElement;
        more.dataset.tab = name;
        more.dataset.extra = '1';
        last.after(more);
      }
    });
    const five = await boxesOf(page, '.case-tabs > [data-tab]');
    expect(five).toHaveLength(5);
    expect(five[0].x, `${size.name}: five start inside the window`).toBeGreaterThanOrEqual(0);
    expect(five[4].x + five[4].width, `${size.name}: five end inside the window`).toBeLessThanOrEqual(size.width);
    for (let i = 1; i < five.length; i++) expect(five[i].x, `${size.name}: header ${i} right of the one before`).toBeGreaterThanOrEqual(five[i - 1].x + five[i - 1].width);
    for (const b of five) expect(b.width, `${size.name}: five headers, each a thumb's target`).toBeGreaterThanOrEqual(48);
    const labels = await page.locator('.case-tabs > [data-tab] span').evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).display === 'inline'));
    expect(labels.every(Boolean)).toBe(true);
    await page.evaluate(() => document.querySelectorAll('.case-tabs > [data-extra]').forEach((e) => e.remove()));
  }
});

test('NAV-FLOAT: Reset view and the do-not-fit chip stand inboard of the two controls, each still the top element at its own centre and tapped', async ({ page }) => {
  // fxonly=spike: figures that do not fit, so the chip shows
  await openFree(page, COVER, { query: 'fx=40&fxmisfit=1' });
  // NAV-SCOPE: Reset view is zoom-only: a pinch on the scene shows it
  const s = (await page.locator('.cabinet-scene').boundingBox())!;
  const m = { x: s.x + s.width / 2, y: s.y + s.height * 0.4 };
  await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 60, y: m.y }, { x: m.x + 60, y: m.y });
  await settle(page);
  const reset = page.locator('.cabinet-scene__reset');
  await expect(reset).toBeVisible({ timeout: 5000 });
  const h = (await hat(page).boundingBox())!;
  const r = (await depth(page).boundingBox())!;
  const chip = (await reset.boundingBox())!;
  expect(chip.x + chip.width, 'Reset view left of the hat').toBeLessThanOrEqual(h.x - 8);
  expect(chip.x, 'Reset view right of the rail').toBeGreaterThanOrEqual(r.x + r.width);
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.closest('.cabinet-scene__reset') !== null, { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 });
  expect(top, 'Reset view is the top element at its centre').toBe(true);
  expect(await zoomOf(page), 'pinched').toBeGreaterThan(1);
  const pinched = await cameraOf(page);
  await reset.tap();
  await settle(page, 600);
  expect(await zoomOf(page), 'Reset view took the tap: the zoom is cleared').toBe(1);
  expect(await cameraOf(page), 'and the eye stays where it was').toEqual(pinched);
  const misfit = page.locator('.cabinet-scene__misfit');
  if ((await misfit.count()) > 0) {
    const m = (await misfit.boundingBox())!;
    expect(m.x, 'the do-not-fit chip right of the rail\'s target').toBeGreaterThanOrEqual(r.x + r.width);
    expect(m.x + m.width, 'and left of the hat').toBeLessThanOrEqual(h.x);
  }
});

test('NAV-FLOAT fold8-open: beside the Info pane the hat stays over the case, 20 px inside its column, and still drives', async ({ page }) => {
  await openFree(page, OPEN);
  const wide = (await hat(page).boundingBox())!;
  expect(wide.x + wide.width).toBeCloseTo(OPEN.width - NAV_EDGE_PX, 1);
  // a figure clear of both controls opens the pane beside the case
  const figure = await page.evaluate(() => {
    for (const b of document.querySelectorAll<HTMLElement>('button.cab-figure')) {
      const box = b.getBoundingClientRect();
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      if (document.elementFromPoint(x, y)?.closest('button.cab-figure') === b) return { x, y };
    }
    return null;
  });
  expect(figure).not.toBeNull();
  await touchTap(page, figure!.x, figure!.y);
  await expect(page.locator('.detail-pane')).toBeVisible();
  await settle(page, 400);
  const col = (await page.locator('.page-collection__grid-col').boundingBox())!;
  const pane = (await page.locator('.detail-pane').boundingBox())!;
  const h = (await hat(page).boundingBox())!;
  expect(col.x + col.width, 'the pane took part of the width').toBeLessThan(OPEN.width - 100);
  expect(h.x + h.width, 'the hat keeps to the case\'s column').toBeCloseTo(col.x + col.width - NAV_EDGE_PX, 1);
  expect(h.x + h.width, 'never over the pane').toBeLessThanOrEqual(pane.x);
  const c0 = await cameraOf(page);
  const at = await centreOf(hat(page));
  const f = await touchFingers(page);
  await f.down(1, at.x, at.y);
  await f.to(1, at.x - JOG_FULL_PX, at.y, 6);
  await hold(page, 400);
  await f.up(1);
  await settle(page);
  expect((await cameraOf(page)).x, 'it drives from there').toBeLessThan(c0.x - 20);
  // the pane closed, the hat is back at the window's edge
  await page.locator('.detail-pane').getByRole('button', { name: /close/i }).first().click();
  await expect(page.locator('.detail-pane')).toHaveCount(0);
  await settle(page, 400);
  const back = (await hat(page).boundingBox())!;
  expect(back.x + back.width).toBeCloseTo(OPEN.width - NAV_EDGE_PX, 1);
});

test('NAV-FLOAT: while the View card is open the controls are away (they would float over it); closed, they are back; a stored order with the old Reserved slot keeps its swapped sides', async ({ page }) => {
  await openFree(page, COVER, { prefs: { tabOrder: ['refine', 'info', 'reserved', 'view'], depthRocker: 'horizontal' } });
  // (e) in the browser: swapped then, swapped now, and the Z rail is the vertical one whatever was stored
  expect(await page.locator('.case-tabs > [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab))).toEqual(['refine', 'info', 'view']);
  await expect(depth(page)).toHaveAttribute('aria-orientation', 'vertical');
  const railAt = await centreOf(depth(page));
  const hatAt = await centreOf(hat(page));
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('.bottom-sheet')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Depth control' })).toHaveCount(0);
  // nothing floats over the card: where the rail and the hat were, the card or its backdrop is the top element
  await expect(navControls(page)).toHaveCount(0);
  const tops = await page.evaluate((points) => points.map(({ x, y }) => document.elementFromPoint(x, y)!.closest('.bottom-sheet, .bottom-sheet__backdrop') !== null), [railAt, hatAt]);
  expect(tops).toEqual([true, true]);
  const c0 = await cameraOf(page);
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  expect(await cameraOf(page)).toEqual(c0);
  await expect(navControls(page)).toHaveCount(2);
  // swapped back with the card's button, and kept through a reload
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Swap tab sides' }).click();
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  expect(await page.locator('.case-tabs > [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab))).toEqual(['view', 'info', 'refine']);
  await page.reload();
  await ready(page);
  expect(await page.locator('.case-tabs > [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab))).toEqual(['view', 'info', 'refine']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fc-case-prefs')!) as Record<string, unknown>);
  expect(stored.tabOrder).toEqual(['view', 'info', 'refine']);
  expect('depthRocker' in stored).toBe(false);
});

// chal1 S7: the hat is in document.body above the header. NAV-SCOPE took the Case views menu away (Case is a plain mode
// button), so no header menu drops over the case: a tap on Case opens nothing, and the controls stay where they were
for (const panel of FOLD8) {
  test(`NAV-FLOAT ${panel.name}: a tap on the header's Case button opens no menu and leaves both controls in place`, async ({ page }) => {
    await openFree(page, panel);
    await expect(navControls(page)).toHaveCount(2);
    const before = await navControls(page).evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect())));
    const caseButton = page.getByRole('button', { name: 'Case', exact: true });
    const b = (await caseButton.boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? 'not a button', at)).toBe('Case');
    await touchTap(page, at.x, at.y);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(navControls(page)).toHaveCount(2);
    expect(await navControls(page).evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect())))).toEqual(before);
  });
}

// chal1 item 4 / S3: no figure in view at the opening is under the controls alone. An 8 x 8 grid over each figure's visible
// box: a figure none of whose points is its own while some are a control's (or the tabs') cannot be tapped. Base: 0 on
// every panel; with the 120 px ring by width alone the cover held sideways had 30 of 139 and the open panel 12 of 122.
const NAV_FLOAT_COVERS =
  'NAV-FLOAT-COVERS: on a short scene the hat lies wholly over some figures at the opening view, and no ring size clears them ' +
  '(fix1, ring forced on ad1a3fb: sideways 25 at 104 px, 11 at 80; open 8 at 104, 3 at 80). A decision for the desk.';
const SHORT = ['fold8-cover-sideways', 'fold8-open'];
for (const panel of FOLD8) {
  test(`NAV-FLOAT ${panel.name}: at the opening view every figure in view can still be tapped somewhere (none lies wholly under the controls)`, async ({ page }) => {
    test.fail(SHORT.includes(panel.name), NAV_FLOAT_COVERS);
    await openFree(page, panel);
    await expect(navControls(page)).toHaveCount(2);
    const { inView, untappable } = await page.evaluate(() => {
      const scene = document.querySelector('.cabinet-scene')!.getBoundingClientRect();
      let inView = 0;
      const untappable: string[] = [];
      for (const fig of document.querySelectorAll<HTMLElement>('button.cab-figure')) {
        const b = fig.getBoundingClientRect();
        const x0 = Math.max(b.left, scene.left, 0);
        const x1 = Math.min(b.right, scene.right, innerWidth);
        const y0 = Math.max(b.top, scene.top, 0);
        const y1 = Math.min(b.bottom, scene.bottom, innerHeight);
        if (x1 - x0 < 2 || y1 - y0 < 2) continue;
        inView++;
        let own = 0;
        let covered = 0;
        for (let i = 0; i < 8; i++)
          for (let j = 0; j < 8; j++) {
            const el = document.elementFromPoint(x0 + ((i + 0.5) * (x1 - x0)) / 8, y0 + ((j + 0.5) * (y1 - y0)) / 8);
            if (el?.closest('button.cab-figure') === fig) own++;
            else if (el && !el.closest('.cabinet-scene')) covered++;
          }
        if (own === 0 && covered > 0) untappable.push(fig.getAttribute('aria-label') ?? '?');
      }
      return { inView, untappable };
    });
    console.log(`NAV-UNTAPPABLE ${panel.name}: ${untappable.length} of ${inView} in view`);
    expect(inView, 'figures in view').toBeGreaterThan(20);
    expect(untappable, `of ${inView} in view`).toEqual([]);
  });
}

// chal1 S5 (plan U3 Screenshots): the scene shots mask the controls, so this pins their own look, unmasked: the rail and
// the hat at rest over the opening view, one shot per Fold8 panel, clipped to the box round both
for (const panel of FOLD8) {
  test(`NAV-FLOAT ${panel.name}: the control cluster's look at rest, unmasked`, async ({ page }) => {
    await openFree(page, panel);
    await expect(navControls(page)).toHaveCount(2);
    const clip = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('[data-nav]')).map((e) => e.getBoundingClientRect());
      const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.left)) - 8));
      const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.top)) - 8));
      const x1 = Math.min(innerWidth, Math.ceil(Math.max(...boxes.map((b) => b.right)) + 8));
      const y1 = Math.min(innerHeight, Math.ceil(Math.max(...boxes.map((b) => b.bottom)) + 8));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
    await expect(page).toHaveScreenshot(`nav-cluster-${panel.name}.png`, { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10, threshold: 0.05, clip });
  });
}

// --- a mouse-only desktop --------------------------------------------------------------------------------------------------

test.describe('a mouse-only desktop', () => {
  test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  const DESKTOP = { width: 1536, height: 730 };

  test('NAV-FLOAT desktop: both controls show, drawn smaller; a mouse drag on the hat moves the eye, one on the Z rail brings it closer, and neither clicks a figure', async ({ page }) => {
    await openFree(page, DESKTOP);
    const h = (await hat(page).boundingBox())!;
    const r = (await depth(page).boundingBox())!;
    const scene = (await page.locator('.cabinet-scene').boundingBox())!;
    const ring = Math.min(scene.width, scene.height) >= HAT_RING_PX.wideFrom ? HAT_RING_PX.wide : HAT_RING_PX.compact;
    expect(h.width, 'the ring (by the case\'s shorter side), scaled').toBeCloseTo(ring * NAV_MOUSE_SCALE, 1);
    expect(r.width, 'the rail\'s target, scaled').toBeCloseTo(DEPTH_RAIL_PX.hitWidth * NAV_MOUSE_SCALE, 1);
    expect(h.x + h.width / 2).toBeGreaterThan(DESKTOP.width / 2);
    expect(r.x + r.width / 2).toBeLessThan(DESKTOP.width / 2);
    const start = await cameraOf(page);
    const at = await centreOf(hat(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + (JOG_FULL_PX * i) / 6, at.y);
    await hold(page, 500);
    await expect(hat(page)).toHaveAttribute('data-jogging', '');
    await page.mouse.up();
    await settle(page);
    const walked = await cameraOf(page);
    expect(walked.x, 'the drag on the hat moved the eye right').toBeGreaterThan(start.x);
    expect(walked.z).toBe(start.z);
    const railAt = await centreOf(depth(page));
    await page.mouse.move(railAt.x, railAt.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(railAt.x, railAt.y - (DEPTH_FULL_PX * i) / 6);
    await hold(page, 500);
    await expect(depth(page)).toHaveAttribute('data-rocking', '');
    await page.mouse.up();
    await settle(page);
    const closer = await cameraOf(page);
    expect(closer.z, 'the drag on the rail brought the eye closer').toBeLessThan(walked.z - 20);
    expect(closer.x).toBe(walked.x);
    // a plain click on either starts nothing and opens nothing
    await page.mouse.click(at.x, at.y);
    await page.mouse.click(railAt.x, railAt.y);
    await settle(page, 300);
    expect(await cameraOf(page)).toEqual(closer);
    await expect(info(page)).toHaveCount(0);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  });
});
