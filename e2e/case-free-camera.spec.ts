import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR, SHOT_VIEWPORTS } from './caseViewports';
import { touchDown } from './touch';
import { watchPull } from './pullWatch';
import { decodePng } from './paintCheck';
import { project, type Camera, type Vec3 } from '../src/components/display/caseCamera';
import { wallLayout } from '../src/components/display/packCabinets';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';
import { JOG_FRAMES_PER_S, JOG_FULL_PX, JOG_MAX_STEP_MS, SPRING_MS } from '../src/components/display/casePose';
import { CONTROLS_VIEWPORTS } from '../src/components/display/caseBudget';

/**
 * NAV-1A, the Free camera (trial), in Chromium at the Fold8's four panels, fixture mode, the KLINGSBO wall. The browser
 * draws the turned camera where `project` says (a post's front face against its projected corners); the pose moves only
 * with a finger (a log of every data-camera write against the finger); the realism cone and its ease back; the Classic
 * cap and the GPU budget held at the hard yaw; no hole where a wall box is; Look's hold through Chromium's own touch
 * pipeline (CDP touches); Next from where you look; Reset; a fold keeping the pose; a desktop's right and Shift drags.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const DEG = Math.PI / 180;
type View = 'wall' | 'cabinet' | 'shelf';
type Swipe = 'camera' | 'pan';

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

async function openFree(page: Page, size: { width: number; height: number }, opts: { view?: View; swipe?: Swipe; query?: string; free?: boolean } = {}) {
  const prefs = { view: opts.view ?? 'wall', swipe: opts.swipe ?? 'camera', clearanceMm: 0, ...(opts.free === false ? {} : { freeCamera: true }) };
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&${opts.query ?? 'fx=40'}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await settle(page, 500);
}

type Published = { x: number; y: number; z: number; yaw?: number; pitch: number; focalPx: number; width: number; height: number };
const toCamera = (c: Published): Camera => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw ?? 0, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } });
const cameraOf = async (page: Page) => toCamera(JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Published);
const coneOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-cone'))!) as { soft: number; hard: number };
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;
const wallOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!) as number[][];
const klingsbo = (n: number) => wallLayout(Array.from({ length: n }, () => IKEA_KLINGSBO));

/** One finger from (x0, y0) to (x1, y1) in `steps` moves 16 ms apart, then held `holdMs` and lifted (unless `lift` is false). */
async function fingerDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, { steps = 10, lift = true, waitMs = 0 } = {}) {
  const finger = await touchDown(page, from.x, from.y);
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  await finger.to(to.x, to.y, steps, 16);
  if (lift) {
    await finger.end();
    await settle(page);
  }
  return finger;
}

/** A turn by `deg` (positive: right) in the header's Look mode: from the frame centre to where its bearing gives the turn. */
async function lookBy(page: Page, deg: number) {
  const f = await frameBox(page);
  const c = await cameraOf(page);
  const cx = f.x + f.width / 2;
  const cy = f.y + f.height / 2;
  await fingerDrag(page, { x: cx, y: cy }, { x: cx - c.focalPx * Math.tan(deg * DEG), y: cy }, { steps: 12 });
  await settle(page, 300);
}

// --- 3: the DOM oracle under yaw ----------------------------------------------------------------------------------------

for (const panel of FOLD8) {
  test(`oracle ${panel.name}: a KLINGSBO post's front face draws where project() puts it, yaw -30..30`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await openFree(page, panel, { swipe: 'pan' });
    const n = (await wallOf(page)).length;
    const wall = klingsbo(n);
    const sec = IKEA_KLINGSBO.base.leg?.sectionMm ?? IKEA_KLINGSBO.panels.sideMm;
    const legTop = IKEA_KLINGSBO.base.heightMm;
    const H = IKEA_KLINGSBO.outer.heightMm;
    const cone = await coneOf(page);
    const log: unknown[] = [];
    let yaw = 0;
    for (const target of [0, 15, 30, 0, -15, -30]) {
      if (target !== yaw) await lookBy(page, target - yaw);
      const camera = await cameraOf(page);
      yaw = camera.yaw! / DEG;
      // the cone keeps a turn short of 30 where the panel's limit is lower: the oracle runs at whatever yaw it reached
      expect(Math.abs(yaw - target), `turned to ${target} (soft ${cone.soft})`).toBeLessThan(Math.abs(target) > cone.soft ? Math.abs(target) - cone.soft + 0.5 : 0.5);
      const f = await frameBox(page);
      const drawn = await page.locator('.cab').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.index)));
      // the drawn post nearest the frame centre, in front of the eye
      const posts = drawn.flatMap((i) =>
        [0, 1].map((k) => {
          const x0 = k === 0 ? wall.cabinets[i].leftMm : wall.cabinets[i].rightMm - sec;
          const corners = ([[x0, legTop, 0], [x0 + sec, legTop, 0], [x0, H, 0], [x0 + sec, H, 0]] as Vec3[]).map((p) => project(camera, p));
          const mid = (corners[0].x + corners[1].x) / 2;
          return { i, k, corners, d: Math.abs(mid - camera.frame.width / 2), front: corners.every((c) => c.depth > 200) };
        }),
      );
      const best = posts.filter((p) => p.front).sort((a, b) => a.d - b.d)[0];
      const box = (await page.locator(`.cab[data-index="${best.i}"] .cab-post`).nth(best.k).locator('.f-front').boundingBox())!;
      const xs = best.corners.map((c) => c.x);
      const ys = best.corners.map((c) => c.y);
      const off = {
        left: box.x - f.x - Math.min(...xs),
        right: box.x + box.width - f.x - Math.max(...xs),
        top: box.y - f.y - Math.min(...ys),
        bottom: box.y + box.height - f.y - Math.max(...ys),
      };
      log.push({ target, yaw: Number(yaw.toFixed(2)), cabinet: best.i, post: best.k, off });
      for (const [side, d] of Object.entries(off)) expect(Math.abs(d), `${side} at yaw ${yaw.toFixed(2)}`).toBeLessThan(1.5);
    }
    await testInfo.attach('oracle', { body: JSON.stringify({ panel: panel.name, cone, log }, null, 1), contentType: 'application/json' });
    console.log(`ORACLE ${panel.name} ${JSON.stringify({ cone, log })}`);
  });
}

// --- 12: Look's hold, through real touches ------------------------------------------------------------------------------

