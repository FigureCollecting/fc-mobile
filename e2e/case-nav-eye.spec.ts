import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown, touchFingers, touchPinch, touchTap } from './touch';
import { centreOf, depth, eye, hat } from './navControls';
import { lookDown } from './sceneLook';
import { DEPTH_FULL_PX } from '../src/components/display/caseDepth';
import { JOG_DEAD_PX, JOG_FULL_PX, JOG_MAX_STEP_MS } from '../src/components/display/casePose';
import { EYE_HIT_PX, HAT_DOUBLE_TAP } from '../src/components/display/navTuning';

/**
 * NAV-EYE (handoff FINAL 11-17 B; Ross NAVLOOK 1a 2a 3b), in Chromium at the Fold8's cover and open panels through its own
 * touch pipeline (CDP touches), and on a mouse-only desktop: the eye on the hat's upper-left shoulder latches the hat
 * Move <-> Look; in Look the hat turns the eye by rate, through the scene's own limits, and the Z rail still dollies.
 * (a) a tap latches Look and the hat turns; (b) a still press on the hat toggles nothing; (c) Look and Z together;
 * (d) a tap while the hat is held changes the next press only; (e) a desktop mouse; (f) the eye never takes a figure's tap
 * beside it; (g) a reload is Move. 1a: a finger's still hold on the scene no longer Looks (a right drag still does).
 * 2a: the eye pressed and slid onto the hat Looks while held. 3b: two short, still taps on the hat toggle.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const OPEN = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open')!;
const PANELS = [COVER, OPEN];
const DEG = Math.PI / 180;

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

async function openFree(page: Page, size: { width: number; height: number }, query = 'fx=40') {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0 }));
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&${query}`);
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
const yawDeg = async (page: Page) => ((await cameraOf(page)).yaw ?? 0) / DEG;
const coneOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-cone'))!) as { soft: number; hard: number };
const info = (page: Page) => page.locator('.pswp, .detail-pane');
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;

/** A finger's tap on the eye (CDP touch at its centre). */
const tapEye = async (page: Page) => {
  const at = await centreOf(eye(page));
  await touchTap(page, at.x, at.y);
};

/** A thumb on the hat's centre, dragged by (dx, dy), held `ms`, lifted. */
async function hatBy(page: Page, dx: number, dy: number, ms = 400) {
  const at = await centreOf(hat(page));
  const thumb = await touchDown(page, at.x, at.y);
  await thumb.to(at.x + dx, at.y + dy, 6, 16);
  await hold(page, ms);
  await thumb.end();
  await settle(page);
}

for (const panel of PANELS) {
  test(`NAV-EYE (a) ${panel.name}: one tap on the eye latches Look (aria-pressed, the hat's mode and label); the next hat drag turns the eye where it stands; a second tap is Move again`, async ({ page }) => {
    await openFree(page, panel);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(eye(page)).toHaveAccessibleName('Look mode');
    await expect(hat(page)).toHaveAttribute('data-mode', 'move');
    const start = await cameraOf(page);
    await tapEye(page);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(hat(page)).toHaveAttribute('data-mode', 'look');
    await expect(hat(page)).toHaveAttribute('aria-label', /look around/i);
    expect(await cameraOf(page), 'the tap moved nothing').toEqual(start);
    // push right: the eye turns right (yaw +), and stands where it was
    await hatBy(page, JOG_FULL_PX / 2, 0, 600);
    const turned = await cameraOf(page);
    expect(turned.yaw, 'turned right').toBeGreaterThan(0);
    expect([turned.x, turned.y, turned.z], 'stood still').toEqual([start.x, start.y, start.z]);
    await expect(info(page)).toHaveCount(0);
    await tapEye(page);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
    await hatBy(page, JOG_FULL_PX / 2, 0, 400);
    const walked = await cameraOf(page);
    expect(walked.x, 'Move again: the hat walks').toBeGreaterThan(turned.x);
  });

  test(`NAV-EYE (c) ${panel.name}: in Look, the Z rail still dollies while the hat turns (two thumbs at once)`, async ({ page }) => {
    await openFree(page, panel);
    await tapEye(page);
    await expect(hat(page)).toHaveAttribute('data-mode', 'look');
    const start = await cameraOf(page);
    const h = await centreOf(hat(page));
    const r = await centreOf(depth(page));
    const f = await touchFingers(page);
    await f.down(1, h.x, h.y);
    await f.down(2, r.x, r.y);
    await f.to(1, h.x - JOG_FULL_PX / 2, h.y, 6);
    await f.to(2, r.x, r.y - DEPTH_FULL_PX / 2, 6);
    await hold(page, 700);
    await f.up(1);
    await f.up(2);
    await settle(page);
    const after = await cameraOf(page);
    expect(after.yaw, 'the hat turned left').toBeLessThan(0);
    expect(after.z, 'the rail brought the eye closer').toBeLessThan(start.z - 10);
    await expect(info(page)).toHaveCount(0);
  });
}

