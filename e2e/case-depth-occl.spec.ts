import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { decodePng, type Rgba } from './paintCheck';

/**
 * NAV-DEPTH-OCCL (Ross 11-15): walking the Free camera in with the depth rocker near the cabinets, parts of them (a
 * Detolf's glass, sides, shelves and the figures on them; a rack's lower board) vanished at certain depths and came back
 * closer. Our cull never dropped them: Chromium stops drawing parts of the 3D scene when the CSS z = 0 plane runs through
 * or near them, and the root's transform put that plane between the eye and the cabinets' feet. Now it stands past the
 * room.
 *
 * In Chromium, fixture mode, Ross's wall (KLINGSBO, Detolf, open steel rack), the desktop and the Fold8's open panel at
 * a device pixel ratio of 1 (where the loss is largest; at the Fold8's own 2.8125 it barely shows), the rocker walks the
 * eye from the framing to about a metre from the fronts in small steps. At each rest the page as drawn (A) is compared
 * with two references (R): the same DOM with only the scale about the eye changed, so the plane stands in front of
 * everything (a quarter of the way to the nearest cabinet) or far past the room (the picture is the same; only the
 * plane moves). A pixel is lost when A differs from both: a part both draw and A does not. (The near reference alone
 * drops a glass shelf's thin front edge here and there, a few hundred px, which the page draws.) Full-page captures
 * only: a clipped capture re-renders through a viewport override, which hides the loss (NAV-OCCL verify, finding 4).
 */

test.describe.configure({ mode: 'parallel' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const PATTERN = 'ikea-klingsbo+ikea-detolf+open-steel-rack';
/** A pixel counts as lost when a colour channel differs from R by more than this. */
const DELTA = 48;
/** Steps of about this many mm (the vanish runs at the band ends are 50 to 150 mm long). */
const STEP_MM = 30;

/** More than this many px lost at a step fails it: before the fix a vanish lost 8k to 29k px on the desktop and 0.7k to 4k on the
 * Fold8's open panel, and a thin edge 300 to 600; after it, 0 or 1 px against the references. */
const LOST_PX = 300;
const SIZES = [
  // what the canary drew for Ross (desktop, ~2000 px wide), and the Fold8's open panel
  { name: 'desktop 1920x1000', width: 1920, height: 1000, stopZ: 1000 },
  { name: 'Fold8 open 870x475', width: 870, height: 475, stopZ: 1000 },
];

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

type Cam = { x: number; y: number; z: number; focalPx: number };
type State = { cam: Cam; s: number; transform: string; drawn: number[]; elements: number };

const state = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const root = document.querySelector<HTMLElement>('.cabinet-scene__root')!;
    return {
      cam: JSON.parse(host.dataset.camera!),
      s: Number(host.dataset.pxPerMm),
      transform: root.style.transform,
      drawn: Array.from(root.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)),
      elements: root.querySelectorAll('*').length,
    };
  });

/** The root's transform with its scale about the eye set to `k` (any scale there is replaced; none: one is put in). */
function withScale(transform: string, k: number): string {
  const unscaled = transform.replace(/ scale3d\([^)]*\)/, '');
  const at = unscaled.lastIndexOf(' translate3d(');
  return `${unscaled.slice(0, at)} scale3d(${k}, ${k}, ${k})${unscaled.slice(at)}`;
}

const setTransform = (page: Page, t: string) =>
  page.evaluate((t) => {
    document.querySelector<HTMLElement>('.cabinet-scene__root')!.style.transform = t;
  }, t);

const differs = (a: Rgba, b: Rgba, i: number) =>
  Math.abs(a.data[i] - b.data[i]) > DELTA || Math.abs(a.data[i + 1] - b.data[i + 1]) > DELTA || Math.abs(a.data[i + 2] - b.data[i + 2]) > DELTA;

/** Pixels inside `box` (CSS px at DPR 1) where `a` differs by more than DELTA on a channel from both references. */
function lostPx(a: Rgba, [r1, r2]: readonly [Rgba, Rgba], box: { x: number; y: number; width: number; height: number }): number {
  let n = 0;
  const x1 = Math.min(a.width, Math.floor(box.x + box.width));
  const y1 = Math.min(a.height, Math.floor(box.y + box.height));
  for (let y = Math.max(0, Math.ceil(box.y)); y < y1; y++)
    for (let x = Math.max(0, Math.ceil(box.x)); x < x1; x++) {
      const i = (y * a.width + x) * 4;
      if (differs(a, r1, i) && differs(a, r2, i)) n++;
    }
  return n;
}