/** A figure whose button stands wholly in the frame, away from its edges: its centre. */
async function figureInFrame(page: Page) {
  const f = await frameBox(page);
  const boxes = await page.locator('button.cab-figure').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  const inside = boxes.filter((b) => b.width > 12 && b.height > 12 && b.x > f.x + 40 && b.x + b.width < f.x + f.width - 40 && b.y > f.y + 20 && b.y + b.height < f.y + f.height - 20);
  inside.sort((a, b) => Math.abs(a.x + a.width / 2 - (f.x + f.width / 2)) - Math.abs(b.x + b.width / 2 - (f.x + f.width / 2)));
  const b = inside[0];
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const opened = (page: Page) => page.locator('.pswp, .detail-pane');

const COVER = FOLD8.find((v) => v.name === 'fold8-cover')!;
const OPEN = FOLD8.find((v) => v.name === 'fold8-open')!;

for (const holdMs of [270, 440]) {
  test(`hold: a ${holdMs} ms still press then release opens the figure under it`, async ({ page }) => {
    await openFree(page, COVER, { view: 'cabinet' });
    const at = await figureInFrame(page);
    const finger = await touchDown(page, at.x, at.y);
    await page.waitForTimeout(holdMs);
    await finger.end();
    await expect(opened(page)).toHaveCount(1);
  });
}

test('hold: 300 ms still, then a 30 px drag turns the eye and opens nothing; the ring shows while held', async ({ page }) => {
  await openFree(page, COVER, { view: 'cabinet' });
  const before = await cameraOf(page);
  const at = await figureInFrame(page);
  const finger = await touchDown(page, at.x, at.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'look');
  await expect(page.locator('.cabinet-scene__look-ring[data-on]')).toBeVisible();
  await finger.to(at.x + 30, at.y, 6, 16);
  await finger.end();
  await settle(page);
  const after = await cameraOf(page);
  expect(after.yaw, 'turned').not.toBe(before.yaw ?? 0);
  expect([after.x, after.y, after.z], 'stood still').toEqual([before.x, before.y, before.z]);
  await expect(page.locator('.cabinet-scene__look-ring[data-on]')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(opened(page)).toHaveCount(0);
});

test('hold: a drag that starts at 100 ms is a MOVE', async ({ page }) => {
  await openFree(page, COVER);
  const before = await cameraOf(page);
  const f = await frameBox(page);
  await fingerDrag(page, { x: f.x + f.width * 0.7, y: f.y + f.height / 2 }, { x: f.x + f.width * 0.3, y: f.y + f.height / 2 }, { waitMs: 100 });
  const after = await cameraOf(page);
  expect(after.x, 'walked').toBeGreaterThan(before.x);
  expect(after.yaw, 'not turned').toBe(0);
});

/**
 * Headless Chromium raises no contextmenu from a CDP touch held 1,000 ms (measured, old path and Free camera alike: a
 * 1.5 s hold gave pointerdown, pointerup and a click), so the menu a phone raises is dispatched here the way Chromium
 * dispatches it: at the finger, on the element under it, after a 1,000 ms hold. The desktop test below has the real one.
 */
test('hold: the contextmenu a 1,000 ms hold raises is prevented on the scene; the browser shows no menu', async ({ page }) => {
  await openFree(page, COVER);
  const f = await frameBox(page);
  const at = { x: f.x + f.width / 2, y: f.y + f.height * 0.6 };
  const finger = await touchDown(page, at.x, at.y);
  await page.waitForTimeout(1000);
  const prevented = await page.evaluate(({ x, y }) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    document.elementFromPoint(x, y)!.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, at);
  await finger.end();
  expect(prevented).toBe(true);
});

// --- 13: the arrows retire (NAV-JOG): the bottom-centre button's jog moves the Free camera ---------------------------------

/** The bottom-centre button while a Free camera case offers its jog. */
const jogButton = (page: Page) => page.locator('.tab-bar__add[data-jog]');

/**
 * NAV-JOG: a thumb down on the bottom-centre button, dragged by (dx, dy) in `steps` moves 16 ms apart, held still
 * `holdMs` (the jog runs on), then lifted unless `lift` is false.
 */
async function jogBy(page: Page, dx: number, dy: number, { holdMs = 0, steps = 6, lift = true } = {}) {
  const b = (await jogButton(page).boundingBox())!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const thumb = await touchDown(page, at.x, at.y);
  await thumb.to(at.x + dx, at.y + dy, steps, 16);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  if (lift) {
    await thumb.end();
    await settle(page);
  }
  return thumb;
}

/** NAV-JOG: held at full reach `dir`-ward until the eye stops (a wall's end holds it: jogOk), at most `maxMs`; lifted. */
async function jogToEnd(page: Page, dir: 1 | -1, maxMs = 40_000) {
  const thumb = await jogBy(page, dir * JOG_FULL_PX, 0, { lift: false });
  const t0 = Date.now();
  let last = NaN;
  for (;;) {
    await page.waitForTimeout(500);
    const x = (await cameraOf(page)).x;
    if (x === last || Date.now() - t0 > maxMs) break;
    last = x;
  }
  await thumb.end();
  await settle(page);
}

/**
 * NAV-JOG: a level jog's speed over the writes logged since startPoseLog, in frame widths a second: picture px at the
 * anchor depth (a level eye's frame centre is on the fronts: its distance, z) over the frame clock's time, each frame
 * counted as the scene counts it (a late one as JOG_MAX_STEP_MS); and by the wall clock, for the record.
 */
async function jogSpeed(page: Page) {
  const w = (await poseLog(page)).writes.filter((x) => x.gesture === 'jog');
  let px = 0;
  let ms = 0;
  let pairs = 0;
  for (let i = 1; i < w.length; i++) {
    const [a, b] = [parse(w[i - 1].camera), parse(w[i].camera)];
    const dt = w[i].frame - w[i - 1].frame;
    if (!(dt > 0)) continue;
    px += ((b.x - a.x) * b.focalPx) / b.z;
    ms += Math.min(dt, JOG_MAX_STEP_MS);
    pairs++;
  }
  const c = parse(w[w.length - 1].camera);
  const travel = ((c.x - parse(w[0].camera).x) * c.focalPx) / c.z;
  return {
    pairs,
    framesPerS: (px / ms) * (1000 / c.frame.width),
    wallClockFramesPerS: (travel / (w[w.length - 1].t - w[0].t)) * (1000 / c.frame.width),
    longestFrameMs: Math.max(...w.slice(1).map((x, i) => x.frame - w[i].frame)),
  };
}

test('NAV-JOG: in Free camera the side arrows are gone and the bottom-centre button is the jog; off, the arrows and the + as they were', async ({ page }) => {
  await openFree(page, COVER);
  await expect(page.locator('.cabinet-scene__step--prev, .cabinet-scene__step--next')).toHaveCount(0);
  await expect(jogButton(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: /move the camera/i })).toHaveCount(1);
  const off = await page.context().newPage();
  await openFree(off, COVER, { free: false });
  await expect(off.locator('.cabinet-scene__step--prev')).toHaveCount(1);
  await expect(off.locator('.cabinet-scene__step--next')).toHaveCount(1);
  await expect(off.locator('.tab-bar__add[data-jog]')).toHaveCount(0);
  await expect(off.getByRole('button', { name: 'Add figures', exact: true })).toHaveCount(1);
  await off.close();
});

const boxesOf = async (page: Page, selector: string) =>
  (await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number })));
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const panel of FOLD8) {
  test(`NAV-JOG ${panel.name}: held, the eye goes the way the thumb holds it and on while it is still, faster the farther; the lift stops it; a tap opens the menu`, async ({ page }) => {
    test.setTimeout(90_000);
    await openFree(page, panel);
    const url = page.url();
    const start = await cameraOf(page);
    // half way to full reach, then full reach, the same time each: the second walks farther
    const half = await jogBy(page, (8 + JOG_FULL_PX) / 2, 0, { holdMs: 600, lift: false });
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'jog');
    const held = (await cameraOf(page)).x;
    await page.waitForTimeout(300);
    const later = (await cameraOf(page)).x;
    expect(later, 'the thumb still, the eye goes on').toBeGreaterThan(held);
    await half.end();
    await settle(page);
    const halfWay = (await cameraOf(page)).x - start.x;
    expect(halfWay).toBeGreaterThan(0);
    const stopped = await cameraOf(page);
    await page.waitForTimeout(400);
    expect(await cameraOf(page), 'the lift stopped it').toEqual(stopped);
    await expect(page.locator('.cabinet-scene')).not.toHaveAttribute('data-gesture', /./);
    // full reach: a frame width a second of picture at the anchor depth, each frame by the time since the last
    const thumb = await jogBy(page, JOG_FULL_PX, 0, { lift: false });
    await startPoseLog(page);
    await page.waitForTimeout(900);
    const speed = await jogSpeed(page);
    await thumb.end();
    await settle(page);
    console.log(`JOG-SPEED ${panel.name} ${JSON.stringify(speed)}`);
    expect(speed.pairs, 'frames logged at full reach').toBeGreaterThan(5);
    expect(speed.framesPerS, 'frame widths a second at full reach').toBeGreaterThan(0.75 * JOG_FRAMES_PER_S);
    expect(speed.framesPerS, 'frame widths a second at full reach').toBeLessThan(1.25 * JOG_FRAMES_PER_S);
    const full = (await cameraOf(page)).x - stopped.x;
    expect(full / halfWay, 'full reach walks faster than half').toBeGreaterThan(1.5);
    // up raises the eye; it never turned or pitched
    const before = await cameraOf(page);
    await jogBy(page, 0, -JOG_FULL_PX, { holdMs: 400 });
    const raised = await cameraOf(page);
    expect(raised.y).toBeGreaterThan(before.y);
    expect([raised.yaw ?? 0, raised.pitch]).toEqual([0, 0]);
    // the drags crossed the tab bar and the case tabs: none pressed, nothing opened
    expect(page.url()).toBe(url);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    // a quick tap is the menu (the Add sheet); its close is the jog again
    await settle(page, 400);
    await jogButton(page).tap();
    await expect(page.getByText(/import your mfc export/i)).toBeVisible();
    await page.locator('.bottom-sheet__handle-area').click();
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await expect(jogButton(page)).toHaveCount(1);
    // a touch jog raises no click of its own: the button's next click (Enter here) is the menu, not swallowed
    await jogBy(page, JOG_FULL_PX, 0, { holdMs: 100 });
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await jogButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/import your mfc export/i)).toBeVisible();
  });
}

