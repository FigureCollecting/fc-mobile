import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown } from './touch';
import { JOG_FULL_PX } from '../src/components/display/casePose';

/**
 * NAV-2A (NAVDEF a, Ross 10-31): Free camera is the case's default on every device, and the header's swipe button (the
 * camera icon) goes with it: one finger moves, a hold looks, the jog is always on and a tap on it is the menu. A swipe
 * mode stored before changes nothing in Free camera. The View card's box turns Free camera off on this device: the old
 * path, its swipe button with it, comes back and is kept. At the Fold8's four panels under a real finger (Chromium's
 * touch pipeline), and on a desktop with a mouse and a keyboard.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

/** The case on this device: nothing stored (a fresh device) unless `prefs` are, once (a reload keeps what the page stored). */
async function openCase(page: Page, size: { width: number; height: number }, prefs: Record<string, unknown> | null = null, query = 'fx=40') {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    if (p !== null && sessionStorage.getItem('nav2a-seeded') === null) {
      localStorage.setItem('fc-case-prefs', JSON.stringify(p));
      sessionStorage.setItem('nav2a-seeded', '1');
    }
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case&${query}`);
  await waitForCase(page);
}

async function waitForCase(page: Page) {
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 400);
}

type Published = { x: number; y: number; z: number; yaw?: number; pitch: number };
const cameraOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Published;
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;
const swipeButton = (page: Page) => page.getByRole('button', { name: /^Swipe/ });
const jogButton = (page: Page) => page.locator('.tab-bar__add[data-jog]');
const addSheet = (page: Page) => page.getByText(/import your mfc export/i);
/** What the header's display controls are, left to right (class and the name's first part). */
const headerControls = (page: Page) =>
  page.locator('.display-toggle button').evaluateAll((els) => els.map((e) => `${e.className.split(' ')[0]}:${e.getAttribute('aria-label')!.split(',')[0]}`));

async function closeSheet(page: Page) {
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
}

/** The View card's "Free camera" box. */
async function freeCameraBox(page: Page) {
  await page.getByRole('button', { name: 'View' }).click();
  return page.getByRole('checkbox', { name: 'Free camera', exact: true });
}

/** A quick one-finger drag across the middle of the frame, from 70 % to 30 % of its width (no hold: Look never arms). */
async function quickDrag(page: Page) {
  const f = await frameBox(page);
  const finger = await touchDown(page, f.x + f.width * 0.7, f.y + f.height / 2);
  await finger.to(f.x + f.width * 0.3, f.y + f.height / 2, 8, 16);
  await finger.end();
  await settle(page);
}

for (const panel of FOLD8) {
  test(`a fresh device: Free camera, no swipe icon, the jog on and its tap the menu; unticked, the old path's icon comes back and is kept: ${panel.name}`, async ({ page }) => {
    test.setTimeout(90_000);
    await openCase(page, panel);
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    expect(await headerControls(page)).toEqual(['display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    // the jog is on: a thumb's drag on the bottom-centre button moves the eye; a quick tap is the menu
    await expect(jogButton(page)).toHaveCount(1);
    const start = await cameraOf(page);
    const b = (await jogButton(page).boundingBox())!;
    const thumb = await touchDown(page, b.x + b.width / 2, b.y + b.height / 2);
    await thumb.to(b.x + b.width / 2 + JOG_FULL_PX, b.y + b.height / 2, 6, 16);
    await page.waitForTimeout(400);
    await thumb.end();
    await settle(page, 400);
    expect((await cameraOf(page)).x, 'the jog moved the eye').toBeGreaterThan(start.x);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await jogButton(page).tap();
    await expect(addSheet(page)).toBeVisible();
    await page.locator('.bottom-sheet__handle-area').click();
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    // the View card offers no pan, and its box is ticked; unticked, the case is the old path's, with its swipe icon
    const box = await freeCameraBox(page);
    await expect(box).toBeChecked();
    await expect(page.getByText(/pan the wall/i)).toHaveCount(0);
    await box.click();
    await expect(box).not.toBeChecked();
    await closeSheet(page);
    await expect(scene).not.toHaveAttribute('data-free-camera', /./);
    await expect(swipeButton(page)).toHaveAttribute('aria-label', 'Swipe, Move the camera');
    await expect(jogButton(page)).toHaveCount(0);
    // kept through a view change and a reload
    await page.getByRole('button', { name: /^Case,/ }).click();
    await page.getByRole('menuitemradio', { name: 'One cabinet' }).click();
    await expect(scene).toHaveAttribute('data-view', 'cabinet');
    await expect(swipeButton(page)).toHaveCount(1);
    await page.reload();
    await waitForCase(page);
    await expect(scene).toHaveAttribute('data-view', 'cabinet');
    await expect(scene).not.toHaveAttribute('data-free-camera', /./);
    await expect(swipeButton(page)).toHaveAttribute('aria-label', 'Swipe, Move the camera');
    await expect(await freeCameraBox(page)).not.toBeChecked();
  });

  test(`a device that stored Pan the wall: in Free camera no icon, and a quick drag moves the eye, never turns it: ${panel.name}`, async ({ page }) => {
    await openCase(page, panel, { freeCamera: true, swipe: 'pan', view: 'wall' });
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    const start = await cameraOf(page);
    await quickDrag(page);
    const moved = await cameraOf(page);
    expect(moved.x, 'the drag walked the eye').toBeGreaterThan(start.x);
    expect([moved.yaw ?? 0, moved.pitch], 'and never turned it').toEqual([0, 0]);
    // the stored mode is left as it was, for the old path
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!)).toMatchObject({ swipe: 'pan' });
  });
}

