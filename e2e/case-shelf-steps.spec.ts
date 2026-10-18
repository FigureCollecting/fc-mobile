import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { project, type Camera } from '../src/components/display/caseCamera';
import { IKEA_DETOLF } from '../src/components/display/cabinetPresets';
import { CEILING_DEFAULT_MM } from '../src/components/display/cabinetProfile';

/**
 * SHELF-STEPS-1 (Ross 10-18, Fold8): the one-shelf view's top step shows the top surface and the way up to the
 * ceiling on every panel, and an arrow press snaps to the straight-on view of that shelf where a drag had moved the
 * camera, which a drag then moves again (TOP1). Fixture mode, the Detolf wall, at the Fold8's four panels.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

async function openShelfView(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'shelf', swipe: 'camera', pattern: 'ikea-detolf' }));
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=2');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

async function camera(page: Page): Promise<Camera> {
  const c = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!);
  return { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
}

async function lift(page: Page, dy: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(60);
}

for (const size of FOLD8) {
  test(`the top step shows the top board and the way up to the ceiling: ${size.name}`, async ({ page }) => {
    await openShelfView(page, size);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-shelf', '0');
    const cam = await camera(page);
    const board = IKEA_DETOLF.surfaces[IKEA_DETOLF.surfaces.length - 1];
    const boardBottom = project(cam, [cam.x, board.topMm - board.thicknessMm, 0]).y;
    const ceiling = project(cam, [cam.x, CEILING_DEFAULT_MM, 0]).y;
    expect(boardBottom, 'the top board, to its underside, is in the frame').toBeLessThanOrEqual(cam.frame.height);
    expect(ceiling, 'the ceiling is in the frame').toBeGreaterThanOrEqual(0);
  });
}

test('an arrow press snaps a lifted camera back to the straight-on view of the shelf; a drag lifts it again', async ({ page }) => {
  await openShelfView(page, FOLD8.find((v) => v.name === 'fold8-open')!);
  const host = page.locator('.cabinet-scene');
  await page.getByRole('button', { name: 'Shelf below' }).click();
  await expect(host).toHaveAttribute('data-shelf', '1');
  const straight = await camera(page);
  await lift(page, -120);
  expect((await camera(page)).y, 'a drag lifts the camera').not.toBeCloseTo(straight.y, 0);
  await page.getByRole('button', { name: 'Shelf below' }).click();
  await page.getByRole('button', { name: 'Shelf above' }).click();
  await expect(host).toHaveAttribute('data-shelf', '1');
  expect(await camera(page), 'back at the straight-on view').toEqual(straight);
  await lift(page, -120);
  expect((await camera(page)).y, 'free movement moves it again').not.toBeCloseTo(straight.y, 0);
});