/**
 * NAV3-JOG's collision check (Ross: "a if needed, else right to b"): on every Fold8 panel, the browser's and the
 * installed app's, the jog's button is clear of every tab and case tab, and a thumb's full reach below its centre stays
 * inside the tab bar, above Android's gesture area. That area is outside the page in Chrome; in an edge-to-edge app the
 * page pads it (env(safe-area-inset-bottom)), modelled here as a 48 px inset (gesture navigation's 48 dp frame).
 */
test('NAV-JOG: on every Fold8 panel the jog is clear of the tabs and the case tabs, and its reach stays above the gesture area', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openFree(page, COVER);
  const rows: { panel: string; inset: number; jog: number[]; reachBottom: number; gestureTop: number; hits: string[] }[] = [];
  const panels = [...FOLD8, ...SHOT_VIEWPORTS.filter((v) => v.mobile)];
  for (const panel of panels) {
    await page.setViewportSize({ width: panel.width, height: panel.height });
    for (const inset of [0, 48]) {
      await page.evaluate((px) => document.documentElement.style.setProperty('--safe-area-bottom', `${px}px`), inset);
      await settle(page, 200);
      const jog = (await jogButton(page).boundingBox())!;
      const others = [
        ...(await boxesOf(page, '.tab-bar__item')).map((b) => ({ b, what: 'tab' })),
        ...(await boxesOf(page, '.case-tabs__tab')).map((b) => ({ b, what: 'case tab' })),
      ];
      const reachBottom = jog.y + jog.height / 2 + JOG_FULL_PX;
      const gestureTop = panel.height - inset;
      rows.push({ panel: panel.name, inset, jog: [jog.x, jog.y, jog.width, jog.height].map(Math.round), reachBottom: Math.round(reachBottom), gestureTop, hits: others.filter((o) => overlaps(jog, o.b)).map((o) => o.what) });
    }
  }
  await testInfo.attach('jog-geometry', { body: JSON.stringify(rows), contentType: 'application/json' });
  console.log(`JOG-GEOMETRY ${JSON.stringify(rows)}`);
  expect(rows).toHaveLength(panels.length * 2);
  for (const r of rows) {
    expect(r.hits, `${r.panel} inset ${r.inset}: the jog over another control`).toEqual([]);
    expect(r.reachBottom, `${r.panel} inset ${r.inset}: full reach below the jog, above the gesture area`).toBeLessThanOrEqual(r.gestureTop);
    expect(r.jog[1] + r.jog[3], `${r.panel} inset ${r.inset}: the jog above the gesture area`).toBeLessThanOrEqual(r.gestureTop - 40);
  }
});

// --- 15: Reset ----------------------------------------------------------------------------------------------------------

test('Reset: none after a 2,000 mm walk at the opening height; there within 500 ms of a 15 deg look; it lands straight', async ({ page }) => {
  await openFree(page, COVER, { view: 'cabinet' });
  const start = await cameraOf(page);
  const f = await frameBox(page);
  while (Math.abs((await cameraOf(page)).x - start.x) < 2000) {
    await fingerDrag(page, { x: f.x + f.width * 0.85, y: f.y + f.height / 2 }, { x: f.x + f.width * 0.15, y: f.y + f.height / 2 });
  }
  await page.waitForTimeout(500);
  await expect(page.locator('.cabinet-scene__reset')).toHaveCount(0);
  // a 15 deg look with a held finger (right of centre: the finger moves left to turn right)
  const c = await cameraOf(page);
  const finger = await touchDown(page, f.x + f.width / 2, f.y + f.height / 2);
  await page.waitForTimeout(300);
  await finger.to(f.x + f.width / 2 - c.focalPx * Math.tan(15 * DEG), f.y + f.height / 2, 8, 16);
  // never during the gesture
  await expect(page.locator('.cabinet-scene__reset')).toBeHidden();
  const lifted = Date.now();
  await finger.end();
  await expect(page.locator('.cabinet-scene__reset')).toBeVisible({ timeout: 500 });
  console.log(`RESET shown ${Date.now() - lifted} ms after the lift`);
  // Chromium takes a tap within a moment of a lifted drag as the end of its fling and makes no click of it (measured:
  // pointerdown and pointerup on the button 20 ms after the lift, no click), so the press waits for the fling to pass
  await settle(page, 400);
  await page.locator('.cabinet-scene__reset').tap();
  await settle(page);
  const reset = await cameraOf(page);
  expect(reset.yaw ?? 0).toBe(0);
  await expect(page.locator('.cabinet-scene__reset')).toHaveCount(0);
});

// --- 16: no pull-to-refresh ---------------------------------------------------------------------------------------------

for (const panel of FOLD8) {
  test(`NAV-PTR-1 in Free camera ${panel.name}: a 300 px drag down raises the eye and never pulls to refresh`, async ({ page }) => {
    await openFree(page, panel);
    const before = await cameraOf(page);
    const seen = await watchPull(page);
    const f = await frameBox(page);
    const x = f.x + f.width / 2;
    const y = f.y + 10;
    const finger = await fingerDrag(page, { x, y }, { x, y: y + Math.min(300, f.height - 20) }, { lift: false });
    const indicatorPx = await page.locator('.pull-to-refresh__indicator').evaluate((e) => e.getBoundingClientRect().height);
    expect((await frameBox(page)).y, "the frame's top stays").toBe(f.y);
    await finger.end();
    await settle(page);
    expect(indicatorPx).toBe(0);
    await expect(page.locator('.pull-to-refresh__spinner--active')).toHaveCount(0);
    expect(await seen()).toEqual({ tallestPx: 0, refreshed: false });
    expect((await cameraOf(page)).y, 'the eye rose').toBeGreaterThan(before.y);
  });
}

// --- 7: a fold keeps the pose -------------------------------------------------------------------------------------------

test('a fold or an unfold keeps x, y, z, yaw and pitch (spec 6.6)', async ({ page }) => {
  await openFree(page, COVER);
  const f = await frameBox(page);
  await fingerDrag(page, { x: f.x + f.width * 0.8, y: f.y + f.height / 2 }, { x: f.x + f.width * 0.3, y: f.y + f.height / 2 });
  // Shift-free hold to look
  const finger = await touchDown(page, f.x + f.width / 2, f.y + f.height / 2);
  await page.waitForTimeout(300);
  await finger.to(f.x + f.width / 2 - 60, f.y + f.height / 2 + 20, 8, 16);
  await finger.end();
  await settle(page, 400);
  const pose = (c: Camera) => [c.x, c.y, c.z, c.yaw ?? 0, c.pitch];
  const folded = await cameraOf(page);
  expect(folded.yaw).not.toBe(0);
  await page.setViewportSize({ width: OPEN.width, height: OPEN.height });
  await settle(page, 600);
  const unfolded = await cameraOf(page);
  expect(unfolded.frame.width).not.toBe(folded.frame.width);
  expect(pose(unfolded)).toEqual(pose(folded));
  await page.setViewportSize({ width: COVER.width, height: COVER.height });
  await settle(page, 600);
  expect(pose(await cameraOf(page))).toEqual(pose(folded));
});

// --- 14: a desktop ------------------------------------------------------------------------------------------------------

