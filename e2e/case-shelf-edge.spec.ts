import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FOLD8_DPR } from './caseViewports';
import { decodePng } from './paintCheck';
import { touchDown } from './touch';
import { project, type Camera } from '../src/components/display/caseCamera';
import { IKEA_DETOLF, IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';

/**
 * CASE-FB3a item 2 (Ross 10-17: "the 2nd to lowest shelf vanished at exactly horizontal but reappears otherwise"). The
 * shelf view (level, pitch 0), the camera lifted to within 3 microns of a glass shelf's top and 40 mm either side of it:
 * the shelf's front edge reads as a line at every height, the way the Detolf's does. On 8c565638 the KLINGSBO's glass
 * shelves drew their 17 mm front edge in dark steel, 4 to 11 against the room behind it at the shelf's own height, 45
 * and more 40 mm off it (their lit rim and fill are edge-on there, so the shelf was gone); the Detolf's glass edge read
 * 140 and more at every height.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

/** The least a glass shelf's front edge reads at its own height, as a spread of luminance down it (0 to 255). */
const LEVEL_MIN = 60;
/** At the shelf's height it reads at least this share of what it reads 40 mm off it. */
const LEVEL_SHARE = 0.5;
const OFFSET_MM = 40;

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);
type Cam = { x: number; y: number; z: number; pitch: number; focalPx: number; width: number; height: number };
const cam = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Cam;

/** Lift the camera (a vertical drag whose net travel is the lift's) to within a few microns of `target`, mm. */
async function liftTo(page: Page, target: number): Promise<number> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  for (let i = 0; i < 8; i++) {
    const c = await cam(page);
    if (Math.abs(target - c.y) < 0.003) return c.y;
    // pitch 0 in the shelf view: the depth to the front plane is the camera's z
    const dy = ((target - c.y) * c.focalPx) / c.z;
    const finger = await touchDown(page, f.x + f.width / 2, f.y + f.height * 0.4);
    await finger.to(f.x + f.width / 2, f.y + f.height * 0.4 + 30, 3, 16);
    await finger.to(f.x + f.width / 2, f.y + f.height * 0.4 + dy, 3, 16);
    await finger.end();
    await settle(page);
  }
  return (await cam(page)).y;
}

/** The most any column of a strip across the edge changes in luminance: how well a line reads there. */
async function contrast(page: Page, x: number, y0: number, y1: number): Promise<number> {
  const clip = { x: Math.max(0, x - 12), y: Math.max(0, y0 - 6), width: 24, height: Math.max(6, y1 - y0 + 12) };
  const shot = decodePng(await page.screenshot({ clip }));
  let best = 0;
  for (let c = 0; c < shot.width; c++) {
    let lo = 255;
    let hi = 0;
    for (let r = 0; r < shot.height; r++) {
      const i = (r * shot.width + c) * 4;
      const l = (shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]!) / 3;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    best = Math.max(best, hi - lo);
  }
  return Math.round(best);
}

for (const profile of [IKEA_KLINGSBO, IKEA_DETOLF]) {
  test(`${profile.id}: each glass shelf's front edge reads as a line at its own height as well as 40 mm off it`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript((pattern) => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'shelf', swipe: 'camera', pattern }));
    }, profile.id);
    await page.setViewportSize({ width: 657, height: 870 });
    await page.goto('/?layout=case&fx=1&fxonly=spike');
    await page.waitForSelector('.cab', { state: 'attached' });
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
    await settle(page, 800);
    const frame = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const wall = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!) as number[][];
    const focus = Number(await page.locator('.cabinet-scene').getAttribute('data-focus'));
    const cx = (wall[focus]![0]! + wall[focus]![1]!) / 2;
    const readings: Record<string, Record<string, number>> = {};
    const shelves = profile.surfaces.filter((s) => s.plate === true);
    expect(shelves.length, 'the profile has glass shelves').toBeGreaterThan(0);
    for (const s of shelves) {
      const row: Record<string, number> = {};
      for (const d of [-OFFSET_MM, 0, OFFSET_MM]) {
        const y = await liftTo(page, s.topMm + d);
        expect(Math.abs(y - (s.topMm + d)), `${s.name}: the camera lifted to ${d} mm`).toBeLessThan(0.01);
        const c = await cam(page);
        const camera: Camera = { ...c, frame: { width: c.width, height: c.height } };
        const top = project(camera, [cx, s.topMm, 0]);
        const bottom = project(camera, [cx, s.topMm - s.thicknessMm, 0]);
        row[`${d}`] = await contrast(page, frame.x + top.x, frame.y + top.y, frame.y + bottom.y);
      }
      readings[s.name] = row;
    }
    console.log(`case-shelf-edge ${JSON.stringify({ profile: profile.id, contrastByCameraOffsetMm: readings })}`);
    for (const [name, row] of Object.entries(readings)) {
      const off = Math.max(row[`${-OFFSET_MM}`]!, row[`${OFFSET_MM}`]!);
      expect(row['0'], `${name}: its front edge at its own height`).toBeGreaterThanOrEqual(LEVEL_MIN);
      expect(row['0'], `${name}: at its own height against ${OFFSET_MM} mm off`).toBeGreaterThanOrEqual(off * LEVEL_SHARE);
    }
  });
}