// --- the eye's shape (Ross 11-22, "fused"): wholly outside the ring, its bubble's arc meeting the ring's outer perimeter ---

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** How far apart two boxes are (0 where they touch or overlap). */
const gapOf = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width)), Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height)));

/**
 * The fused outline as Chromium lays it out: the hat's and the eye's boxes, the glyph's, the outline's subpaths, and 720
 * points along it (getPointAtLength through the path's screen matrix), each with its distance from the hat's centre and
 * from the eye's; and what takes a touch at the probes: the eye's centre, 4 px inside the bubble toward the hat, a point
 * of the ring 4 px outside the bubble, and 8 px outside the bubble, straight out from the hat.
 */
async function shapeOf(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().toJSON() as Rect;
    const h = box('[data-nav="hat"]');
    const e = box('[data-nav="eye"]');
    const g = box('.nav-eye__glyph');
    const hc = { x: h.x + h.width / 2, y: h.y + h.height / 2, r: h.width / 2 };
    const ec = { x: e.x + e.width / 2, y: e.y + e.height / 2, r: e.width / 2 };
    const path = document.querySelector<SVGPathElement>('.nav-hat__outline');
    const d = path?.getAttribute('d') ?? '';
    const points: { x: number; y: number; dh: number; de: number }[] = [];
    let step = 0;
    if (path) {
      const m = path.getScreenCTM()!;
      const len = path.getTotalLength();
      step = (len * m.a) / 720;
      for (let i = 0; i < 720; i++) {
        const p = path.getPointAtLength((len * i) / 720).matrixTransform(m);
        points.push({ x: p.x, y: p.y, dh: Math.hypot(p.x - hc.x, p.y - hc.y), de: Math.hypot(p.x - ec.x, p.y - ec.y) });
      }
    }
    // the seam (the references): the ring's arc under the eye, its own path
    const seamPath = document.querySelector<SVGPathElement>('.nav-hat__seam');
    const gc = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const seam: { x: number; y: number; dh: number; de: number; dg: number }[] = [];
    if (seamPath) {
      const m = seamPath.getScreenCTM()!;
      const len = seamPath.getTotalLength();
      for (let i = 0; i <= 60; i++) {
        const p = seamPath.getPointAtLength((len * i) / 60).matrixTransform(m);
        seam.push({ x: p.x, y: p.y, dh: Math.hypot(p.x - hc.x, p.y - hc.y), de: Math.hypot(p.x - ec.x, p.y - ec.y), dg: Math.hypot(p.x - gc.x, p.y - gc.y) });
      }
    }
    const seamStroke = seamPath ? getComputedStyle(seamPath).stroke : '';
    const outlineStroke = path ? getComputedStyle(path).stroke : '';
    const what = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-nav="eye"]') ? 'eye' : el?.closest('[data-nav="hat"]') ? 'hat' : el?.closest('[data-nav]') ? 'nav' : 'scene';
    };
    // unit vector from the hat's centre out through the eye's
    const k = Math.hypot(ec.x - hc.x, ec.y - hc.y);
    const u = { x: (ec.x - hc.x) / k, y: (ec.y - hc.y) / k };
    // a point of the ring (2 px in from its edge) 4 px outside the bubble: on the circle of radius hc.r - 2 round the hat's
    // centre, at distance ec.r + 4 from the eye's (the law of cosines gives its angle off the eye's direction)
    const rr = hc.r - 2;
    const want = ec.r + 4;
    const off = Math.acos((rr * rr + k * k - want * want) / (2 * rr * k));
    const base = Math.atan2(u.y, u.x);
    const ring4 = { x: hc.x + rr * Math.cos(base + off), y: hc.y + rr * Math.sin(base + off) };
    return {
      h,
      e,
      g,
      hc,
      ec,
      d,
      points,
      step,
      seam,
      seamStroke,
      outlineStroke,
      probes: {
        centre: what(ec.x, ec.y),
        inside4: what(ec.x - u.x * (ec.r - 4), ec.y - u.y * (ec.r - 4)),
        ring4: what(ring4.x, ring4.y),
        ring4At: Math.hypot(ring4.x - ec.x, ring4.y - ec.y),
        out8: what(ec.x + u.x * (ec.r + 8), ec.y + u.y * (ec.r + 8)),
      },
      view: { width: innerWidth, height: innerHeight },
    };
  });
}

