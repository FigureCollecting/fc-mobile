import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { project, unprojectToPlaneZ, type Camera, type Vec3 } from '../src/components/display/caseCamera';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';

/**
 * CASE-FB1 (Ross's first Fold8 session, 10-14): the case is framed full height, from a strip of floor in front of the
 * feet to just above the top surface (what stands on the top shows); a sideways walk or pan moves the picture
 * sideways only, never up or down; the room's ceiling setting reaches the drawn room; and an up/down drag pans the
 * picture (pan mode) or raises and lowers the camera (camera mode) between the floor and the ceiling. Fixture mode,
 * the KLINGSBO wall, at the Fold8's four panels.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const H = IKEA_KLINGSBO.outer.heightMm;
const FEET_FRONT_MM = IKEA_KLINGSBO.footprint!.frontOverhangMm;
/** Ross: the floor line and the top line hold still within this many px. */
const STILL_PX = 1;
/** The KLINGSBO with the Detolf and the open steel rack alongside: three heights, three widths. */
const MIXED = 'ikea-klingsbo+ikea-detolf+open-steel-rack';

type Prefs = { view?: 'wall' | 'cabinet' | 'shelf'; swipe?: 'camera' | 'pan'; pattern?: string; ceilingMm?: number };

async function openCase(page: Page, size: { width: number; height: number }, prefs: Prefs, query = '&fx=170') {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  await page.waitForTimeout(300);
}

