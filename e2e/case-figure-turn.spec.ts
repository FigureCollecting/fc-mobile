import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { JOG_FULL_PX, JOG_MAX_STEP_MS } from '../src/components/display/casePose';
import { FIGURE_TURN_CAP_RAD } from '../src/components/display/figureTurn';

/**
 * NAV-FLAT (Ross 11-15), in Chromium on a desktop window, fixture mode, Ross's wall (the KLINGSBO with the Detolf and the
 * rack): every drawn figure turned part of the way toward where the eye stands. The hat walks the eye sideways and the
 * figures' turns follow the eye's x, frame by frame while it is held; a pure camera turn (a right drag: the eye still)
 * turns none; the browser draws a turned figure facing the eye more (wider on screen than unturned); the Classic camera
 * turns them too; off turns none.
 */

test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const DESKTOP = { width: 1920, height: 1000 };
const PATTERN = 'ikea-klingsbo+ikea-detolf+open-steel-rack';
const DEG = Math.PI / 180;

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

/** `ms` and as many frames as a drive counts in `ms` (a loaded runner's frames come far apart). */
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

async function open(page: Page, prefs: Record<string, unknown> = {}) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0, pattern: p.pattern, ...p.prefs }));
  }, { pattern: PATTERN, prefs });
  await page.setViewportSize(DESKTOP);
  await page.goto('/?layout=case&fx=40');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await settle(page, 500);
}

type Turn = { id: string; yaw: number; translate: string; shadow: [string, string]; x: number; z: number };
type Eye = { x: number; z: number; yaw?: number; pitch: number };
const eyeOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Eye;

/**
 * The eye drawn now and every drawn figure's turn (its rotate as radians, its translate), its shadow's, and its pivot
 * (world mm), read in one go (a held drive moves on between two reads).
 */
const stateOf = (page: Page) =>
  page.evaluate((deg) => {
    const eye = JSON.parse(document.querySelector<HTMLElement>('.cabinet-scene')!.dataset.camera!) as Eye;
    const turns = Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => {
      const m = /^y (-?[\d.e-]+)deg$/.exec(b.style.rotate);
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
      const d = JSON.parse(b.dataset.depth!) as { front: number };
      const shadow = b.previousElementSibling as HTMLElement;
      return {
        id: b.dataset.figureId!,
        yaw: m ? Number(m[1]) * deg : 0,
        translate: b.style.translate,
        shadow: [shadow.style.rotate, shadow.style.translate] as [string, string],
        x: (w.x0 + w.x1) / 2,
        z: d.front,
      };
    });
    return { eye, turns };
  }, DEG);
const turnsOf = async (page: Page) => (await stateOf(page)).turns;

/**
 * Each figure turned no further than k x its angle to the eye, toward it, its shadow with it; how many by the rule exactly.
 * The rest are held short by their footprint clamp (on this wall about a fifth at the opening: wide or deep bases near an
 * inner side, whose back corner would swing into it).
 */
function checkRule(turns: Turn[], eye: Eye, k: number): number {
  let exact = 0;
  for (const t of turns) {
    const want = Math.max(-FIGURE_TURN_CAP_RAD, Math.min(FIGURE_TURN_CAP_RAD, k * Math.atan2(eye.x - t.x, eye.z - t.z)));
    if (t.yaw !== 0) expect(Math.sign(t.yaw), t.id).toBe(Math.sign(want));
    expect(Math.abs(t.yaw), t.id).toBeLessThanOrEqual(Math.abs(want) + 1e-6);
    if (Math.abs(t.yaw - want) < 1e-6) exact++;
    expect(t.shadow, `${t.id}'s shadow turns with it`).toEqual([t.yaw === 0 ? '' : expect.stringMatching(/^y /), t.translate]);
  }
  return exact;
}

const byId = (turns: Turn[]) => new Map(turns.map((t) => [t.id, t]));

/** A mouse on the hat (the bottom-centre button's jog), pulled `dx` and held `ms`; the frames' turns sampled meanwhile. */
async function hatWalk(page: Page, dx: number, ms: number, sample?: () => Promise<void>) {
  const b = (await page.locator('.tab-bar__add[data-jog]').boundingBox())!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + (dx * i) / 6, at.y);
  await hold(page, ms / 2);
  await sample?.();
  await hold(page, ms / 2);
  await sample?.();
  await page.mouse.up();
  await settle(page, 400);
}

async function rightDrag(page: Page, dx: number) {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const x = f.x + f.width / 2;
  const y = f.y + f.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up({ button: 'right' });
  await settle(page, 600);
}