function expectFused(s: Awaited<ReturnType<typeof shapeOf>>, what: string) {
  // the eye glyph's bounding circle lies wholly outside the ring's outer radius
  const gc = { x: s.g.x + s.g.width / 2, y: s.g.y + s.g.height / 2 };
  const glyphR = Math.hypot(s.g.width, s.g.height) / 2;
  expect(Math.hypot(gc.x - s.hc.x, gc.y - s.hc.y) - glyphR, `${what}: the glyph clear of the ring`).toBeGreaterThan(s.hc.r);
  expect(Math.hypot(gc.x - s.ec.x, gc.y - s.ec.y), `${what}: the glyph centred in the bubble`).toBeLessThanOrEqual(0.5);
  // at the upper-left, inboard shoulder, and the bubble's centre outside the ring (more than a semicircle shows)
  expect((Math.atan2(s.hc.y - s.ec.y, s.ec.x - s.hc.x) * 180) / Math.PI, `${what}: at 135 degrees`).toBeCloseTo(135, 0);
  expect(Math.hypot(s.ec.x - s.hc.x, s.ec.y - s.hc.y), `${what}: the bubble's centre`).toBeGreaterThan(s.hc.r);
  // one closed path; every point of it on the ring (outside the bubble) or on the bubble (outside the ring): the ring's
  // arc inside the bubble is not drawn, and nothing crosses the eye
  expect(s.d.match(/[Mm]/g), `${what}: one subpath`).toHaveLength(1);
  expect(s.d.trim().endsWith('Z'), `${what}: closed`).toBe(true);
  const onRing = s.points.filter((p) => p.dh <= s.hc.r && p.dh >= s.hc.r - 1.5);
  const onBubble = s.points.filter((p) => p.de <= s.ec.r && p.de >= s.ec.r - 1.5);
  const stray = s.points.filter((p) => !onRing.includes(p) && !onBubble.includes(p));
  expect(stray, `${what}: every point on the ring or the bubble`).toEqual([]);
  expect(onRing.filter((p) => p.de < s.ec.r - 1.5), `${what}: no ring inside the bubble`).toEqual([]);
  expect(onBubble.filter((p) => p.dh < s.hc.r - 1.5), `${what}: no bubble inside the ring`).toEqual([]);
  expect(onRing.length, `${what}: most of it the ring`).toBeGreaterThan(360);
  expect(onBubble.length, `${what}: the bubble's arc`).toBeGreaterThan(72);
  // the joins: points a 720th of the length apart never jump, round the end back to the start too (one continuous
  // outline: the bubble's arc meets the ring's within 0.5 px)
  const jumps = s.points.map((p, i) => Math.hypot(p.x - s.points[(i + 1) % s.points.length].x, p.y - s.points[(i + 1) % s.points.length].y));
  expect(Math.max(...jumps), `${what}: no gap in the outline`).toBeLessThanOrEqual(s.step + 0.5);
  // the seam (Ross 11-22, "like this image"): the ring's arc inside the bubble, in the ring's stroke, from one join of the
  // outline to the other, passing straight under the glyph; the glyph clears it
  expect(s.seam.length, `${what}: the seam is drawn`).toBe(61);
  expect(s.seamStroke, `${what}: in the ring's stroke`).toBe(s.outlineStroke);
  for (const q of s.seam) {
    expect(Math.abs(q.dh - (s.hc.r - 0.9)), `${what}: the seam on the ring`).toBeLessThanOrEqual(0.5);
    expect(q.de, `${what}: the seam inside the bubble`).toBeLessThanOrEqual(s.ec.r);
    expect(q.dg - glyphR, `${what}: the glyph clears the seam`).toBeGreaterThan(0.75);
  }
  const joinGap = (q: { x: number; y: number }) => Math.min(...s.points.map((p) => Math.hypot(p.x - q.x, p.y - q.y)));
  expect(joinGap(s.seam[0]), `${what}: the seam starts on the outline`).toBeLessThanOrEqual(s.step / 2 + 0.5);
  expect(joinGap(s.seam[s.seam.length - 1]), `${what}: and ends on it`).toBeLessThanOrEqual(s.step / 2 + 0.5);
  const under = { x: s.hc.x + ((gc.x - s.hc.x) * (s.hc.r - 0.9)) / Math.hypot(gc.x - s.hc.x, gc.y - s.hc.y), y: s.hc.y + ((gc.y - s.hc.y) * (s.hc.r - 0.9)) / Math.hypot(gc.x - s.hc.x, gc.y - s.hc.y) };
  expect(Math.min(...s.seam.map((q) => Math.hypot(q.x - under.x, q.y - under.y))), `${what}: it passes straight under the glyph`).toBeLessThanOrEqual(1);
  // what takes a touch: the bubble is the eye's, over the ring inside it; the ring outside it the hat's; beyond it the scene's
  expect(s.probes, `${what}: hit-testing`).toMatchObject({ centre: 'eye', inside4: 'eye', ring4: 'hat', out8: 'scene' });
  expect(s.probes.ring4At, `${what}: the ring probe 4 px outside the bubble`).toBeCloseTo(s.ec.r + 4, 1);
  // the eye inside the window
  expect(s.e.x, `${what}: inside the window`).toBeGreaterThanOrEqual(0);
  expect(s.e.y, `${what}: inside the window`).toBeGreaterThanOrEqual(0);
  expect(s.e.x + s.e.width, `${what}: inside the window`).toBeLessThanOrEqual(s.view.width);
  expect(s.e.y + s.e.height, `${what}: inside the window`).toBeLessThanOrEqual(s.view.height);
}

