import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown } from './touch';
import { watchPull } from './pullWatch';
import { decodePng } from './paintCheck';
import { project, type Camera, type Vec3 } from '../src/components/display/caseCamera';
import { centreHit } from '../src/components/display/caseFraming';
import { wallLayout } from '../src/components/display/packCabinets';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';

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

// --- 13: Next from where you look ---------------------------------------------------------------------------------------

test('after a 20 deg look in the wall view, Next goes to the page after the one the frame centre shows (S7)', async ({ page }) => {
  await openFree(page, COVER, { swipe: 'pan' });
  await lookBy(page, 20);
  const looked = await cameraOf(page);
  expect(looked.yaw! / DEG).toBeCloseTo(20, 0);
  const wall = klingsbo((await wallOf(page)).length);
  const hit = centreHit(looked, wall);
  const span = (looked.z * looked.frame.width) / looked.focalPx;
  await page.locator('.cabinet-scene__step--next').tap();
  await settle(page);
  const after = await cameraOf(page);
  expect(after.yaw ?? 0, 'at the framing: straight').toBe(0);
  // on from the cabinet the look centred, by one page
  expect(after.x).toBeGreaterThan(hit.x);
  expect(after.x - hit.x).toBeLessThan(span * 1.5);
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
    await openFree(page, DESKTOP);
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
});

// --- 4, 5, 6, 8, 10: the pose log, the cone, no hole ---------------------------------------------------------------------

type Write = { t: number; camera: string; x: number; y: number; down: boolean; gesture: string | null };
type PointerLog = { t: number; type: string; x: number; y: number; camera: string };
type PoseLog = { writes: Write[]; events: PointerLog[]; translates: string[] };

/** From now on: every data-camera the scene writes (with the finger where it was then), every pointer event, every viewport translate. */
async function startPoseLog(page: Page) {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const viewport = host.querySelector<HTMLElement>('.cabinet-scene__viewport')!;
    const log = { writes: [] as unknown[], events: [] as unknown[], translates: [] as string[] };
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
      log.writes.push({ t: performance.now(), camera, x: finger.x, y: finger.y, down: finger.down, gesture: host.dataset.gesture ?? null });
    }).observe(host, { attributes: true, attributeFilter: ['data-camera'] });
    new MutationObserver(() => {
      if (/translate/.test(viewport.style.transform)) log.translates.push(viewport.style.transform);
    }).observe(viewport, { attributes: true, attributeFilter: ['style'] });
    (window as unknown as { __poseLog: typeof log }).__poseLog = log;
  });
}
const poseLog = (page: Page) => page.evaluate(() => (window as unknown as { __poseLog: PoseLog }).__poseLog);