test.describe('desktop, no touch', () => {
  test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  const DESKTOP = { width: 1536, height: 730 };

  async function mouseDrag(page: Page, dx: number, o: { button?: 'left' | 'right'; shift?: boolean } = {}) {
    const f = await frameBox(page);
    const x = f.x + f.width / 2;
    const y = f.y + f.height / 2;
    await page.mouse.move(x, y);
    if (o.shift) await page.keyboard.down('Shift');
    await page.mouse.down({ button: o.button ?? 'left' });
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
    await page.mouse.up({ button: o.button ?? 'left' });
    if (o.shift) await page.keyboard.up('Shift');
    await settle(page);
  }

  test('a right drag turns and opens no menu; Shift+left drag turns; a left drag walks', async ({ page }) => {
    // Look arms after a 1 s hold here, so the left drag's first move is never late enough to arm it on a loaded host
    await openFree(page, DESKTOP, { query: 'fx=40&lookhold=1000' });
    await page.evaluate(() => {
      const seen: boolean[] = [];
      (window as unknown as { __menus: boolean[] }).__menus = seen;
      document.addEventListener('contextmenu', (e) => seen.push(e.defaultPrevented));
    });
    const start = await cameraOf(page);
    await mouseDrag(page, -120, { button: 'right' });
    const right = await cameraOf(page);
    expect(right.yaw, 'a right drag turns').toBeGreaterThan(0);
    expect(right.x).toBe(start.x);
    const menus = await page.evaluate(() => (window as unknown as { __menus: boolean[] }).__menus);
    expect(menus.length, 'the right button raised a contextmenu').toBeGreaterThan(0);
    expect(menus.every(Boolean), `every contextmenu prevented: ${JSON.stringify(menus)}`).toBe(true);
    await mouseDrag(page, 120, { shift: true });
    const shift = await cameraOf(page);
    expect(shift.yaw!, 'Shift+left turns back').toBeLessThan(right.yaw!);
    expect(shift.x).toBe(start.x);
    await mouseDrag(page, -200);
    const walked = await cameraOf(page);
    expect(walked.x, 'a left drag walks').toBeGreaterThan(start.x);
    expect(walked.yaw).toBe(shift.yaw);
  });

  test('NAV-JOG with a mouse: a drag on the bottom-centre button moves the eye and its own click opens no menu; a click then does', async ({ page }) => {
    await openFree(page, COVER);
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { __clicks: number[] }).__clicks = seen;
      document.querySelector('.tab-bar__add')!.addEventListener('click', (e) => seen.push(e.timeStamp), true);
    });
    const b = (await jogButton(page).boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const start = await cameraOf(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + (JOG_FULL_PX * i) / 6, at.y);
    await page.waitForTimeout(500);
    await page.mouse.up();
    await settle(page);
    expect((await cameraOf(page)).x, 'the drag jogged the eye right').toBeGreaterThan(start.x);
    const clicks = await page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks.length);
    console.log(`JOG-MOUSE clicks raised by the drag: ${clicks}`);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await jogButton(page).click();
    await expect(page.getByText(/import your mfc export/i)).toBeVisible();
  });
});

// --- 4, 5, 6, 8, 10: the pose log, the cone, no hole ---------------------------------------------------------------------

/** A data-camera write: when (t, performance.now()) and on which frame (the document timeline's time, the rAF clock). */
type Write = { t: number; frame: number; camera: string; x: number; y: number; down: boolean; gesture: string | null };
type PointerLog = { t: number; type: string; x: number; y: number; camera: string };
type PoseLog = { writes: Write[]; events: PointerLog[]; translates: string[]; frames: number[] };

/**
 * From now on: every data-camera the scene writes (with the finger where it was then), every pointer event, every
 * viewport translate, and every animation frame's time (the rAF clock a write's `frame` is on).
 */
async function startPoseLog(page: Page) {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const viewport = host.querySelector<HTMLElement>('.cabinet-scene__viewport')!;
    const log = { writes: [] as unknown[], events: [] as unknown[], translates: [] as string[], frames: [] as number[] };
    const onFrame = (t: number) => {
      log.frames.push(t);
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    let finger = { x: NaN, y: NaN, down: false };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      window.addEventListener(
        type,
        (e) => {
          const p = e as PointerEvent;
          finger = { x: p.clientX, y: p.clientY, down: type === 'pointerdown' ? true : type === 'pointermove' ? finger.down : false };
          log.events.push({ t: performance.now(), type, x: p.clientX, y: p.clientY, camera: host.dataset.camera });
        },
        true,
      );
    }
    let last = host.dataset.camera;
    new MutationObserver(() => {
      const camera = host.dataset.camera;
      if (camera === last) return;
      last = camera;
      log.writes.push({ t: performance.now(), frame: document.timeline.currentTime, camera, x: finger.x, y: finger.y, down: finger.down, gesture: host.dataset.gesture ?? null });
    }).observe(host, { attributes: true, attributeFilter: ['data-camera'] });
    new MutationObserver(() => {
      if (/translate/.test(viewport.style.transform)) log.translates.push(viewport.style.transform);
    }).observe(viewport, { attributes: true, attributeFilter: ['style'] });
    (window as unknown as { __poseLog: typeof log }).__poseLog = log;
  });
}
const poseLog = (page: Page) => page.evaluate(() => (window as unknown as { __poseLog: PoseLog }).__poseLog);

/**
 * A held finger: down, still `holdMs` and then until Look has armed (data-gesture=look), then along `path`, 16 ms a step.
 * The arm is waited for, not timed: its timer (LOOK_HOLD_MS, or the page's lookhold) fires late under load, and a sweep
 * that starts first is a walk, which never shows Reset.
 */
async function holdAndSweep(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], { holdMs = 300, lift = true } = {}) {
  // the press must land on the picture: no control, no sheet or viewer over it (its zoom is recorded with it)
  const at = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const host = document.querySelector('.cabinet-scene')!;
    return { x, y, onPicture: el !== null && host.contains(el) && el.closest('[data-scene-ui]') === null, el: el && `${el.tagName}.${el.className}`, zoom: host.getAttribute('data-zoom') };
  }, from);
  expect(at.onPicture, `the hold lands on the picture: ${JSON.stringify(at)}`).toBe(true);
  const finger = await touchDown(page, from.x, from.y);
  await page.waitForTimeout(holdMs);
  await expect(page.locator('.cabinet-scene'), `Look armed before the sweep (the hold at ${JSON.stringify(at)})`).toHaveAttribute('data-gesture', 'look', { timeout: 10_000 });
  for (const p of path) await finger.to(p.x, p.y, 24, 16);
  await page.waitForTimeout(50);
  if (lift) await finger.end();
  return finger;
}

/**
 * Reset view, which a pose off the framing shows (a look, a raise): it must be there, and its tap must take the pose
 * back (it goes). Past a fling's end first: Chromium makes no click of a tap a moment after a lifted drag.
 */
async function resetView(page: Page) {
  const reset = page.locator('.cabinet-scene__reset');
  await expect(reset, 'Reset view shown').toHaveCount(1);
  await settle(page, 400);
  await reset.tap({ timeout: 5_000 });
  await expect(reset, 'Reset view took the pose back').toHaveCount(0);
}

/**
 * Pixels (CSS px, frame space) of the scene's own background where a front of the wall's boxes says a face is. The
 * background (#0b0c0f) is near the KLINGSBO's black steel in shadow, so for the shot it is painted a colour no face
 * has (#ff00ff) and that is looked for.
 */
async function holes(page: Page, camera: Camera, path?: string) {
  const f = await frameBox(page);
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.cabinet-scene { background: #ff00ff !important; }');
    (window as unknown as { __bg: CSSStyleSheet }).__bg = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const png = decodePng(await page.screenshot({ clip: f, scale: 'css', animations: 'disabled', path }));
  await page.evaluate(() => {
    const sheet = (window as unknown as { __bg: CSSStyleSheet }).__bg;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  });
  const boxes = await wallOf(page);
  let count = 0;
  let checked = 0;
  const at: { x: number; y: number; box: number }[] = [];
  for (const [n, [x0, x1, y1, , z1]] of boxes.entries()) {
    const corners = ([[x0, 0, z1], [x1, 0, z1], [x1, y1, z1], [x0, y1, z1]] as Vec3[]).map((p) => project(camera, p));
    if (corners.some((c) => c.depth < 50)) continue;
    // a convex quad, inset by 3 px; sampled every 2 px inside the frame
    const cx = corners.reduce((a, c) => a + c.x, 0) / 4;
    const cy = corners.reduce((a, c) => a + c.y, 0) / 4;
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const inside = (x: number, y: number) =>
      corners.every((a, i) => {
        const b = corners[(i + 1) % 4];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        const sideOfCentre = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
        return Math.sign(cross) === Math.sign(sideOfCentre) && Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y) >= 3;
      });
    for (let y = Math.max(0, Math.ceil(Math.min(...ys))); y < Math.min(png.height, Math.max(...ys)); y += 2) {
      for (let x = Math.max(0, Math.ceil(Math.min(...xs))); x < Math.min(png.width, Math.max(...xs)); x += 2) {
        if (!inside(x, y)) continue;
        checked++;
        const i = (y * png.width + x) * 4;
        const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
        if (r >= 0xf0 && g <= 0x10 && b >= 0xf0) {
          count++;
          if (at.length < 40) at.push({ x, y, box: n });
        }
      }
    }
  }
  return { count, checked, at };
}