/** The eye clear of the scene's top (the header), the case-tabs strip and the Reset view chip (with its 48 px target). */
async function expectClear(page: Page, what: string) {
  const reset = page.locator('.cabinet-scene__reset');
  await expect(reset, `${what}: Reset view shows once zoomed`).toBeVisible({ timeout: 5000 });
  const e = (await eye(page).boundingBox())!;
  const chip = (await reset.boundingBox())!;
  const target = { x: chip.x - 4, y: chip.y - 4, width: chip.width + 8, height: chip.height + 8 };
  const strip = (await page.locator('.case-tabs').boundingBox())!;
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  console.log(`NAV-EYE-CLEAR ${what} eye ${JSON.stringify(e)} chip ${JSON.stringify(chip)} gap ${gapOf(e, target).toFixed(1)}`);
  expect(overlaps(e, target), `${what}: clear of Reset view`).toBe(false);
  expect(overlaps(e, strip), `${what}: clear of the case tabs`).toBe(false);
  expect(e.y, `${what}: under the scene's top`).toBeGreaterThanOrEqual(scene.y);
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)!.closest('.cabinet-scene__reset') !== null, { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 });
  expect(top, `${what}: Reset view still the top element at its centre`).toBe(true);
}

for (const panel of CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'))) {
  test(`NAV-EYE shape ${panel.name}: the eye wholly outside the ring in one fused outline; the bubble is the eye's, the ring outside it the hat's; clear of the window's edges, the tabs and Reset view`, async ({ page }) => {
    await openFree(page, panel);
    expectFused(await shapeOf(page), panel.name);
    // Look: the same outline, teal on the whole of it (the bubble's arc with the ring's)
    await tapEye(page);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
    const stroke = await page.locator('.nav-hat__outline').evaluate((p) => getComputedStyle(p).stroke);
    const teal = await eye(page).evaluate((b) => getComputedStyle(b).color);
    expect(stroke, `${panel.name}: Look's teal on the outline, the eye glyph's`).toBe(teal);
    expect(teal).toMatch(/^rgba\(57, 198, 179, 0\.75\)$/);
    expectFused(await shapeOf(page), `${panel.name} look`);
    await tapEye(page);
    // Reset view (zoom-only): a pinch shows it
    const s = (await page.locator('.cabinet-scene').boundingBox())!;
    const m = { x: s.x + s.width / 2, y: s.y + s.height * 0.4 };
    await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 60, y: m.y }, { x: m.x + 60, y: m.y });
    await settle(page);
    await expectClear(page, panel.name);
  });
}

