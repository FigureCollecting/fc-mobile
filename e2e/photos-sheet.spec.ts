import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest } from './sheetRest';
import { touchTap } from './touch';

/**
 * GALLERY-1 (Ross 10-18): the figure card's Photos tab at the four Fold8 panels, under a real finger: the rail's Photos opens a
 * sheet of the figure's photos, the one in use marked; a tap picks one and "Use for me" keeps the pick for this user, which a
 * reopened sheet shows in use. The fixtures (?fxphotos=1) give every figure three photos on the public image address, which the
 * page route here answers with a synthetic picture; the pick is kept in localStorage for the fixtures' own user.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
/** Below this width Info is the viewer's pull-up sheet; at or above it, the pane beside the case (Collection.tsx). */
const DUAL_PANE_MIN_WIDTH = 640;
const PICTURE = readFileSync(new URL('../src/dev-fixtures/synthetic/clean/dark-angel.png', import.meta.url));
const CHOICES_KEY = 'fc-photo-choices-v1:fixture-user';
const B = `https://images.figurecollecting.com/d/${'b'.repeat(64)}`;

async function openCase(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await pinLegacyCamera(page);
  // the photos are on the public image address; answered here, never from the network
  await page.route(/^https:\/\/images\.figurecollecting\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PICTURE,
      headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' },
    }),
  );
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fxphotos=1');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const b = (await locator.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const tap = async (page: Page, locator: Locator) => {
  const c = await centre(locator);
  await touchTap(page, c.x, c.y);
};

/** Touch-tap a figure the frame shows whole. */
async function openFigure(page: Page) {
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = page.locator('button.cab-figure');
  for (let i = 0; i < (await figures.count()); i++) {
    const b = await figures.nth(i).boundingBox();
    if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) {
      await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
      return;
    }
  }
  throw new Error('no figure stands whole in the frame');
}

const photosTab = (page: Page) => page.getByRole('navigation', { name: 'Figure sections' }).getByRole('button', { name: 'Photos' });

for (const size of FOLD8) {
  test(`the Photos tab opens the figure's photos, a pick is kept, and a reopened sheet shows it in use: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await openFigure(page);
    // the pull-up sheet (the narrow panels) rises with the rail on it: the finger goes to where the rail has come to rest
    if (size.width < DUAL_PANE_MIN_WIDTH) {
      const viewer = page.locator('.figure-viewer-sheet');
      await expect(viewer).toBeVisible();
      await atRest(viewer);
    }
    await expect(photosTab(page)).toBeVisible();
    await expect(photosTab(page)).toBeEnabled();
    // the rail with Photos in it still stands whole on the screen
    const rail = (await page.getByRole('navigation', { name: 'Figure sections' }).boundingBox())!;
    expect(rail.y, 'the rail starts on screen').toBeGreaterThanOrEqual(0);
    expect(rail.x + rail.width, 'and ends inside the width').toBeLessThanOrEqual(size.width + 0.5);

    await tap(page, photosTab(page));
    const sheet = page.getByRole('dialog', { name: 'Photos' });
    await expect(sheet).toBeVisible();
    await atRest(sheet);
    const box = (await sheet.boundingBox())!;
    expect(box.y, 'the sheet starts on screen').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'and ends inside the window').toBeLessThanOrEqual(size.height + 0.5);

    const tiles = sheet.getByRole('button', { name: /^Photo \d/ });
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveAttribute('aria-label', 'Photo 1 of 3, the default, in use');
    for (let i = 0; i < 3; i++) {
      const t = (await tiles.nth(i).boundingBox())!;
      expect(Math.min(t.width, t.height), `photo ${i + 1} is a target a finger takes`).toBeGreaterThanOrEqual(44);
    }
    const use = sheet.getByRole('button', { name: 'Use for me' });
    await expect(use).toBeDisabled();

    await tap(page, tiles.nth(1));
    await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(use).toBeEnabled();
    expect((await use.boundingBox())!.height, 'Use for me is a target a finger takes').toBeGreaterThanOrEqual(44);
    await expect(sheet.getByText('No cut-out yet: the case shows this photo as it is.')).toBeVisible();

    await tap(page, use);
    await expect(sheet).toHaveCount(0);
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>, CHOICES_KEY);
    expect(Object.values(kept)).toEqual([B]);

    // reopened: the pick is the one in use, and Use for me has nothing to do
    await tap(page, photosTab(page));
    await expect(sheet).toBeVisible();
    await expect(tiles.nth(1)).toHaveAttribute('aria-label', 'Photo 2 of 3, in use');
    await expect(sheet.getByRole('button', { name: 'Use for me' })).toBeDisabled();
    await tap(page, sheet.getByRole('button', { name: 'Close photos' }));
    await expect(sheet).toHaveCount(0);
  });
}