/** A held finger: down, still `holdMs` (Look arms at 250), then along `path`, 16 ms a step. */
async function holdAndSweep(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], { holdMs = 300, lift = true } = {}) {
  const finger = await touchDown(page, from.x, from.y);
  await page.waitForTimeout(holdMs);
  for (const p of path) await finger.to(p.x, p.y, 24, 16);
  await page.waitForTimeout(50);
  if (lift) await finger.end();
  return finger;
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
    await openFree(page, panel, { query: 'fx=170' });
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

    // a look to each side's hard limit and back, the finger held (Look armed by the hold)
    const left = { x: f.x + 3, y };
    const right = { x: f.x + f.width - 3, y };
    await holdAndSweep(page, left, [right, left]);
    await settle(page);
    await holdAndSweep(page, right, [left, right]);
    await settle(page);
    const sweepEnd = (await poseLog(page)).writes.length;

    // the cone: held past the limit, let go there; 250 ms on, the shown yaw is the committed one (the soft limit). From
    // the middle of the wall (three pages on by the arrows), so a turn either way sees fronts
    for (let i = 0; i < 3; i++) {
      await page.locator('.cabinet-scene__step--next').tap();
      await settle(page, 400);
    }
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
      await page.locator('.cabinet-scene__reset').tap().catch(() => undefined);
      await settle(page, 400);
    }

    const log = await poseLog(page);
    const logPath = testInfo.outputPath('pose-log.json');
    writeFileSync(logPath, JSON.stringify({ panel: panel.name, cone, frame: f, swipes, walkEnd, sweepEnd, shot, settledYaw, log }));
    await testInfo.attach('pose-log', { path: logPath, contentType: 'application/json' });
    // 6: the viewport never slides
    expect(log.translates).toEqual([]);
    // 4: no write with the finger still and no spring running (within 250 ms of a lift)
    const ups = log.events.filter((e) => e.type === 'pointerup' || e.type === 'pointercancel').map((e) => e.t);
    const downs = log.events.filter((e) => e.type === 'pointerdown').map((e) => e.t);
    const unprompted = log.writes.filter((w, i) => {
      const prev = log.writes[i - 1];
      const lastUp = Math.max(-Infinity, ...ups.filter((t) => t <= w.t));
      const lastDown = Math.max(-Infinity, ...downs.filter((t) => t <= w.t));
      const fingerMoved = prev === undefined || prev.x !== w.x || prev.y !== w.y || prev.down !== w.down;
      // the ease back after a lift past the soft limit: 200 ms from the lift, its last write on the first frame after
      // (a frame here is up to ~60 ms: four panels' scenes drawn side by side); it turns the eye, never moves it
      const turnedOnly = prev !== undefined && (['x', 'y', 'z'] as const).every((k) => parse(prev.camera)[k] === parse(w.camera)[k]);
      const springing = lastUp > lastDown && w.t - lastUp <= 200 + 100 && turnedOnly;
      // a press or a lift (a re-render on release) or an arrow / Reset tap (a re-base, the finger down on a control)
      const tapped = w.t - Math.max(lastUp, lastDown) <= 250;
      return !fingerMoved && !springing && !tapped;
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

    // 5: the pose at each pointerup of a walk is the pose its last move left (no settle)
    const upsInWalk = log.events.filter((e) => e.type === 'pointerup' && e.t <= (log.writes[walkEnd - 1]?.t ?? 0));
    for (const up of upsInWalk) {
      const after = log.writes.filter((w) => w.t > up.t && w.t - up.t < 200);
      expect(after.map((w) => w.camera), 'no write after a walk lifts').toEqual([]);
    }

    const summary = { panel: panel.name, cone, swipes, walkWrites: walkEnd, moveGestures: gestures.size, worstMovePx, worstLookDeg, maxShown, held: shot, settledYaw, writes: log.writes.length };
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

type YawBudget = { left: { hard: number; vp: number; fit: number | null }; right: { hard: number; vp: number; fit: number | null }; ms: number };
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
  projectedAtHard: number;
  b: boolean;
  fit: number | null;
  ms: number;
  freshViewports: number;
  freshDrawn: number;
  letGo: number;
};

for (const panel of FOLD8) {
  for (const wall of DENSE) {
    // NAV-1A a+b (Ross 10-28): turned, the scene keeps the framing's px per mm (a); where its projected layers would still
    // pass the ceiling the turn stops at the last yaw that fits (b). Each case says which acted and where the turn ended.
    test(`budget ${panel.name}, ${wall.name}: at the hard yaw both ways, scene layers <= 3 viewports, drawn <= cap every frame`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await openFree(page, panel, { query: wall.query });
      const opening = Number(await page.locator('.cabinet-scene').getAttribute('data-drawn-cap'));
      const openingS = Number(await page.locator('.cabinet-scene').getAttribute('data-px-per-mm'));
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
      const out: BudgetRow[] = [];
      // a turn to the right (the finger right to left) and then to the left
      for (const [from, to] of [[f.x + f.width - 3, f.x + 3], [f.x + 3, f.x + f.width - 3]]) {
        const finger = await holdAndSweep(page, { x: from, y }, [{ x: to, y }], { lift: false });
        await settle(page, 400);
        const layers = await sceneLayerArea(page);
        const host = page.locator('.cabinet-scene');
        const cam = await cameraOf(page);
        const budget = JSON.parse((await host.getAttribute('data-yaw-budget'))!) as YawBudget;
        // the finger right to left turns the eye right
        const side = to < from ? budget.right : budget.left;
        const row: BudgetRow = {
          yaw: Number((cam.yaw! / DEG).toFixed(2)),
          drawn: Number(await host.getAttribute('data-drawn-cabinets')),
          cap: Number(await host.getAttribute('data-drawn-cap')),
          figures: Number(await host.getAttribute('data-drawn-figures')),
          sceneLayers: layers.sceneLayers,
          sceneViewports: Number((layers.sceneArea / viewport).toFixed(3)),
          // (a): the px per mm drawn at the held pose and what the turned view there asked (read once the scene has rendered
          // it, below); (b): the projection at the hard limit and the fit, if any
          s: 0,
          asked: 0,
          a: false,
          projectedAtHard: side.vp,
          b: side.fit !== null,
          fit: side.fit,
          ms: budget.ms,
          // the cull lags the turn (stickyPose): a 1 px fold while held re-culls at the held pose itself, the most a render
          // there can draw (an image arriving would do the same)
          freshViewports: 0,
          freshDrawn: 0,
          letGo: 0,
        };
        await page.setViewportSize({ width: panel.width, height: panel.height + 1 });
        await settle(page, 400);
        row.freshViewports = Number(((await sceneLayerArea(page)).sceneArea / viewport).toFixed(3));
        row.freshDrawn = Number(await host.getAttribute('data-drawn-cabinets'));
        row.s = Number(await host.getAttribute('data-px-per-mm'));
        row.asked = Number(await host.getAttribute('data-turned-px-per-mm'));
        row.a = row.asked > row.s;
        await finger.end();
        await settle(page, 400);
        row.letGo = Number((((await cameraOf(page)).yaw ?? 0) / DEG).toFixed(2));
        await page.setViewportSize({ width: panel.width, height: panel.height });
        await settle(page, 400);
        out.push(row);
        await page.locator('.cabinet-scene__reset').tap().catch(() => undefined);
        await settle(page, 400);
      }
      const caps = await page.evaluate(() => (window as unknown as { __caps: [number, number][] }).__caps);
      const summary = { panel: panel.name, wall: wall.name, openingCap: opening, openingS, cone, held: out, frames: caps.length };
      await testInfo.attach('budget', { body: JSON.stringify(summary), contentType: 'application/json' });
      console.log(`BUDGET ${JSON.stringify(summary)}`);
      expect(caps.filter(([d, c]) => d > c), 'drawn past the cap').toEqual([]);
      for (const row of out) {
        expect(row.cap).toBeLessThanOrEqual(20);
        expect(row.sceneViewports, `scene layers at yaw ${row.yaw}, viewports of pixels`).toBeLessThanOrEqual(3);
        expect(row.freshViewports, `scene layers re-culled at yaw ${row.yaw}, viewports of pixels`).toBeLessThanOrEqual(3);
        // (a): turned, never sharper than the opening; what the turned view asks is published beside it
        expect(row.s, `px per mm at yaw ${row.yaw}`).toBe(openingS);
        expect(row.asked, `asked at yaw ${row.yaw}`).toBeGreaterThan(0);
        // (b): engaged only where the projection at the hard limit passes the ceiling; then the turn never passes the fit, and
        // otherwise the full turn is kept (past the soft limit toward the hard one)
        expect(row.b).toBe(row.projectedAtHard > 3);
        if (row.fit !== null) expect(Math.abs(row.yaw)).toBeLessThanOrEqual(row.fit + 0.01);
        else expect(Math.abs(row.yaw)).toBeGreaterThanOrEqual(cone.soft - 0.01);
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