test('NAV-EYE (b): a 600 ms still press on the hat centre toggles nothing and moves nothing', async ({ page }) => {
  await openFree(page, COVER);
  const start = await cameraOf(page);
  const at = await centreOf(hat(page));
  const thumb = await touchDown(page, at.x, at.y);
  await page.waitForTimeout(600);
  await thumb.end();
  await settle(page);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(hat(page)).toHaveAttribute('data-mode', 'move');
  expect(await cameraOf(page)).toEqual(start);
});

test('NAV-EYE (d): an eye tap while a thumb holds the hat leaves the running Move as it is; the next press turns', async ({ page }) => {
  await openFree(page, COVER);
  const start = await cameraOf(page);
  const h = await centreOf(hat(page));
  const e = await centreOf(eye(page));
  const f = await touchFingers(page);
  await f.down(1, h.x, h.y);
  await f.to(1, h.x + JOG_FULL_PX / 2, h.y, 6);
  await hold(page, 300);
  const mid = await cameraOf(page);
  expect(mid.x).toBeGreaterThan(start.x);
  await f.down(2, e.x, e.y);
  await f.up(2);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await hold(page, 400);
  const still = await cameraOf(page);
  expect(still.x, 'the jog runs on').toBeGreaterThan(mid.x);
  expect(still.yaw ?? 0, 'and never turns').toBe(0);
  await f.up(1);
  await settle(page);
  const stopped = await cameraOf(page);
  await hatBy(page, -JOG_FULL_PX / 2, 0, 500);
  const turned = await cameraOf(page);
  expect(turned.yaw, 'the next press turns').toBeLessThan(0);
  expect(turned.x).toBe(stopped.x);
});

test('NAV-EYE: the hat held left in Look for 3 s: the yaw stays under the hard limit; let go it eases back to the soft limit', async ({ page }) => {
  test.setTimeout(60_000);
  await openFree(page, COVER);
  const cone = await coneOf(page);
  await tapEye(page);
  const at = await centreOf(hat(page));
  const thumb = await touchDown(page, at.x, at.y);
  await thumb.to(at.x - JOG_FULL_PX, at.y, 6, 16);
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    await hold(page, 500);
    seen.push(await yawDeg(page));
  }
  const held = seen[seen.length - 1];
  // chal1 SHOULD-1: pushed back the other way while still held, the view turns back at once (anti-windup: nothing
  // wound up past the cap has to unwind first)
  await thumb.to(at.x + JOG_FULL_PX * 0.5, at.y, 2, 16);
  await hold(page, 200);
  const back = await yawDeg(page);
  await thumb.end();
  // the rubber band (casePose): past soft by `over`, shown at soft + (hard - soft)(1 - e^(-over / (hard - soft))), and
  // over is capped at hard - soft: held hard left it rests at soft + (hard - soft)(1 - 1/e), short of hard
  const rest = cone.soft + (cone.hard - cone.soft) * (1 - Math.exp(-1));
  console.log(`NAV-EYE limit ${JSON.stringify({ cone, seen, rest: -rest, back })}`);
  for (const y of seen) {
    expect(Number.isFinite(y)).toBe(true);
    expect(y, 'never past the hard limit').toBeGreaterThan(-cone.hard - 1e-6);
  }
  expect(held, 'held past the soft limit (the rubber band)').toBeLessThan(-cone.soft);
  expect(held, 'held at the band\'s rest, short of hard').toBeCloseTo(-rest, 2);
  for (const y of seen.slice(1)) expect(y, 'and steady there').toBeCloseTo(-rest, 2);
  expect(back - held, 'pushed back: the view turns back at once').toBeGreaterThan(0.2);
  await page.waitForTimeout(250);
  await settle(page, 300);
  const eased = await yawDeg(page);
  expect(eased, 'eased back to the soft limit').toBeCloseTo(-cone.soft, 1);
});

