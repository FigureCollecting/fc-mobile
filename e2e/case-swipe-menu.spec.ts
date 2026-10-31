import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { legacyPrefs } from './legacyCamera';
import { CASE_VIEWPORTS } from './caseViewports';
import { touchPinch, touchTap } from './touch';

/**
 * CAM1 (Ross 10-18, a): the swipe mode (pan the wall or move the camera, exclusive) is one icon with a small menu in the
 * header, at the top right just left of the two display-mode icons, and it works with the picture zoomed. At the Fold8's
 * four panels, under a real finger (Chromium's touch pipeline).
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

async function openCase(page: Page, size: { width: number; height: number }, swipe: 'camera' | 'pan') {
  await page.addInitScript((prefs) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(prefs));
  }, legacyPrefs({ view: 'wall', swipe }));
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=3');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

const swipeButton = (page: Page) => page.getByRole('button', { name: /^Swipe/ });

async function centre(page: Page, selector: ReturnType<typeof swipeButton>) {
  const b = (await selector.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The element a finger at (x, y) would land on is `el`, or inside it. */
async function takesTap(el: ReturnType<typeof swipeButton>, x: number, y: number) {
  return el.evaluate((node, at) => {
    const hit = document.elementFromPoint(at.x, at.y);
    return hit !== null && node.contains(hit);
  }, { x, y });
}

for (const size of FOLD8) {
  test(`the swipe icon is in the header, just left of the two display-mode icons; its menu opens on screen and sets the mode: ${size.name}`, async ({ page }) => {
    await openCase(page, size, 'camera');
    const swipe = swipeButton(page);
    const caseBtn = page.locator('.display-toggle__btn[data-mode="case"]');
    const tilesBtn = page.locator('.display-toggle__btn[data-mode="rows"]');
    const [s, c, t] = [(await swipe.boundingBox())!, (await caseBtn.boundingBox())!, (await tilesBtn.boundingBox())!];
    // left of the two mode icons, in their row, close to them, on screen
    expect(s.x + s.width, 'its right edge is at the Case icon\'s left').toBeLessThanOrEqual(c.x + 1);
    expect(c.x - (s.x + s.width), 'just left of the Case icon').toBeLessThan(12);
    expect(Math.abs(s.y + s.height / 2 - (c.y + c.height / 2)), 'in the same row').toBeLessThan(8);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(size.width);
    expect(s.width, 'big enough for a finger').toBeGreaterThanOrEqual(28);
    // the menu: on screen, two choices, the mode in force ticked
    const at = await centre(page, swipe);
    await touchTap(page, at.x, at.y);
    const menu = page.getByRole('menu', { name: 'Swipe modes' });
    await expect(menu).toBeVisible();
    const m = (await menu.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(size.width);
    expect(m.y + m.height).toBeLessThanOrEqual(size.height);
    const items = menu.getByRole('menuitemradio');
    await expect(items).toHaveText(['Pan the wall', 'Move the camera']);
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
    // picking Pan sets it: the scene, the button's name and the menu closing
    const pan = (await items.nth(0).boundingBox())!;
    await touchTap(page, pan.x + pan.width / 2, pan.y + pan.height / 2);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-swipe', 'pan');
    await expect(menu).toHaveCount(0);
    await expect(swipe).toHaveAttribute('aria-label', 'Swipe, Pan the wall');
  });

  test(`the swipe icon works while the picture is zoomed: ${size.name}`, async ({ page }) => {
    await openCase(page, size, 'pan');
    const scene = page.locator('.cabinet-scene');
    const frame = (await scene.boundingBox())!;
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    await touchPinch(page, { x: cx - 30, y: cy }, { x: cx + 30, y: cy }, { x: cx - 80, y: cy }, { x: cx + 80, y: cy });
    await expect.poll(async () => JSON.parse((await scene.getAttribute('data-zoom'))!).k).toBeGreaterThan(1.2);
    // zoomed, the icon is still the topmost thing at its centre: no zoom layer, chip or scene over it
    const swipe = swipeButton(page);
    const at = await centre(page, swipe);
    expect(await takesTap(swipe, at.x, at.y), 'a finger at the icon lands on it').toBe(true);
    await touchTap(page, at.x, at.y);
    const menu = page.getByRole('menu', { name: 'Swipe modes' });
    await expect(menu).toBeVisible();
    const camera = menu.getByRole('menuitemradio', { name: 'Move the camera' });
    const b = (await camera.boundingBox())!;
    await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
    await expect(scene).toHaveAttribute('data-swipe', 'camera');
    await expect(swipe).toHaveAttribute('aria-label', 'Swipe, Move the camera');
  });
}