const bearingYaw = (fx: number, frameLeft: number, c: Camera) => Math.atan((fx - frameLeft - c.frame.width / 2) / c.focalPx);
const parse = (s: string) => toCamera(JSON.parse(s) as Published);

for (const panel of FOLD8) {
  test(`pose log ${panel.name}: a walk end to end and back, a look to each hard limit and back, the cone held; no hole`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    // Look arms after a 1 s hold here, so a swipe's first move is never late enough to arm it on a loaded host (a sweep
    // waits for the arm: holdAndSweep)
    await openFree(page, panel, { query: process.env.POSE_LOG_QUERY ?? 'fx=170&lookhold=1000' });
    const f = await frameBox(page);
    const wall = await wallOf(page);
    const first = (wall[0][0] + wall[0][1]) / 2;
    const last = (wall[wall.length - 1][0] + wall[wall.length - 1][1]) / 2;
    const cone = await coneOf(page);
    await startPoseLog(page);
    const y = f.y + f.height * 0.2;

    // a walk: from the wall's first cabinet to its last and back
    const swipeBy = (dir: 1 | -1) => fingerDrag(page, { x: f.x + f.width * (dir > 0 ? 0.85 : 0.15), y }, { x: f.x + f.width * (dir > 0 ? 0.15 : 0.85), y });
    let swipes = 0;
    while ((await cameraOf(page)).x < last && swipes < 80) (await swipeBy(1), swipes++);
    while ((await cameraOf(page)).x > first && swipes < 160) (await swipeBy(-1), swipes++);
    expect(swipes).toBeLessThan(160);
    const walkEnd = (await poseLog(page)).writes.length;

    // a look to each side's hard limit and back, the finger held (Look armed by the hold). 30 px in from the frame's
    // edges: within a few px of them Chromium sometimes sends a touch to the root (<html>), not the scene the point is on
    // (measured after a jog: 10-13 % of touches 3 px in, none 30 px in), and the jog leaves the eye anywhere along the
    // wall. A sweep from 30 px in still turns 61-78 deg one way, past every panel's hard limit (24-45 deg)
    const left = { x: f.x + 30, y };
    const right = { x: f.x + f.width - 30, y };
    await holdAndSweep(page, left, [right, left]);
    await settle(page);
    await holdAndSweep(page, right, [left, right]);
    await settle(page);
    const sweepEnd = (await poseLog(page)).writes.length;

    // the cone: held past the limit, let go there; 250 ms on, the shown yaw is the committed one (the soft limit). From
    // the middle of the wall (the jog walks there: NAV-JOG retired the arrows), so a turn either way sees fronts
    const middle = (first + last) / 2;
    for (let i = 0; i < 20 && (await cameraOf(page)).x < middle; i++) await jogBy(page, JOG_FULL_PX, 0, { holdMs: 400 });
    expect((await cameraOf(page)).x).toBeGreaterThanOrEqual(middle);
    const jogEnd = (await poseLog(page)).writes.length;
    const jogEndT = await page.evaluate(() => performance.now());
    const shot: { side: string; yaw: number; holes: { count: number; checked: number; at: { x: number; y: number; box: number }[] } }[] = [];
    const settledYaw: number[] = [];
    for (const [from, to, side] of [[left, right, 'left'], [right, left, 'right']] as const) {
      const finger = await holdAndSweep(page, from, [to], { lift: false });
      await settle(page, 200);
      const held = await cameraOf(page);
      shot.push({ side, yaw: held.yaw! / DEG, holes: await holes(page, held, testInfo.outputPath(`held-${side}.png`)) });
      await finger.end();
      await page.waitForTimeout(250);
      await settle(page, 0);
      settledYaw.push((await cameraOf(page)).yaw! / DEG);
      // back to straight for the other side
      await resetView(page);
      await settle(page, 400);
    }

    const log = await poseLog(page);
    const logPath = testInfo.outputPath('pose-log.json');
    writeFileSync(logPath, JSON.stringify({ panel: panel.name, cone, frame: f, swipes, walkEnd, sweepEnd, jogEnd, shot, settledYaw, log }));
    await testInfo.attach('pose-log', { path: logPath, contentType: 'application/json' });
    // 6: the viewport never slides
    expect(log.translates).toEqual([]);
    // 4: no write with the finger still and no spring running
    const ups = log.events.filter((e) => e.type === 'pointerup' || e.type === 'pointercancel').map((e) => e.t);
    const downs = log.events.filter((e) => e.type === 'pointerdown').map((e) => e.t);
    /** The time of the first frame SPRING_MS (and a 60 Hz frame) or more after a lift at `up`: the ease's last. */
    const easeEnd = (up: number) => log.frames.find((t) => t >= up + SPRING_MS + 16) ?? Infinity;
    const unprompted = log.writes.filter((w, i) => {
      const prev = log.writes[i - 1];
      const lastUp = Math.max(-Infinity, ...ups.filter((t) => t <= w.t));
      const lastDown = Math.max(-Infinity, ...downs.filter((t) => t <= w.t));
      const fingerMoved = prev === undefined || prev.x !== w.x || prev.y !== w.y || prev.down !== w.down;
      // the ease back after a lift past the soft limit: it turns the eye, never moves it, on each frame up to and with the
      // first one SPRING_MS or more after the lift by the frame clock (the rAF's), and on none after it. Judged on the
      // logged frames, not the wall clock: with 12 workers that last frame came up to 100 ms after the one before it, and
      // its callback ran up to 74 ms after the frame's own time, so its write landed up to 312 ms after the lift (18 eases
      // measured). One 60 Hz frame of slack: the scene times the ease from its pointerup handler, which runs after this
      // log's capture listener
      const turnedOnly = prev !== undefined && (['x', 'y', 'z'] as const).every((k) => parse(prev.camera)[k] === parse(w.camera)[k]);
      const springing = lastUp > lastDown && turnedOnly && w.frame <= easeEnd(lastUp);
      // a press or a lift (a re-render on release) or a Reset tap (a re-base, the finger down on a control)
      const tapped = w.t - Math.max(lastUp, lastDown) <= 250;
      // NAV-JOG: a thumb held still on the jog moves the eye on every frame until it lifts (its finger is down)
      const jogging = w.gesture === 'jog' && lastDown > lastUp;
      return !fingerMoved && !springing && !tapped && !jogging;
    });
    expect(
      unprompted.map((w) => ({ ...w, msAfterLift: Math.round(w.t - Math.max(-Infinity, ...ups.filter((t) => t <= w.t))) })),
      'pose writes with no input',
    ).toEqual([]);

    // 4: MOVE: each write's step is the finger's step times one ratio (d / f, the anchor depth), within 1 px at that depth
    let worstMovePx = 0;
    let worstLookDeg = 0;
    let prevCam: Camera | null = null;
    // each write of the walk belongs to the press it follows; its step is the finger's since the write before it (or the press)
    const gestures = new Map<number, { df: number; dp: number }[]>();
    let lastFinger = { x: NaN, y: NaN };
    let lastPress = -1;
    for (const w of log.writes.slice(0, walkEnd)) {
      const cam = parse(w.camera);
      const press = log.events.filter((e) => e.type === 'pointerdown' && e.t <= w.t).at(-1)!;
      if (w.gesture === 'move') {
        if (press.t !== lastPress) {
          // a walk's first step is from where the finger went down, and the pose there
          lastPress = press.t;
          lastFinger = { x: press.x, y: press.y };
          prevCam = parse(press.camera);
          gestures.set(press.t, []);
        }
        const from = prevCam!;
        gestures.get(press.t)!.push({ df: w.x - lastFinger.x, dp: cam.x - from.x });
        expect([cam.y, cam.z, cam.yaw ?? 0, cam.pitch], 'a walk moves x alone').toEqual([from.y, from.z, from.yaw ?? 0, from.pitch]);
        lastFinger = { x: w.x, y: w.y };
      }
      prevCam = cam;
    }
    for (const steps of gestures.values()) {
      const k = steps.reduce((a, s) => a + s.dp, 0) / steps.reduce((a, s) => a + s.df, 0);
      for (const s of steps) worstMovePx = Math.max(worstMovePx, Math.abs(s.dp - k * s.df) / Math.abs(k));
    }
    expect(gestures.size, 'the walk was logged').toBeGreaterThan(4);
    expect(worstMovePx, 'a walk step off the finger, px at the anchor depth').toBeLessThanOrEqual(1);

    // 4: LOOK: within the soft limit the yaw is the finger's bearing turn to 0.1 deg; a step never turns more than the finger's plus 0.1 deg
    let maxShown = 0;
    let lookStart: { yaw: number; a0: number } | null = null;
    let prevLook: { yaw: number; raw: number } | null = null;
    let lookPress = -1;
    for (const w of log.writes.slice(walkEnd, sweepEnd)) {
      const cam = parse(w.camera);
      if (w.gesture !== 'look') continue;
      // each write belongs to the press it follows: its turn is from where that finger went down
      const down = log.events.filter((e) => e.type === 'pointerdown' && e.t <= w.t).at(-1)!;
      if (lookStart === null || down.t !== lookPress) {
        lookPress = down.t;
        lookStart = { yaw: parse(down.camera).yaw ?? 0, a0: bearingYaw(down.x, f.x, cam) };
        prevLook = null;
      }
      const raw = lookStart.yaw + lookStart.a0 - bearingYaw(w.x, f.x, cam);
      const yaw = cam.yaw ?? 0;
      maxShown = Math.max(maxShown, Math.abs(yaw) / DEG);
      if (Math.abs(raw) / DEG <= cone.soft - 0.01) worstLookDeg = Math.max(worstLookDeg, Math.abs(yaw - raw) / DEG);
      if (prevLook) expect(Math.abs(yaw - prevLook.yaw) / DEG, 'a look step').toBeLessThanOrEqual(Math.abs(raw - prevLook.raw) / DEG + 0.1);
      prevLook = { yaw, raw };
    }
    expect(worstLookDeg, 'a look off the finger within the soft limit, deg').toBeLessThanOrEqual(0.1);
    // 8: shown never past the hard limit; short of it where the hard limit is past the soft one
    expect(maxShown).toBeLessThanOrEqual(cone.hard + 1e-4);
    if (cone.hard > cone.soft) expect(maxShown).toBeLessThan(cone.hard);
    expect(maxShown, 'the sweep reached the cone').toBeGreaterThanOrEqual(cone.soft - 0.01);
    for (const s of shot) {
      expect(Math.abs(s.yaw)).toBeLessThanOrEqual(cone.hard + 1e-4);
      // 10: no hole
      expect(s.holes.count, `background inside a front at yaw ${s.yaw.toFixed(1)}`).toBe(0);
      expect(s.holes.checked, `fronts in view at yaw ${s.yaw.toFixed(1)}`).toBeGreaterThan(100);
    }
    for (const y of settledYaw) expect(Math.abs(Math.abs(y) - cone.soft), '250 ms after release: at the soft limit').toBeLessThan(1e-3);

    // NAV-JOG: the jog moved the eye only while its thumb was down; it stopped at the lift (nothing written after)
    const jogWrites = log.writes.slice(sweepEnd, jogEnd).filter((w) => w.gesture === 'jog');
    expect(jogWrites.length, 'the jog walked').toBeGreaterThan(5);
    for (const w of jogWrites) expect(w.down, 'a jog write with the thumb down').toBe(true);
    const lastJogUp = Math.max(...ups.filter((t) => t <= jogEndT));
    expect(log.writes.slice(sweepEnd, jogEnd).filter((w) => w.t > lastJogUp), 'no write after the jog lifts').toEqual([]);

    // 5: the pose at each pointerup of a walk is the pose its last move left (no settle)
    const upsInWalk = log.events.filter((e) => e.type === 'pointerup' && e.t <= (log.writes[walkEnd - 1]?.t ?? 0));
    for (const up of upsInWalk) {
      const after = log.writes.filter((w) => w.t > up.t && w.t - up.t < 200);
      expect(after.map((w) => w.camera), 'no write after a walk lifts').toEqual([]);
    }

    // for the record: the writes not on a logged frame (made outside one: a handler's, whose timeline time Chromium makes up)
    const offFrame = log.writes.filter((w) => !log.frames.includes(w.frame)).length;
    const summary = { panel: panel.name, cone, swipes, walkWrites: walkEnd, moveGestures: gestures.size, worstMovePx, worstLookDeg, maxShown, held: shot, settledYaw, writes: log.writes.length, frames: log.frames.length, offFrame };
    console.log(`POSELOG ${JSON.stringify(summary)}`);
  });
}