test('NAV-EYE (f): a tap 8 px outside the eye\'s hit circle opens the figure there; the mode stays as it was', async ({ page }) => {
  test.setTimeout(90_000);
  await openFree(page, COVER, 'fx=170');
  /** Round the eye, a point 8 px outside its hit circle where a figure is the top element and the hat is not. */
  const beside = async () => {
    const e = await centreOf(eye(page));
    return page.evaluate(({ e, r }) => {
      for (let deg = 0; deg < 360; deg += 5) {
        const p = { x: e.x + Math.cos((deg * Math.PI) / 180) * (r + 8), y: e.y - Math.sin((deg * Math.PI) / 180) * (r + 8) };
        const top = document.elementFromPoint(p.x, p.y);
        const fig = top?.closest('button.cab-figure');
        if (fig && !top!.closest('[data-nav]')) return { ...p, deg, name: fig.getAttribute('aria-label') };
      }
      return null;
    }, { e, r });
  };
  // the eye's hit circle is its bubble (NAV-EYE shape): its box's half width, at least EYE_HIT_PX / 2
  const r = ((await eye(page).boundingBox())!).width / 2;
  expect(r).toBeGreaterThanOrEqual(EYE_HIT_PX / 2);
  let found = await beside();
  for (let i = 0; found === null && i < 12; i++) {
    await hatBy(page, i % 2 === 0 ? 30 : 0, i % 2 === 0 ? 0 : -24, 250);
    found = await beside();
  }
  expect(found, 'a figure beside the eye').not.toBeNull();
  console.log(`NAV-EYE beside ${JSON.stringify(found)}`);
  // the eye's own hit circle is what is there 8 px inside it, never the scene
  const e = await centreOf(eye(page));
  const inside = { x: e.x + ((found!.x - e.x) * (r - 8)) / (r + 8), y: e.y + ((found!.y - e.y) * (r - 8)) / (r + 8) };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-nav="eye"]') !== null, inside)).toBe(true);
  await touchTap(page, found!.x, found!.y);
  await expect(info(page)).toHaveCount(1);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
});

test('NAV-EYE (g): Look stays latched across the View card opened and closed; a reload starts in Move', async ({ page }) => {
  await openFree(page, COVER);
  await tapEye(page);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('.bottom-sheet')).toHaveCount(1);
  await expect(hat(page)).toHaveCount(0);
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
  await expect(hat(page)).toHaveCount(1);
  await expect(eye(page), 'latched for the session').toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await ready(page);
  await expect(eye(page), 'a reload is Move').toHaveAttribute('aria-pressed', 'false');
  await expect(hat(page)).toHaveAttribute('data-mode', 'move');
});

test('NAVLOOK 1a: a finger held still 600 ms on the scene then dragged walks the eye and never turns it; a right drag still turns it', async ({ page }) => {
  await openFree(page, COVER);
  const start = await cameraOf(page);
  const f = await frameBox(page);
  const from = { x: f.x + f.width * 0.7, y: f.y + f.height * 0.4 };
  const finger = await touchDown(page, from.x, from.y);
  await page.waitForTimeout(600);
  await expect(page.locator('.cabinet-scene')).not.toHaveAttribute('data-gesture', 'look');
  await expect(page.locator('.cabinet-scene__look-ring[data-on]')).toHaveCount(0);
  await finger.to(from.x - 80, from.y, 8, 16);
  await finger.end();
  await settle(page);
  const walked = await cameraOf(page);
  expect(walked.x, 'walked').toBeGreaterThan(start.x);
  expect([walked.yaw ?? 0, walked.pitch], 'never turned').toEqual([0, 0]);
  await expect(info(page)).toHaveCount(0);
  const look = await lookDown(page, from.x, from.y);
  await look.to(from.x - 80, from.y);
  await look.end();
  await settle(page);
  const turned = await cameraOf(page);
  expect(turned.yaw, 'the right drag turned the eye').toBeGreaterThan(0);
  expect(turned.x).toBe(walked.x);
});