/** The picture as the scene publishes it: its camera (whose frame is the drawn frame), and how far it is slid. */
async function picture(page: Page) {
  const host = page.locator('.cabinet-scene');
  const c = JSON.parse((await host.getAttribute('data-camera'))!);
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
  const panX = Number(await host.getAttribute('data-pan'));
  const panY = Number((await host.getAttribute('data-pan-y')) ?? 0);
  // the drawn frame on the page: the scene, or the part of it the picture is drawn in
  const frame = await host.evaluate((h) => {
    const r = (h.querySelector('.cabinet-scene__frame') ?? h).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { camera, panX, panY, frame };
}

/** Where a level world line (height y, depth z) draws, px from the frame's top: the same at any x, as the camera never turns sideways. */
const lineY = (p: Awaited<ReturnType<typeof picture>>, y: number, z: number) => project(p.camera, [p.camera.x, y, z]).y + p.panY;

/** The floor line under the feet's front, and the cabinets' top line at their front. */
const lines = (p: Awaited<ReturnType<typeof picture>>) => ({ floor: lineY(p, 0, FEET_FRONT_MM), top: lineY(p, H, 0) });

async function swipe(page: Page, dx: number, dy = 0) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width * (dx < 0 ? 0.7 : dx > 0 ? 0.3 : 0.5);
  const y = scene.y + scene.height * (dy < 0 ? 0.7 : dy > 0 ? 0.3 : 0.5);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(60);
}

// item 2: no vertical jump. A walk or a pan along the wall, twenty swipes each way, from the picture as it opens: the
// floor line and the cabinets' top line never move up or down
for (const size of FOLD8) {
  for (const swipeMode of ['camera', 'pan'] as const) {
    for (const view of ['wall', 'cabinet'] as const) {
      for (const pattern of [undefined, MIXED]) {
      test(`no vertical jump: 20 swipes each way hold the floor and top lines still, ${view} view${pattern ? ', the mixed wall' : ''}, ${swipeMode} mode: ${size.name}`, async ({ page }) => {
        test.setTimeout(240_000);
        await openCase(page, size, { view, swipe: swipeMode, ...(pattern ? { pattern } : {}) });
        const start = await picture(page);
        const at = lines(start);
        const moved: { step: string; floor: number; top: number; x: number }[] = [];
        let worst = 0;
        let travelled = 0;
        for (const dx of [-150, 150]) {
          for (let k = 0; k < 20; k++) {
            await swipe(page, dx);
            const now = await picture(page);
            const l = lines(now);
            const off = Math.max(Math.abs(l.floor - at.floor), Math.abs(l.top - at.top));
            travelled = Math.max(travelled, Math.abs(now.camera.x - now.panX * (now.camera.z / now.camera.focalPx) - (start.camera.x - start.panX * (start.camera.z / start.camera.focalPx))));
            if (off > worst) worst = off;
            if (off > STILL_PX) moved.push({ step: `${dx < 0 ? 'left' : 'right'} ${k + 1}`, floor: +(l.floor - at.floor).toFixed(1), top: +(l.top - at.top).toFixed(1), x: Math.round(now.camera.x) });
          }
        }
        console.log(`case-fb1 jump ${JSON.stringify({ panel: size.name, view, pattern: pattern ?? 'default', swipe: swipeMode, worstPx: +worst.toFixed(2), travelledMm: Math.round(travelled), moved: moved.length })}`);
        expect(travelled, 'the swipes moved the picture along the wall').toBeGreaterThan(300);
        expect(moved, `swipes that moved the floor or top line by more than ${STILL_PX} px (worst ${worst.toFixed(1)} px)`).toEqual([]);
      });
      }
    }
  }
}

// item 1: full height. The single cabinet and the wall: a strip of floor in front of the feet, the top surface and what
// stands on it inside the frame
for (const size of FOLD8) {
  for (const view of ['wall', 'cabinet'] as const) {
    test(`full height: a floor strip, the top surface and a figure on the top inside the frame, ${view} view: ${size.name}`, async ({ page }) => {
      await openCase(page, size, { view, swipe: 'camera' });
      const p = await picture(page);
      const { camera } = p;
      const wall = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!) as number[][];
      const look = unprojectToPlaneZ(camera, camera.frame.width / 2, camera.frame.height / 2, 0)!;
      // the cabinets standing whole across the frame (their bodies, at the height it aims at): the focus, in the cabinet view
      const across = wall.flatMap(([x0, x1], i) =>
        [x0, x1].every((x) => {
          const px = project(camera, [x, look[1], 0]).x + p.panX;
          return px >= 0 && px <= camera.frame.width;
        })
          ? [i]
          : [],
      );
      expect(across.length, 'cabinets whole across the frame').toBeGreaterThan(0);
      const strip = camera.frame.height - lineY(p, 0, FEET_FRONT_MM);
      // the top surface, back and front edges, of every cabinet across
      const tops: Vec3[] = across.flatMap((i) => [wall[i][0], wall[i][1]].flatMap((x) => [[x, H, 0] as Vec3, [x, H, -IKEA_KLINGSBO.outer.depthMm] as Vec3]));
      const topY = Math.min(...tops.map((t) => project(camera, t).y + p.panY));
      // what stands on the tops of those cabinets, as the browser draws it
      const onTop = await page.locator('button.cab-figure').evaluateAll(
        (els, [h, xs]) =>
          els.flatMap((el) => {
            const w = JSON.parse((el as HTMLElement).dataset.world!);
            if (!(w.y0 >= h - 1) || !xs.some(([a, b]: number[]) => w.x0 >= a - 1 && w.x1 <= b + 1)) return [];
            const r = el.getBoundingClientRect();
            return [{ name: el.getAttribute('aria-label'), top: r.top, bottom: r.bottom, left: r.left, right: r.right }];
          }),
        [H, across.map((i) => [wall[i][0], wall[i][1]])] as const,
      );
      console.log(`case-fb1 height ${JSON.stringify({ panel: size.name, view, frame: `${camera.frame.width}x${camera.frame.height}`, distanceMm: Math.round(camera.z), eyeMm: Math.round(camera.y), pitchDeg: +((camera.pitch * 180) / Math.PI).toFixed(2), across: across.length, floorStripPx: +strip.toFixed(1), topPx: +topY.toFixed(1), onTop: onTop.length })}`);
      expect(strip, 'a strip of floor in front of the feet (px)').toBeGreaterThan(0);
      expect(topY, 'the top surface inside the frame (px from its top)').toBeGreaterThanOrEqual(0);
      expect(onTop.length, 'figures standing on the tops of the cabinets across').toBeGreaterThan(0);
      for (const f of onTop) {
        expect(f.top, `${f.name} on the top: inside the frame's top`).toBeGreaterThanOrEqual(p.frame.y - 1);
        expect(f.bottom, `${f.name} on the top: inside the frame's bottom`).toBeLessThanOrEqual(p.frame.y + p.frame.height + 1);
      }
    });
  }
}

/** The room's back wall as the browser draws it: its top and its height on the page. */
async function roomWall(page: Page) {
  return page.locator('.cabinet-scene .room-wall').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });
}

