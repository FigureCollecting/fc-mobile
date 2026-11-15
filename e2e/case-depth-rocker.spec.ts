import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchFingers } from './touch';
import { DEPTH_FULL_PX } from '../src/components/display/caseDepth';
import { JOG_FULL_PX, JOG_MAX_STEP_MS } from '../src/components/display/casePose';

/**
 * NAV-DEPTH-3 (Ross 11-13; NAV-ROCKER 11-14), in Chromium at the Fold8's open and cover panels, fixture mode, through
 * Chromium's own touch pipeline (CDP touches): the depth rocker in the slot left of the hat moves the eye toward the wall
 * (data-camera z falls) and away (z rises), never sideways (x kept); the lift stops it; held with the hat, both move; the
 * View card's setting makes it a horizontal slider in the slot (toward the hat = closer), kept on the device.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const PANELS = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-open' || v.name === 'fold8-cover');

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

/** The case in Free camera (the default) at `size`; the prefs are seeded once a tab, so a reload keeps what the page saved. */
async function openFree(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === '1') return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0 }));
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=40');
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
const rocker = (page: Page) => page.locator('.depth-rocker');
const centreOf = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

for (const panel of PANELS) {
  test(`NAV-DEPTH-3 ${panel.name}: the vertical rocker left of the hat: up moves closer, down backs away, x kept; the lift stops it`, async ({ page }) => {
    await openFree(page, panel);
    await expect(rocker(page)).toHaveAttribute('data-shape', 'vertical');
    // left of the hat, clear of it, a thumb's target (>= 44 px) and rising above the slot
    const r = (await rocker(page).boundingBox())!;
    const hat = (await page.locator('.tab-bar__add[data-jog]').boundingBox())!;
    const slot = (await page.locator('.case-tabs [data-tab="reserved"]').boundingBox())!;
    expect(r.x + r.width).toBeLessThan(hat.x);
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44);
    expect(r.y).toBeLessThan(slot.y);
    expect(r.height).toBeGreaterThan(r.width);

    const at = await centreOf(page, '.depth-rocker');
    const c0 = await cameraOf(page);
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 600);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    await expect(rocker(page)).toHaveAttribute('data-rocking', '');
    const c1 = await cameraOf(page);
    expect(c1.z, 'up: closer').toBeLessThan(c0.z - 20);
    expect([c1.x, c1.y, c1.yaw, c1.pitch], 'only the depth moved').toEqual([c0.x, c0.y, c0.yaw, c0.pitch]);

    await f.to(1, at.x, at.y + DEPTH_FULL_PX, 6);
    await hold(page, 600);
    const c2 = await cameraOf(page);
    expect(c2.z, 'down: back').toBeGreaterThan(c1.z + 20);
    expect(c2.x).toBe(c0.x);

    await f.up(1);
    await settle(page);
    const c3 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page), 'stopped at the lift').toEqual(c3);
    expect(await page.locator('.cabinet-scene').getAttribute('data-gesture')).toBeNull();
    expect(await rocker(page).getAttribute('data-rocking')).toBeNull();
  });

  test(`NAV-DEPTH-3 ${panel.name}: the rocker and the hat held together: x and z both move; each lift stops its own`, async ({ page }) => {
    await openFree(page, panel);
    const hatAt = await centreOf(page, '.tab-bar__add[data-jog]');
    const at = await centreOf(page, '.depth-rocker');
    const c0 = await cameraOf(page);
    const f = await touchFingers(page);
    await f.down(1, hatAt.x, hatAt.y);
    await f.to(1, hatAt.x + JOG_FULL_PX, hatAt.y, 6);
    await f.down(2, at.x, at.y);
    await f.to(2, at.x, at.y - DEPTH_FULL_PX, 6);
    await hold(page, 800);
    const c1 = await cameraOf(page);
    expect(c1.x, 'the hat: right').toBeGreaterThan(c0.x + 20);
    expect(c1.z, 'the rocker: closer').toBeLessThan(c0.z - 20);
    // the hat's lift: the depth goes on alone
    await f.up(1);
    await settle(page, 100);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gesture', 'depth');
    const c2 = await cameraOf(page);
    await hold(page, 400);
    const c3 = await cameraOf(page);
    expect(c3.x, 'the hat stopped').toBe(c2.x);
    expect(c3.z, 'the depth runs on').toBeLessThan(c2.z);
    await f.up(2);
    await settle(page);
    const c4 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page)).toEqual(c4);
  });

  test(`NAV-ROCKER ${panel.name}: the View card's horizontal slider sits in the slot, toward the hat is closer, and a reload keeps it`, async ({ page }) => {
    await openFree(page, panel);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const group = page.getByRole('group', { name: 'Depth control' });
    await expect(group.getByRole('radio', { name: /vertical rocker/i })).toBeChecked();
    await group.getByRole('radio', { name: /horizontal slider/i }).click();
    await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
    await expect(group).toHaveCount(0);
    await expect(rocker(page)).toHaveAttribute('data-shape', 'horizontal');

    await page.reload();
    await ready(page);
    await expect(rocker(page)).toHaveAttribute('data-shape', 'horizontal');
    const r = (await rocker(page).boundingBox())!;
    const slot = (await page.locator('.case-tabs [data-tab="reserved"]').boundingBox())!;
    const hat = (await page.locator('.tab-bar__add[data-jog]').boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(slot.x - 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
    expect(r.x + r.width).toBeLessThan(hat.x);
    expect(r.height).toBeGreaterThanOrEqual(44);

    const at = await centreOf(page, '.depth-rocker');
    const c0 = await cameraOf(page);
    const f = await touchFingers(page);
    await f.down(1, at.x, at.y);
    await f.to(1, at.x + DEPTH_FULL_PX, at.y, 6);
    await hold(page, 600);
    const c1 = await cameraOf(page);
    expect(c1.z, 'toward the hat: closer').toBeLessThan(c0.z - 20);
    expect(c1.x).toBe(c0.x);
    await f.to(1, at.x - DEPTH_FULL_PX, at.y, 6);
    await hold(page, 600);
    const c2 = await cameraOf(page);
    expect(c2.z, 'away from the hat: back').toBeGreaterThan(c1.z + 20);
    expect(c2.x).toBe(c0.x);
    await f.up(1);
    await settle(page);
    const c3 = await cameraOf(page);
    await settle(page, 500);
    expect(await cameraOf(page)).toEqual(c3);
  });
}