test('NAVLOOK 2a: the eye pressed and slid onto the hat Looks while held (Move latched); the lift is Move again', async ({ page }) => {
  await openFree(page, COVER);
  const start = await cameraOf(page);
  const e = await centreOf(eye(page));
  const h = await centreOf(hat(page));
  const f = await touchFingers(page);
  await f.down(1, e.x, e.y);
  // onto the hat, past its centre: the hat takes the finger where it came clear of the eye
  await f.to(1, h.x, h.y, 6);
  await expect(hat(page)).toHaveAttribute('data-mode', 'look');
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  await f.to(1, h.x + JOG_FULL_PX / 2, h.y, 6);
  await hold(page, 600);
  const turned = await cameraOf(page);
  expect(turned.yaw, 'turned while held').toBeGreaterThan(0);
  expect([turned.x, turned.y, turned.z]).toEqual([start.x, start.y, start.z]);
  await f.up(1);
  await settle(page);
  await expect(hat(page)).toHaveAttribute('data-mode', 'move');
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  const rested = await cameraOf(page);
  await hatBy(page, JOG_FULL_PX / 2, 0, 400);
  const walked = await cameraOf(page);
  expect(walked.x, 'the next press walks').toBeGreaterThan(rested.x);
  expect(walked.yaw).toBe(rested.yaw);
});

test('NAVLOOK 3b: two short, still taps on the hat toggle Look and two more Move; taps with travel, or far apart, do not', async ({ page }) => {
  await openFree(page, COVER);
  const at = await centreOf(hat(page));
  const start = await cameraOf(page);
  await touchTap(page, at.x, at.y);
  await page.waitForTimeout(80);
  await touchTap(page, at.x + 2, at.y + 1);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(hat(page)).toHaveAttribute('data-mode', 'look');
  expect(await cameraOf(page), 'the taps moved nothing').toEqual(start);
  await page.waitForTimeout(HAT_DOUBLE_TAP.gapMs + 100);
  await touchTap(page, at.x, at.y);
  await page.waitForTimeout(80);
  await touchTap(page, at.x, at.y);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(HAT_DOUBLE_TAP.gapMs + 100);
  // far apart: two taps, no toggle
  await touchTap(page, at.x, at.y);
  await page.waitForTimeout(HAT_DOUBLE_TAP.gapMs + 200);
  await touchTap(page, at.x, at.y);
  await settle(page, 200);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(HAT_DOUBLE_TAP.gapMs + 100);
  // with travel past 10 px (each a short jog, a steering correction): no toggle
  for (let i = 0; i < 2; i++) {
    const t = await touchDown(page, at.x, at.y);
    await t.to(at.x + JOG_DEAD_PX + 4, at.y, 2, 8);
    await t.end();
    await page.waitForTimeout(60);
  }
  await settle(page, 200);
  await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
});

// --- a mouse-only desktop --------------------------------------------------------------------------------------------------

test.describe('a mouse-only desktop', () => {
  test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  const DESKTOP = { width: 1536, height: 730 };

  test('NAV-EYE shape desktop: drawn smaller, the eye still wholly outside the ring in one fused outline, clear of the edges, the tabs and Reset view', async ({ page }) => {
    await openFree(page, DESKTOP);
    expectFused(await shapeOf(page), 'desktop');
    const f = await frameBox(page);
    await page.mouse.move(f.x + f.width / 2, f.y + f.height * 0.4);
    await page.mouse.wheel(0, -300);
    await settle(page, 600);
    await expectClear(page, 'desktop');
  });

  test('NAV-EYE (e) desktop: a click on the eye latches Look; a mouse drag on the hat turns the eye; right drag on the scene still turns it', async ({ page }) => {
    await openFree(page, DESKTOP);
    const start = await cameraOf(page);
    await eye(page).click();
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
    const at = await centreOf(hat(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x, at.y - (JOG_FULL_PX * i) / 12);
    await hold(page, 500);
    await page.mouse.up();
    await settle(page);
    const looked = await cameraOf(page);
    expect(looked.pitch, 'push up: looked up').not.toBe(start.pitch);
    expect([looked.x, looked.y, looked.z]).toEqual([start.x, start.y, start.z]);
    await expect(info(page)).toHaveCount(0);
    // the keyboard: Enter on the focused eye is Move again
    await eye(page).focus();
    await page.keyboard.press('Enter');
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
    const f = await frameBox(page);
    const look = await lookDown(page, f.x + f.width / 2, f.y + f.height / 2);
    await look.to(f.x + f.width / 2 - 120, f.y + f.height / 2);
    await look.end();
    await settle(page);
    expect((await cameraOf(page)).yaw, 'right drag turns').toBeGreaterThan(looked.yaw ?? 0);
  });
});