// --- 9: the budget at the hard yaw --------------------------------------------------------------------------------------

/** The compositor's layers now (a copy of case-budget.spec.ts's compositedLayers: a spec file cannot import another's). */
async function sceneLayerArea(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    type L = { layerId: string; backendNodeId?: number; width: number; height: number; drawsContent: boolean };
    const tree = new Promise<L[]>((resolve) => {
      cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: L[] }) => {
        if (e.layers) resolve(e.layers);
      });
    });
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const layers = await Promise.race([tree, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no LayerTree within 10 s')), 10_000))]);
    const backed = layers.filter((l) => l.drawsContent && l.backendNodeId !== undefined);
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds: inScene } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.cabinet-scene, .cabinet-scene *' });
    const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: backed.map((l) => l.backendNodeId!) });
    const scene = new Set(inScene);
    const sceneLayers = backed.filter((_, i) => scene.has(nodeIds[i]));
    await cdp.send('LayerTree.disable');
    return { sceneLayers: sceneLayers.length, sceneArea: sceneLayers.reduce((a, l) => a + l.width * l.height, 0) };
  } finally {
    await cdp.detach();
  }
}

const DENSE = [
  { name: 'spike wall', query: 'fx=170&fxonly=spike' },
  { name: 'spike wall at the 250 cap', query: 'fx=170&fxonly=spike&fxwidth=narrow&fxbranch=framed' },
];

type Projected = { vp: number; drawn: number; figures: number };
type YawSide = { hard: number; fit: number | null; atHard: Projected | null };
type YawBudget = { start: (Projected & { yaw: number }) | null; left: YawSide; right: YawSide; asked: [number, number][]; ms: number };
type BudgetRow = {
  yaw: number;
  drawn: number;
  cap: number;
  figures: number;
  sceneLayers: number;
  sceneViewports: number;
  s: number;
  asked: number;
  a: boolean;
  /** The most any yaw asked that way was projected to cost (viewports), and how many were asked. */
  peak: number;
  probes: number;
  b: boolean;
  fit: number | null;
  ms: number;
  freshViewports: number;
  freshDrawn: number;
  letGo: number;
};

const budgetOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-yaw-budget'))!) as YawBudget;
const pxPerMmOf = async (page: Page) => Number(await page.locator('.cabinet-scene').getAttribute('data-px-per-mm'));
/** The scene's layers re-culled at the pose it holds (the cull lags a turn, stickyPose): a 1 px fold re-culls there. */
async function freshAt(page: Page, panel: { width: number; height: number }) {
  await page.setViewportSize({ width: panel.width, height: panel.height + 1 });
  await settle(page, 400);
  const fresh = {
    vp: Number(((await sceneLayerArea(page)).sceneArea / (panel.width * panel.height)).toFixed(3)),
    drawn: Number(await page.locator('.cabinet-scene').getAttribute('data-drawn-cabinets')),
    s: await pxPerMmOf(page),
    asked: Number(await page.locator('.cabinet-scene').getAttribute('data-turned-px-per-mm')),
  };
  return fresh;
}
async function unfold(page: Page, panel: { width: number; height: number }) {
  await page.setViewportSize({ width: panel.width, height: panel.height });
  await settle(page, 400);
}

