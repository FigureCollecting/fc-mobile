import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';

/**
 * CASE-GL in a real Chromium: the View card's Renderer: Canvas draws the case
 * on one WebGL canvas (kept per device, Classic by default); a swipe walks
 * the same camera and the canvas redraws; a tap on a figure opens it; the
 * atlas stays within its 48 MB budget at a device pixel ratio capped at 2;
 * no WebGL2 falls back to the classic view; a lost context shows a still
 * and, restored, draws again. Fixture mode on the committed synthetic art.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const OPEN = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open')!;
const BUDGET = 48 * 1024 * 1024;

async function openCase(page: Page, size: { width: number; height: number }, prefs: Record<string, unknown>, query = 'fx=170') {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    if (Object.keys(p).length > 0 && !localStorage.getItem('fc-case-prefs')) localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case&${query}`);
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  await page.waitForSelector('.cabinet-scene');
}

const gl = (page: Page) => page.locator('canvas.case-gl');
const data = async (page: Page, key: string) => (await gl(page).getAttribute(`data-gl-${key}`)) ?? '';

/** The canvas drew a settled frame with its atlas in. */
async function drawn(page: Page) {
  await expect(gl(page)).toHaveAttribute('data-gl-ready', '1');
  await expect.poll(async () => Number(await data(page, 'pages')), { timeout: 15_000 }).toBeGreaterThan(0);
}

test('Classic by default; the View card switches the case to Canvas, kept on this device', async ({ page }) => {
  await openCase(page, COVER, {});
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-renderer', 'classic');
  await expect(gl(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('radio', { name: 'Canvas' }).click();
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-renderer', 'canvas');
  await drawn(page);
  await expect(page.locator('button.cab-figure')).toHaveCount(0);
  await expect(page.locator('.cabinet-scene__root')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-renderer', 'canvas');
  await drawn(page);
});

test('a swipe walks the camera, and the canvas redraws every move', async ({ page }) => {
  await openCase(page, COVER, { renderer: 'canvas', swipe: 'camera', view: 'wall' });
  await drawn(page);
  const scene = page.locator('.cabinet-scene');
  const x0 = Number(await scene.getAttribute('data-camera-x'));
  const frames0 = Number(await data(page, 'frames'));
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * 0.8 - 40 * i, box.y + box.height / 2);
  await page.mouse.up();
  await expect.poll(async () => Number(await scene.getAttribute('data-camera-x'))).toBeGreaterThan(x0);
  expect(Number(await data(page, 'frames'))).toBeGreaterThan(frames0 + 2);
});

for (const size of [COVER, OPEN]) {
  test(`a tap on a drawn figure opens it: ${size.name}`, async ({ page }) => {
    await openCase(page, size, { renderer: 'canvas', view: 'cabinet' });
    await drawn(page);
    await expect.poll(async () => JSON.parse((await data(page, 'taps')) || '[]').length).toBeGreaterThan(0);
    const [first] = JSON.parse(await data(page, 'taps')) as { figure: number; x: number; y: number }[];
    const box = (await gl(page).boundingBox())!;
    await page.touchscreen.tap(box.x + first.x, box.y + first.y);
    const dual = size.width >= 640;
    await expect(page.locator(dual ? '.detail-pane' : '.pswp')).toBeVisible();
  });
}

test('the atlas stays within its 48 MB budget, logged, at a device pixel ratio capped at 2', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('[case-gl] texture budget')) logged.push(m.text());
  });
  await openCase(page, OPEN, { renderer: 'canvas', view: 'wall' }, 'fx=215&labels=1');
  await drawn(page);
  expect(Number(await data(page, 'budget-bytes'))).toBe(BUDGET);
  const bytes = Number(await data(page, 'texture-bytes'));
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(BUDGET);
  expect(Number(await data(page, 'dpr'))).toBe(2);
  // the drawing buffer is the frame at 2 device px per CSS px, never the screen's 2.8125
  const size = await gl(page).evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight }));
  expect(size.w).toBe(size.cw * 2);
  expect(size.h).toBe(size.ch * 2);
  expect(logged.length).toBeGreaterThan(0);
});

test('no WebGL2: Renderer: Canvas falls back to the classic view', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === 'webgl2' ? null : (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof get;
  });
  await openCase(page, COVER, { renderer: 'canvas' });
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-renderer', 'classic');
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gl-fallback', 'no-webgl2');
  await expect(gl(page)).toHaveCount(0);
});

test('a lost context shows the last settled picture as a still; restored, the atlas is rebuilt and the canvas draws again', async ({ page }) => {
  await openCase(page, COVER, { renderer: 'canvas' });
  await drawn(page);
  const bytes = await data(page, 'texture-bytes');
  await gl(page).evaluate((c: HTMLCanvasElement) => {
    const ext = c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
  });
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gl-lost', '1');
  await expect(page.locator('canvas.case-gl__still')).toBeVisible();
  await expect(gl(page)).toBeHidden();
  const frames = Number(await data(page, 'frames'));
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-gl-lost', '0');
  await expect(gl(page)).toBeVisible();
  await expect(page.locator('canvas.case-gl__still')).toBeHidden();
  await expect.poll(async () => Number(await data(page, 'frames'))).toBeGreaterThan(frames);
  expect(await data(page, 'texture-bytes')).toBe(bytes);
});