/** Set the View card's room ceiling (inches) and close the card. */
async function setCeiling(page: Page, inches: number) {
  await page.getByRole('button', { name: 'View' }).click();
  const input = page.getByRole('spinbutton', { name: /ceiling/i });
  await input.fill(String(inches));
  await input.press('Enter');
  await input.blur();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// item 3: the room's ceiling setting reaches the drawn room
for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`room height: changing the ceiling changes the drawn wall's height, its top where the ceiling is: ${size.name}`, async ({ page }) => {
    await openCase(page, size, { view: 'cabinet', swipe: 'camera', ceilingMm: 96 * 25.4 });
    const low = await roomWall(page);
    const lowPic = await picture(page);
    await setCeiling(page, 110);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).ceilingMm).toBeCloseTo(110 * 25.4, 3);
    const high = await roomWall(page);
    const highPic = await picture(page);
    console.log(`case-fb1 room ${JSON.stringify({ panel: size.name, low, high })}`);
    // the camera frames the cabinets the same (their headroom is under both ceilings): only the room changes
    expect(highPic.camera).toEqual(lowPic.camera);
    expect(Math.abs(high.height - low.height), 'the drawn wall is taller under a higher ceiling (px)').toBeGreaterThan(5);
    expect(high.top, 'its top edge rises').toBeLessThan(low.top - 5);
    // and the wall's top is the ceiling's line on the back wall, wherever the frame and its margin show it
    const room = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-room'))!) as { ceilingMm: number; zBack: number };
    expect(room.ceilingMm).toBeCloseTo(110 * 25.4, 3);
    const ceilingY = highPic.frame.y + project(highPic.camera, [highPic.camera.x, room.ceilingMm, room.zBack]).y;
    if (ceilingY > highPic.frame.y - highPic.frame.height / 2) expect(Math.abs(high.top - ceilingY), 'the wall ends at the ceiling').toBeLessThan(1.5);
  });
}

// item 5: vertical pan
for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`vertical pan, pan mode: an up/down drag slides the picture up and down between the floor and the ceiling, never sideways: ${size.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openCase(page, size, { view: 'wall', swipe: 'pan' });
    const start = await picture(page);
    await swipe(page, 0, 120);
    const down = await picture(page);
    expect(down.panY, 'a drag down slides the picture down').toBeGreaterThan(start.panY + 20);
    expect(down.panX, 'and never sideways').toBe(start.panX);
    expect(down.camera, 'the camera stays put').toEqual(start.camera);
    // dragged on down: it stops where the ceiling over the cabinets' front reaches the frame's top
    for (let k = 0; k < 15; k++) await swipe(page, 0, 150);
    const top = await picture(page);
    const ceiling = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-room'))!).ceilingMm as number;
    expect(lineY(top, ceiling, 0), 'the ceiling line at the frame top, not past it').toBeGreaterThan(-STILL_PX);
    expect(lineY(top, ceiling, 0)).toBeLessThan(STILL_PX);
    // dragged back up: it stops where it opened, the floor strip in view
    for (let k = 0; k < 20; k++) await swipe(page, 0, -150);
    const back = await picture(page);
    expect(back.panY).toBe(start.panY);
    expect(lineY(back, 0, FEET_FRONT_MM), 'the floor line inside the frame').toBeLessThan(back.camera.frame.height);
  });

  test(`vertical pan, camera mode: an up/down drag raises and lowers the camera between the floor and the ceiling, never sideways: ${size.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openCase(page, size, { view: 'wall', swipe: 'camera' });
    const start = await picture(page);
    await swipe(page, 0, 120);
    const up = await picture(page);
    expect(up.camera.y, 'a drag down raises the camera').toBeGreaterThan(start.camera.y + 20);
    expect(up.camera.x, 'never sideways').toBe(start.camera.x);
    expect(up.camera.z, 'nor nearer or farther').toBe(start.camera.z);
    expect(up.camera.pitch, 'nor tilted').toBe(start.camera.pitch);
    const ceiling = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-room'))!).ceilingMm as number;
    for (let k = 0; k < 20; k++) await swipe(page, 0, 200);
    const high = await picture(page);
    expect(high.camera.y, 'no higher than the ceiling').toBeLessThanOrEqual(ceiling + 1e-6);
    const aimHigh = unprojectToPlaneZ(high.camera, high.camera.frame.width / 2, high.camera.frame.height / 2, 0)![1];
    expect(aimHigh, 'aimed no higher than the ceiling').toBeLessThanOrEqual(ceiling + 1e-6);
    for (let k = 0; k < 40; k++) await swipe(page, 0, -200);
    const low = await picture(page);
    expect(low.camera.y, 'no lower than the floor').toBeGreaterThanOrEqual(-1e-6);
    const aimLow = unprojectToPlaneZ(low.camera, low.camera.frame.width / 2, low.camera.frame.height / 2, 0)![1];
    expect(aimLow, 'aimed no lower than the floor').toBeGreaterThanOrEqual(-1e-6);
    expect(low.camera.y).toBeLessThan(high.camera.y);
    // a walk from a raised camera keeps it raised: the floor and top lines hold
    await swipe(page, 0, 150);
    const raised = await picture(page);
    await swipe(page, -150);
    const walked = await picture(page);
    expect(walked.camera.x).not.toBe(raised.camera.x);
    expect(Math.abs(lines(walked).floor - lines(raised).floor)).toBeLessThanOrEqual(STILL_PX);
    expect(Math.abs(lines(walked).top - lines(raised).top)).toBeLessThanOrEqual(STILL_PX);
  });
}