/**
 * NAV-1A (b): the sides of the dense walls where the held sharpness (a) alone would pass the ceiling on the way to the
 * hard yaw, so the safety net stops the turn; on every other side (a) is enough and the full turn is kept. Measured on
 * the Fold8's panels: re-culled at the hard yaw with (b) off, only this side passes 3 viewports. `${panel} ${wall} ${side}`.
 */
const B_ENGAGES = new Set<string>(['fold8-cover spike wall right']);

for (const panel of FOLD8) {
  for (const wall of DENSE) {
    // NAV-1A a+b (Ross 10-28): turned, the scene keeps the px per mm in force where the turn left yaw 0 (a); where its
    // projected layers would still pass the ceiling the turn stops at the last yaw that fits (b). Each case says which
    // acted and where the turn ended.
    test(`budget ${panel.name}, ${wall.name}: at the hard yaw both ways, scene layers <= 3 viewports, drawn <= cap every frame`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await openFree(page, panel, { query: wall.query });
      const host = page.locator('.cabinet-scene');
      const opening = Number(await host.getAttribute('data-drawn-cap'));
      const openingS = await pxPerMmOf(page);
      // the opening is the panel's own framing, nothing held (no Reset), and its layers are drawn afresh: the projection's check
      await expect(page.locator('.cabinet-scene__reset')).toHaveCount(0);
      const openingVp = (await sceneLayerArea(page)).sceneArea / (panel.width * panel.height);
      const cone = await coneOf(page);
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
        const seen: [number, number][] = [];
        (window as unknown as { __caps: typeof seen }).__caps = seen;
        new MutationObserver(() => seen.push([Number(host.dataset.drawnCabinets), Number(host.dataset.drawnCap)])).observe(host, {
          attributes: true,
          attributeFilter: ['data-drawn-cabinets', 'data-drawn-cap'],
        });
      });
      const f = await frameBox(page);
      const y = f.y + f.height * 0.2;
      const viewport = panel.width * panel.height;
      const out: (BudgetRow & { side: 'right' | 'left' })[] = [];
      let startVp = 0;
      // a turn to the right (the finger right to left) and then to the left
      for (const [from, to] of [[f.x + f.width - 3, f.x + 3], [f.x + 3, f.x + f.width - 3]]) {
        const finger = await holdAndSweep(page, { x: from, y }, [{ x: to, y }], { lift: false });
        await settle(page, 400);
        const layers = await sceneLayerArea(page);
        const cam = await cameraOf(page);
        const budget = await budgetOf(page);
        // the finger right to left turns the eye right
        const name = to < from ? 'right' : 'left';
        const sign = name === 'right' ? 1 : -1;
        const side = budget[name];
        if (out.length === 0) startVp = budget.start!.vp;
        const mine = budget.asked.filter(([yaw]) => sign * yaw > 0);
        const row: BudgetRow & { side: 'right' | 'left' } = {
          side: name,
          yaw: Number((cam.yaw! / DEG).toFixed(2)),
          drawn: Number(await host.getAttribute('data-drawn-cabinets')),
          cap: Number(await host.getAttribute('data-drawn-cap')),
          figures: Number(await host.getAttribute('data-drawn-figures')),
          sceneLayers: layers.sceneLayers,
          sceneViewports: Number((layers.sceneArea / viewport).toFixed(3)),
          // (a): the px per mm drawn at the held pose and what the turned view there asked (read once re-culled, below)
          s: 0,
          asked: 0,
          a: false,
          // (b): the yaws asked that way and the most any was projected to cost; the fit, if any
          peak: Math.max(...mine.map(([, vp]) => vp)),
          probes: mine.length,
          b: side.fit !== null,
          fit: side.fit,
          ms: budget.ms,
          freshViewports: 0,
          freshDrawn: 0,
          letGo: 0,
        };
        const fresh = await freshAt(page, panel);
        row.freshViewports = fresh.vp;
        row.freshDrawn = fresh.drawn;
        row.s = fresh.s;
        row.asked = fresh.asked;
        row.a = row.asked > row.s;
        await finger.end();
        await settle(page, 400);
        row.letGo = Number((((await cameraOf(page)).yaw ?? 0) / DEG).toFixed(2));
        await unfold(page, panel);
        out.push(row);
        await resetView(page);
        await settle(page, 400);
      }
      const caps = await page.evaluate(() => (window as unknown as { __caps: [number, number][] }).__caps);
      const summary = { panel: panel.name, wall: wall.name, openingCap: opening, openingS, openingVp: Number(openingVp.toFixed(3)), startVp, cone, held: out, frames: caps.length };
      await testInfo.attach('budget', { body: JSON.stringify(summary), contentType: 'application/json' });
      console.log(`BUDGET ${JSON.stringify(summary)}`);
      expect(caps.filter(([d, c]) => d > c), 'drawn past the cap').toEqual([]);
      // the projection at the opening is what the compositor has there, never under it; less the controls' allowance (the
      // look ring a held look shows), over by no more than 0.1. NAV-JOG: the arrows retired, the opening shows no control
      // of the scene's own, so the whole allowance is over it (their 0.07-0.13 offset it before); measured: the scene
      // itself is projected 0.012-0.061 over what the compositor has, the eight cases
      expect(startVp).toBeGreaterThanOrEqual(openingVp - 0.02);
      expect(startVp - CONTROLS_VIEWPORTS, 'the projected scene less the controls\' allowance').toBeLessThanOrEqual(openingVp + 0.1);
      for (const row of out) {
        expect(row.cap).toBeLessThanOrEqual(20);
        expect(row.sceneViewports, `scene layers at yaw ${row.yaw}, viewports of pixels`).toBeLessThanOrEqual(3);
        expect(row.freshViewports, `scene layers re-culled at yaw ${row.yaw}, viewports of pixels`).toBeLessThanOrEqual(3);
        // (a): turned, never sharper than the opening; what the turned view asks is published beside it
        expect(row.s, `px per mm at yaw ${row.yaw}`).toBe(openingS);
        expect(row.asked, `asked at yaw ${row.yaw}`).toBeGreaterThan(0);
        // (b): engaged only on the sides measured to need it; there the turn never passes the fit, and everywhere else
        // the full turn is kept (past the soft limit toward the hard one)
        expect(row.b, `(b) on the ${row.side}`).toBe(B_ENGAGES.has(`${panel.name} ${wall.name} ${row.side}`));
        if (row.fit !== null) expect(Math.abs(row.yaw)).toBeLessThanOrEqual(row.fit + 0.01);
        else expect(Math.abs(row.yaw)).toBeGreaterThanOrEqual(cone.soft - 0.01);
      }
    });

    // NAV-1A a (Ross 10-28, challenge): a move or a pitch made while turned never draws the scene sharper than where the
    // turn left yaw 0, and the scene stays under the ceiling: one-finger moves toward the fronts while turned, each way,
    // then one diagonal look (a turn and a pitch together) each way
    test(`budget ${panel.name}, ${wall.name}: a turned walk and a diagonal look stay <= 3 viewports, never sharper than the opening`, async ({ page }, testInfo) => {
      test.setTimeout(150_000);
      // Look arms after a 1 s hold here, so a walk's first move is never late enough to arm it on a loaded host
      await openFree(page, panel, { query: `${wall.query}&lookhold=1000` });
      const openingS = await pxPerMmOf(page);
      const open = await cameraOf(page);
      const f = await frameBox(page);
      const y = f.y + f.height * 0.2;
      const rows: { what: string; yaw: number; pitch: number; dz: number; s: number; vp: number }[] = [];
      const turnedTo: number[] = [];
      const record = async (what: string, fresh: { vp: number; s: number }) => {
        const c = await cameraOf(page);
        rows.push({ what, yaw: Number(((c.yaw ?? 0) / DEG).toFixed(2)), pitch: Number((c.pitch / DEG).toFixed(2)), dz: Math.round(c.z - open.z), s: fresh.s, vp: fresh.vp });
      };
      for (const dir of ['right', 'left'] as const) {
        const [from, to] = dir === 'right' ? [f.x + f.width - 3, f.x + 3] : [f.x + 3, f.x + f.width - 3];
        await holdAndSweep(page, { x: from, y }, [{ x: to, y }], { holdMs: 1100 });
        await settle(page, 500);
        const turned = Number((((await cameraOf(page)).yaw ?? 0) / DEG).toFixed(2));
        // turned right, a finger moving right walks the eye toward the fronts (and mirrored)
        for (let i = 0; i < 2; i++) {
          const [a, b] = dir === 'right' ? [f.x + 20, f.x + f.width - 20] : [f.x + f.width - 20, f.x + 20];
          await fingerDrag(page, { x: a, y }, { x: b, y });
          await settle(page, 400);
          await record(`walk ${dir} ${i + 1}`, await freshAt(page, panel));
          turnedTo.push(turned);
          await unfold(page, panel);
        }
        await resetView(page);
        await settle(page, 400);
      }
      for (const [what, x0, y0, x1, y1] of [
        ['look right and up', f.x + f.width - 3, f.y + f.height - 3, f.x + 3, f.y + 3],
        ['look left and down', f.x + 3, f.y + 3, f.x + f.width - 3, f.y + f.height - 3],
      ] as const) {
        const finger = await holdAndSweep(page, { x: x0, y: y0 }, [{ x: x1, y: y1 }], { lift: false, holdMs: 1100 });
        await settle(page, 400);
        await record(what, await freshAt(page, panel));
        await finger.end();
        await unfold(page, panel);
        await resetView(page);
        await settle(page, 400);
      }
      const summary = { panel: panel.name, wall: wall.name, openingS, rows };
      await testInfo.attach('turned', { body: JSON.stringify(summary), contentType: 'application/json' });
      console.log(`TURNED ${JSON.stringify(summary)}`);
      for (const row of rows) {
        expect(row.yaw, `${row.what}: turned`).not.toBe(0);
        expect(row.s, `${row.what}: px per mm`).toBeLessThanOrEqual(openingS);
        expect(row.vp, `${row.what}: scene layers re-culled, viewports of pixels`).toBeLessThanOrEqual(3);
      }
      // each walk kept the turn it began from and went toward the fronts; the looks pitched
      const walks = rows.filter((r) => r.what.startsWith('walk'));
      expect(walks.map((r) => r.yaw)).toEqual(turnedTo);
      for (const r of walks.filter((r) => r.what.endsWith(' 1'))) expect(r.dz, r.what).toBeLessThan(-300);
      for (const r of rows.filter((r) => r.what.startsWith('look'))) expect(Math.abs(r.pitch), r.what).toBeGreaterThan(5);
    });

    // NAV-JOG: the jog moves the eye as a drag does, through the same rules: level, along the wall, up, a diagonal down and
    // left, and held into each end of the wall (it stops there: jogOk); turned, toward the fronts each way (the px per mm
    // held where the turn left yaw 0). Every pose re-culled: <= 3 viewports, never sharper than the opening
    test(`budget ${panel.name}, ${wall.name}: the jog, level and turned, stays <= 3 viewports, never sharper than the opening`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await openFree(page, panel, { query: `${wall.query}&lookhold=1000` });
      const openingS = await pxPerMmOf(page);
      const open = await cameraOf(page);
      const f = await frameBox(page);
      const y = f.y + f.height * 0.2;
      const boxes = await wallOf(page);
      const ends = { left: Math.min(...boxes.map((b) => b[0])), right: Math.max(...boxes.map((b) => b[1])) };
      const rows: { what: string; yaw: number; x: number; dx: number; dy: number; dz: number; s: number; vp: number; stepMm: number }[] = [];
      const record = async (what: string, from: Camera) => {
        const fresh = await freshAt(page, panel);
        const c = await cameraOf(page);
        // a frame's most step at full reach (a late one counts as 100 ms) at the anchor depth: a level eye's distance
        const stepMm = Math.round((((JOG_FRAMES_PER_S * c.frame.width * JOG_MAX_STEP_MS) / 1000) * c.z) / c.focalPx);
        rows.push({ what, yaw: Number(((c.yaw ?? 0) / DEG).toFixed(2)), x: Math.round(c.x), dx: Math.round(c.x - from.x), dy: Math.round(c.y - from.y), dz: Math.round(c.z - from.z), s: fresh.s, vp: fresh.vp, stepMm });
        await unfold(page, panel);
      };
      let from = await cameraOf(page);
      await jogBy(page, JOG_FULL_PX, 0, { holdMs: 1200 });
      await record('jog right', from);
      from = await cameraOf(page);
      await jogBy(page, 0, -JOG_FULL_PX, { holdMs: 600 });
      await record('jog up', from);
      from = await cameraOf(page);
      await jogBy(page, -JOG_FULL_PX * 0.7, JOG_FULL_PX * 0.7, { holdMs: 1000 });
      await record('jog down and left', from);
      for (const [what, dir] of [['jog into the right end', 1], ['jog into the left end', -1]] as const) {
        from = await cameraOf(page);
        await jogToEnd(page, dir);
        await record(what, from);
      }
      await resetView(page);
      await settle(page, 400);
      for (const dir of ['right', 'left'] as const) {
        const [x0, x1] = dir === 'right' ? [f.x + f.width - 3, f.x + 3] : [f.x + 3, f.x + f.width - 3];
        await holdAndSweep(page, { x: x0, y }, [{ x: x1, y }], { holdMs: 1100 });
        await settle(page, 500);
        from = await cameraOf(page);
        // turned right, the jog left walks the eye toward the fronts (and mirrored)
        await jogBy(page, dir === 'right' ? -JOG_FULL_PX : JOG_FULL_PX, 0, { holdMs: 1200 });
        await record(`turned ${dir}, jog toward the fronts`, from);
        await resetView(page);
        await settle(page, 400);
      }
      const summary = { panel: panel.name, wall: wall.name, openingS, open: { x: open.x, z: open.z }, ends, rows };
      await testInfo.attach('jog', { body: JSON.stringify(summary), contentType: 'application/json' });
      console.log(`JOG-BUDGET ${JSON.stringify(summary)}`);
      expect(rows).toHaveLength(7);
      for (const row of rows) {
        expect(row.s, `${row.what}: px per mm`).toBeLessThanOrEqual(openingS);
        expect(row.vp, `${row.what}: scene layers re-culled, viewports of pixels`).toBeLessThanOrEqual(3);
      }
      const row = (what: string) => rows.find((r) => r.what === what)!;
      expect(row('jog right').dx, 'the jog right walked').toBeGreaterThan(100);
      expect(row('jog up').dy, 'the jog up raised the eye').toBeGreaterThan(50);
      expect(row('jog down and left').dx, 'the diagonal went left').toBeLessThan(-50);
      expect(row('jog down and left').dy, 'the diagonal went down').toBeLessThan(-50);
      // held into an end, the eye stops at it (within a frame's step), never past it
      const right = row('jog into the right end');
      expect(right.x, 'stopped at the right end, not past it').toBeLessThanOrEqual(ends.right);
      expect(right.x).toBeGreaterThan(ends.right - right.stepMm);
      const left = row('jog into the left end');
      expect(left.x, 'stopped at the left end, not past it').toBeGreaterThanOrEqual(ends.left);
      expect(left.x).toBeLessThan(ends.left + left.stepMm);
      for (const row of rows.filter((r) => r.what.startsWith('turned'))) {
        expect(row.yaw, `${row.what}: turned`).not.toBe(0);
        expect(row.dz, `${row.what}: toward the fronts`).toBeLessThan(0);
      }
    });
  }
}

// --- 18: the Free camera's openings, new baselines (the old 28 untouched) ------------------------------------------------

test.describe('baselines: the Free camera opening (level), every view, the four panels', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10, threshold: 0.05 } as const;
  for (const panel of FOLD8) {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      test(`free camera, ${view} view, ${panel.name}`, async ({ page }) => {
        await openFree(page, panel, { view, query: 'fx=3' });
        // the plates' and the arrows' text is whatever font the machine has: hidden, as in cabinet-screenshots.spec.ts
        await page.evaluate(() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('.cabinet-scene__step, .cabinet-scene__shelves button, .cab-figure__plate, .cab-plate, .cabinet-scene__fit, .cabinet-scene__fit *, .case-tabs *, .tab-bar * { color: transparent !important; }');
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        });
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-free-camera', '1');
        await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`free-camera-${view}-${panel.name}.png`, SHOT);
      });
    }
  }
});