async function open(page: Page, size: { width: number; height: number }) {
  await page.addInitScript((pattern) => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0, depthRocker: 'vertical', pattern }));
  }, PATTERN);
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=40');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await settle(page, 800);
}

/** One push of the rocker toward the wall (up = closer), held `ms`, then let go and settled. */
async function push(page: Page, ms: number) {
  const b = (await page.locator('.depth-rocker').boundingBox())!;
  const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 8, { steps: 2 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await settle(page, 400);
}

for (const size of SIZES) {
  test(`NAV-DEPTH-OCCL ${size.name}: walked in by the rocker, no step loses a drawn part of the cabinets`, async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await open(page, size);
    const frame = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const box = { x: frame.x, y: frame.y, width: frame.width, height: Math.min(frame.height, size.height - frame.y) };
    const wall = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!) as number[][];
    const rows: { z: number; s: number; plane: number; lost: number; elements: number }[] = [];
    const control: { z: number; plane: number; lost: number }[] = [];
    let st = await state(page);
    const z0 = st.cam.z;
    let hold = 120;
    for (let n = 0; st.cam.z > size.stopZ && n < 200; n++) {
      // the cabinet straight ahead of the eye is drawn at every step
      const ahead = wall.findIndex(([x0, x1]) => st.cam.x >= x0 && st.cam.x <= x1);
      if (ahead >= 0) expect(st.drawn, `z ${st.cam.z}: the cabinet ahead`).toContain(ahead);
      const a = decodePng(await page.screenshot());
      // R: two placements of the plane the picture agrees on: a quarter of the way to the nearest cabinet (k = 4 over the
      // px per mm alone), in front of everything, and 16 times as far as that (k = 1/16), past the room
      const r: Rgba[] = [];
      for (const k of [4, 1 / 16]) {
        await setTransform(page, withScale(st.transform, k));
        await settle(page, 150);
        r.push(decodePng(await page.screenshot()));
      }
      const refs = [r[0], r[1]] as const;
      await setTransform(page, st.transform);
      await settle(page, 150);
      const lost = lostPx(a, refs, box);
      const k = Number(/scale3d\(([^,]+),/.exec(st.transform)?.[1] ?? 1);
      // the positive control: where the plane stood before (f / s mm out, k = 1) is 60 to 180 mm in front of the fronts,
      // the same DOM drawn with that plane loses parts here, so a step that lost them would have been seen
      const oldPlane = st.cam.z - st.cam.focalPx / st.s;
      if (oldPlane >= 60 && oldPlane <= 180 && control.length < 4) {
        await setTransform(page, withScale(st.transform, 1));
        await settle(page, 150);
        control.push({ z: Math.round(st.cam.z), plane: Math.round(oldPlane), lost: lostPx(decodePng(await page.screenshot()), refs, box) });
        await setTransform(page, st.transform);
        await settle(page, 150);
      }
      rows.push({ z: Math.round(st.cam.z), s: st.s, plane: Math.round(st.cam.z - st.cam.focalPx / (k * st.s)), lost, elements: st.elements });
      const before = st.cam.z;
      await push(page, hold);
      st = await state(page);
      // keep the steps near STEP_MM: the rocker's speed eases in toward the wall
      const moved = before - st.cam.z;
      hold = Math.round(Math.min(600, Math.max(40, (hold * STEP_MM) / Math.max(1, moved))));
    }
    writeFileSync(testInfo.outputPath('steps.json'), JSON.stringify({ rows, control }, null, 1));
    await testInfo.attach('steps.json', { path: testInfo.outputPath('steps.json'), contentType: 'application/json' });
    // a walk that went nowhere would prove nothing
    expect(rows.length, 'steps walked').toBeGreaterThan(30);
    expect(z0 - st.cam.z, 'mm walked').toBeGreaterThan(1500);
    const bad = rows.filter((row) => row.lost > LOST_PX).map((row) => `z ${row.z} (s ${row.s}, plane at ${row.plane} mm): ${row.lost} px lost`);
    expect(bad).toEqual([]);
    // the detector sees a loss in this browser: the old plane, at a step it fell in front of the fronts, loses parts
    expect(control.length, 'steps with the old plane in front of the fronts').toBeGreaterThan(0);
    expect(Math.max(...control.map((c) => c.lost)), JSON.stringify(control)).toBeGreaterThan(LOST_PX);
  });
}