test('NAV-FLAT: the hat walks the eye sideways and the figures turn with its x, frame by frame; a pure camera turn turns none', async ({ page }) => {
  await open(page);
  const e0 = await eyeOf(page);
  const t0 = await turnsOf(page);
  expect(t0.length).toBeGreaterThan(20);
  expect(checkRule(t0, e0, 0.5)).toBeGreaterThan(t0.length * 0.6);
  expect(t0.filter((t) => t.yaw > 0).length).toBeGreaterThan(0);
  expect(t0.filter((t) => t.yaw < 0).length).toBeGreaterThan(0);

  // held: two samples while the hat walks, each the rule's at the eye drawn then, and different from each other
  const held: { eye: Eye; turns: Turn[] }[] = [];
  // at half reach, a short walk: most figures stay drawn from one rest to the next
  await hatWalk(page, JOG_FULL_PX / 2, 1000, async () => {
    held.push(await stateOf(page));
  });
  expect(held).toHaveLength(2);
  expect(held[1].eye.x, 'the hat walked the eye right').toBeGreaterThan(held[0].eye.x);
  expect(held[0].eye.x).toBeGreaterThan(e0.x);
  for (const h of held) {
    expect(h.eye.z).toBe(e0.z);
    expect(checkRule(h.turns, h.eye, 0.5), 'mid-walk, each frame turned for the eye drawn then').toBeGreaterThan(h.turns.length * 0.6);
  }
  expect(held[1].turns.map((t) => t.yaw)).not.toEqual(held[0].turns.map((t) => t.yaw));
  const e1 = await eyeOf(page);
  const t1 = await turnsOf(page);
  expect(checkRule(t1, e1, 0.5)).toBeGreaterThan(t1.length * 0.6);
  // every figure drawn at both rests whose turn the rule moved, moved toward the eye's new x (more toward +x)
  const before = byId(t0);
  let moved = 0;
  for (const t of t1) {
    const was = before.get(t.id);
    if (!was || was.yaw === t.yaw) continue;
    expect(t.yaw, t.id).toBeGreaterThan(was.yaw);
    moved++;
  }
  expect(moved, `${t1.filter((t) => before.has(t.id)).length} drawn at both rests; eye x ${e0.x} -> ${e1.x}`).toBeGreaterThan(10);

  // a right drag turns the head only: the eye stands where it was and no figure drawn before and after turns at all
  await rightDrag(page, -160);
  const e2 = await eyeOf(page);
  expect(e2.yaw, 'the right drag turned the camera').not.toBe(e1.yaw ?? 0);
  expect([e2.x, e2.z]).toEqual([e1.x, e1.z]);
  const t2 = await turnsOf(page);
  const was = byId(t1);
  const both = t2.filter((t) => was.has(t.id));
  expect(both.length).toBeGreaterThan(10);
  for (const t of both) expect([t.yaw, t.translate], t.id).toEqual([was.get(t.id)!.yaw, was.get(t.id)!.translate]);
});

test('NAV-FLAT: the browser draws a turned figure facing the eye more: wider on screen than with its turn lifted', async ({ page }) => {
  await open(page, { figureTurn: 'strong' });
  // walk well off to one side, so the far figures stand at a steep angle
  await hatWalk(page, -JOG_FULL_PX, 1500);
  const turns = (await turnsOf(page)).filter((t) => Math.abs(t.yaw) > 8 * DEG);
  expect(turns.length).toBeGreaterThan(3);
  const widths = await page.evaluate((ids) => {
    return ids.map((id) => {
      const b = document.querySelector<HTMLElement>(`button.cab-figure[data-figure-id="${id}"]`)!;
      const turned = b.getBoundingClientRect().width;
      const [r, t] = [b.style.rotate, b.style.translate];
      b.style.rotate = '';
      b.style.translate = '';
      const flat = b.getBoundingClientRect().width;
      b.style.rotate = r;
      b.style.translate = t;
      return { id, turned, flat };
    });
  }, turns.map((t) => t.id));
  for (const w of widths) expect(w.turned, `${w.id} faces the eye more turned`).toBeGreaterThan(w.flat * 1.005);
});

test('NAV-FLAT: the Classic camera turns them toward its eye, and again as a drag walks it', async ({ page }) => {
  await open(page, { freeCamera: false });
  const e0 = await eyeOf(page);
  const t0 = await turnsOf(page);
  expect(checkRule(t0, e0, 0.5)).toBeGreaterThan(t0.length * 0.6);
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(f.x + f.width / 2 - 30 * i, f.y + f.height / 2);
  await page.mouse.up();
  await settle(page, 800);
  const e1 = await eyeOf(page);
  expect(e1.x).not.toBe(e0.x);
  const t1 = await turnsOf(page);
  expect(checkRule(t1, e1, 0.5)).toBeGreaterThan(t1.length * 0.6);
  expect(t1.map((t) => t.yaw)).not.toEqual(t0.map((t) => t.yaw));
});

test('NAV-FLAT: off turns no figure, wherever the hat walks the eye', async ({ page }) => {
  await open(page, { figureTurn: 'off' });
  const none = async () => {
    const turns = await turnsOf(page);
    expect(turns.length).toBeGreaterThan(20);
    for (const t of turns) expect([t.yaw, t.translate, ...t.shadow], t.id).toEqual([0, '', '', '']);
  };
  await none();
  await hatWalk(page, JOG_FULL_PX, 1200);
  await none();
});
