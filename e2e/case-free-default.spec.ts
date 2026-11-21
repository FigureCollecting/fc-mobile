import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown } from './touch';
import { hat } from './navControls';
import { JOG_FULL_PX } from '../src/components/display/casePose';

/**
 * NAV-2A (NAVDEF a, Ross 10-31): Free camera is the case's default on every device, and the header's swipe button (the
 * camera icon) goes with it: one finger moves, a hold looks, the jog is always on and a tap on it is the menu. A swipe
 * mode stored before changes nothing in Free camera. NAV-GRAD: it is the only camera; the View card has no box for it,
 * and a device that stored it off opens in it all the same. At the Fold8's four panels under a real finger (Chromium's
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
/** The floating hat (NAV-FLOAT): the jog the bottom-centre button was. */
const jogButton = hat;
const addSheet = (page: Page) => page.getByText(/import your mfc export/i);
/** Add figures: the header's, on the collection (ADDFAB b). */
const addButton = (page: Page) => page.getByRole('button', { name: 'Add figures', exact: true });
/** What the header's display controls are, left to right (class and the name's first part). */
const headerControls = (page: Page) =>
  page.locator('.display-toggle button').evaluateAll((els) => els.map((e) => `${e.className.split(' ')[0]}:${e.getAttribute('aria-label')!.split(',')[0]}`));

async function closeSheet(page: Page) {
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.bottom-sheet')).toHaveCount(0);
}

/** What the device has stored for the case. */
const storedPrefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fc-case-prefs') ?? '{}') as Record<string, unknown>);

/** A quick one-finger drag across the middle of the frame, from 70 % to 30 % of its width (no hold: Look never arms). */
async function quickDrag(page: Page) {
  const f = await frameBox(page);
  const finger = await touchDown(page, f.x + f.width * 0.7, f.y + f.height / 2);
  await finger.to(f.x + f.width * 0.3, f.y + f.height / 2, 8, 16);
  await finger.end();
  await settle(page);
}

for (const panel of FOLD8) {
  test(`a fresh device: Free camera, no swipe icon, the hat on and Add in the header; the View card has no Free camera box, and a reload keeps the view (NAV-GRAD): ${panel.name}`, async ({ page }) => {
    test.setTimeout(90_000);
    await openCase(page, panel);
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    expect(await headerControls(page)).toEqual(['display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    // the hat is on: a thumb's drag on it moves the eye; a quick tap on it is nothing, and Add is the header's button
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
    await settle(page, 300);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await addButton(page).tap();
    await expect(addSheet(page)).toBeVisible();
    await page.locator('.bottom-sheet__handle-area').click();
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    // the View card offers no pan and no Free camera box (NAV-GRAD: the Free camera is the only camera), and no depth
    // control choice either (NAV-FLOAT: the floating Z is vertical only)
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('group', { name: 'Arrange by' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /free camera/i })).toHaveCount(0);
    await expect(page.getByText(/free camera/i)).toHaveCount(0);
    await expect(page.getByText(/pan the wall/i)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Depth control' })).toHaveCount(0);
    await closeSheet(page);
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(jogButton(page)).toHaveCount(1);
    // the Free camera through a reload (NAV-SCOPE: the case has one view; its Case button opens no menu)
    await page.getByRole('button', { name: 'Case', exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(swipeButton(page)).toHaveCount(0);
    await page.reload();
    await waitForCase(page);
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    await expect(jogButton(page)).toHaveCount(1);
    expect('freeCamera' in (await storedPrefs(page)), 'the device stores no freeCamera').toBe(false);
  });

  test(`a device that stored Pan the wall: no icon, and a quick drag moves the eye, never turns it: ${panel.name}`, async ({ page }) => {
    await openCase(page, panel, { swipe: 'pan', view: 'wall' });
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(swipeButton(page)).toHaveCount(0);
    const start = await cameraOf(page);
    await quickDrag(page);
    const moved = await cameraOf(page);
    expect(moved.x, 'the drag walked the eye').toBeGreaterThan(start.x);
    expect([moved.yaw ?? 0, moved.pitch], 'and never turned it').toEqual([0, 0]);
  });

  // NAV-GRAD: the device that turned Free camera off before (Ross's own Fold8 may have) opens in the Free camera all the
  // same, every gesture of it working; what it stored is read past, and dropped the next time the case stores anything
  test(`NAV-GRAD: a device that stored Free camera off (and Pan the wall): the Free camera, its hold-Look and its jog; the next write drops the field: ${panel.name}`, async ({ page }) => {
    await openCase(page, panel, { freeCamera: false, swipe: 'pan', view: 'wall' });
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-free-camera', '1');
    await expect(scene).not.toHaveAttribute('data-swipe', /./);
    await expect(scene).not.toHaveAttribute('data-pan', /./);
    await expect(swipeButton(page)).toHaveCount(0);
    await expect(jogButton(page)).toHaveCount(1);
    expect(await headerControls(page)).toEqual(['display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    // one finger moves the eye
    const start = await cameraOf(page);
    await quickDrag(page);
    const moved = await cameraOf(page);
    expect(moved.x, 'the drag walked the eye').toBeGreaterThan(start.x);
    expect([moved.yaw ?? 0, moved.pitch], 'and never turned it').toEqual([0, 0]);
    // a finger held still, then dragged, turns it where it stands
    const f = await frameBox(page);
    const finger = await touchDown(page, f.x + f.width / 2, f.y + f.height / 2);
    await page.waitForTimeout(300);
    // waited for, not timed: the hold's timer fires late on a loaded host
    await expect(scene, 'Look armed').toHaveAttribute('data-gesture', 'look', { timeout: 10_000 });
    await finger.to(f.x + f.width / 2 - 80, f.y + f.height / 2, 8, 16);
    await finger.end();
    await settle(page);
    const turned = await cameraOf(page);
    expect(turned.yaw ?? 0, 'the held drag turned the eye').not.toBe(0);
    expect(turned.x, 'where it stood').toBe(moved.x);
    // nothing written yet: the stored field is still there, only read past
    expect((await storedPrefs(page)).freeCamera).toBe(false);
    // the next write (an arrangement, NAV-SCOPE: the case has no view to change) drops it, and the stored view with it;
    // the reload is the Free camera still
    await page.getByRole('button', { name: 'View' }).click();
    const arrange = page.getByRole('group', { name: 'Arrange by' });
    await arrange.getByRole('radio', { name: 'Name', exact: true }).click();
    await expect(arrange.getByRole('radio', { name: 'Name', exact: true })).toBeChecked();
    await closeSheet(page);
    await expect(scene).toHaveAttribute('data-arrange', 'name');
    const stored = await storedPrefs(page);
    expect(stored.arrange).toBe('name');
    expect('freeCamera' in stored, 'freeCamera dropped on the write').toBe(false);
    expect('view' in stored, 'the stored view dropped on the write').toBe(false);
    await page.reload();
    await waitForCase(page);
    await expect(scene).toHaveAttribute('data-free-camera', '1');
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

  test('a fresh device: no swipe icon; a left drag moves, a right drag looks, a drag on the hat moves and a click on it opens nothing (Add is the header\'s)', async ({ page }) => {
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
    expect((await cameraOf(page)).x, 'the drag on the hat moved the eye').toBeGreaterThan(turned.x);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await jogButton(page).click();
    await settle(page, 300);
    await expect(page.locator('.bottom-sheet')).toHaveCount(0);
    await addButton(page).click();
    await expect(addSheet(page)).toBeVisible();
  });
});