test.describe('desktop, no touch', () => {
  test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  const DESKTOP = { width: 1536, height: 730 };

  /** A mouse drag by `dx` across the frame centre. */
  async function mouseDrag(page: Page, dx: number, button: 'left' | 'right' = 'left') {
    const f = await frameBox(page);
    const x = f.x + f.width / 2;
    const y = f.y + f.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
    await page.mouse.up({ button });
    await settle(page);
  }

  test('a fresh device: no swipe icon; a left drag moves, a right drag looks, a drag on the jog moves and a click on it is the menu', async ({ page }) => {
    // Look arms after a 1 s hold here, so the left drag's first move is never late enough to arm it on a loaded host
    await openCase(page, DESKTOP, null, 'fx=40&lookhold=1000');
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    const start = await cameraOf(page);
    await mouseDrag(page, -200);
    const walked = await cameraOf(page);
    expect(walked.x, 'a left drag walks').toBeGreaterThan(start.x);
    expect(walked.yaw ?? 0).toBe(0);
    await mouseDrag(page, -120, 'right');
    const turned = await cameraOf(page);
    expect(turned.yaw!, 'a right drag turns').toBeGreaterThan(0);
    expect(turned.x).toBe(walked.x);
    const b = (await jogButton(page).boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + (JOG_FULL_PX * i) / 6, at.y);
    await page.waitForTimeout(500);
    await page.mouse.up();
    await settle(page, 400);
    expect((await cameraOf(page)).x, 'the drag on the jog moved the eye').toBeGreaterThan(turned.x);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await jogButton(page).click();
    await expect(addSheet(page)).toBeVisible();
  });

  test('the keyboard still steps the cabinets: Next is unseen until Tab reaches it, then shown, and Enter stands the eye at the next cabinet', async ({ page }) => {
    await openCase(page, DESKTOP, { view: 'cabinet' });
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(scene).toHaveAttribute('data-focus', '0');
    const next = page.locator('.cabinet-scene__step--next');
    await expect(next).toHaveCSS('opacity', '0');
    let reached = false;
    for (let i = 0; i < 150 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Next cabinet');
    }
    expect(reached, 'Tab reaches Next cabinet').toBe(true);
    await expect(next).toHaveCSS('opacity', '1');
    const before = await cameraOf(page);
    await page.keyboard.press('Enter');
    await expect(scene).toHaveAttribute('data-focus', '1');
    const after = await cameraOf(page);
    expect(after.x, 'the eye stands at the next cabinet').toBeGreaterThan(before.x);
    expect([after.yaw ?? 0, after.pitch]).toEqual([0, 0]);
  });
});
