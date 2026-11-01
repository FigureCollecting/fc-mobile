import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { SHOT_VIEWPORTS, type ShotViewport } from './caseViewports';
import { atRest } from './sheetRest';
import { signoffShot } from './signoffShots';
import { touchDown, touchSwipe, touchTap } from './touch';

/**
 * PHOTOS-FIND-1 (Ross 10-31: "only one picture per figure"): the card's picture says how many photos its figure has when it
 * has more than the one shown, low and clear of the face, and a tap on that opens them all. On the Fold8's panels (the
 * SHOT_VIEWPORTS phone projects): the viewer's pull-up sheet on the cover, the pane beside the case when open. The fixtures
 * (?fxphotos=1&fxphotocount=5) give every figure five photos on the public image address, answered here with a synthetic
 * picture. Sign-off PNGs land in test-results/signoff/<project>/photos-*.png.
 *
 * Items 6-8 (Ross 10-31: "inspect the tapped image behind by using the slider"): a photo tapped in the sheet is the large picture
 * behind it; the sheet slides down to a strip of its photos and back up; a swipe on the picture steps to the next photo.
 */

// the app's service worker would fetch the photos itself, round the route below (and the hands-off rules refuse it)
test.use({ serviceWorkers: 'block' });

/** Below this width Info is the viewer's pull-up sheet; at or above it, the pane beside the case (Collection.tsx). */
const DUAL_PANE_MIN_WIDTH = 640;
const PICTURE = readFileSync(new URL('../src/dev-fixtures/synthetic/clean/dark-angel.png', import.meta.url));

function shotViewport(project: string): ShotViewport {
  const found = SHOT_VIEWPORTS.find((v) => v.name === project);
  if (found === undefined) throw new Error(`${project} is not a SHOT_VIEWPORTS project`);
  return found;
}

const box = async (l: Locator) => (await l.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tap = async (page: Page, l: Locator) => {
  const b = await box(l);
  await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
};

async function openCase(page: Page) {
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
  await page.goto('/?layout=case&fxphotos=1&fxphotocount=5');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** Touch-tap a figure the frame shows whole. */
async function openFigure(page: Page) {
  const frame = await box(page.locator('.cabinet-scene'));
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

test('the picture says 5 photos, low and clear of the face, and a tap opens all five', async ({ page }, testInfo) => {
  const v = shotViewport(testInfo.project.name);
  test.skip(!v.mobile, 'the phone panels');
  await openCase(page);
  await openFigure(page);
  const narrow = v.width < DUAL_PANE_MIN_WIDTH;
  if (narrow) {
    const viewer = page.locator('.figure-viewer-sheet');
    await expect(viewer).toBeVisible();
    await atRest(viewer);
  }
  const picture = narrow ? page.locator('.pswp__item[aria-hidden="false"] img.pswp__img') : page.locator('.detail-pane__image');
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await atRest(picture);

  const chip = page.getByRole('button', { name: '5 photos', exact: true });
  await expect(chip).toBeVisible();
  const pill = await box(chip.locator('.photos-chip__pill'));
  const pic = await box(picture);
  // the face is high on the picture (a third down, FACE_ANCHOR): the chip keeps to its lower half, and to the left
  expect(pill.y, 'below the middle of the picture').toBeGreaterThanOrEqual(pic.y + pic.height / 2);
  expect(pill.x + pill.width / 2, 'on its left half').toBeLessThanOrEqual(pic.x + pic.width / 2);
  expect(pill.x, 'on the screen').toBeGreaterThanOrEqual(0);
  expect(pill.y + pill.height).toBeLessThanOrEqual(v.height);
  expect((await box(chip)).height, 'a target a finger takes').toBeGreaterThanOrEqual(44);
  // clear of the section rail (the viewer) and of the zoom control (the pane)
  const neighbour = narrow ? page.getByRole('navigation', { name: 'Figure sections' }) : page.locator('.detail-pane .zoomable__button');
  expect(overlap(await box(chip), await box(neighbour)), 'clear of its neighbour').toBe(false);
  await signoffShot(page, testInfo, 'photos-chip');

  await tap(page, chip);
  const sheet = page.getByRole('dialog', { name: 'Photos' });
  await expect(sheet).toBeVisible();
  await atRest(sheet);
  await expect(sheet.getByRole('button', { name: /^Photo \d/ })).toHaveCount(5);
  await expect(sheet.locator('.photos-sheet__count')).toHaveText('5 photos');
  await signoffShot(page, testInfo, 'photos-chip-sheet');
});

const photoUrl = (c: string) => `https://images.figurecollecting.com/d/${c.repeat(64)}`;

test('a photo tapped is the large picture; the sheet slides to its strip and back; a swipe on the picture steps to the next', async ({ page }, testInfo) => {
  const v = shotViewport(testInfo.project.name);
  test.skip(!v.mobile, 'the phone panels');
  await openCase(page);
  await openFigure(page);
  const narrow = v.width < DUAL_PANE_MIN_WIDTH;
  if (narrow) await atRest(page.locator('.figure-viewer-sheet'));
  const picture = narrow ? page.locator('.pswp__item[aria-hidden="false"] img.pswp__img') : page.locator('.detail-pane__image');
  await tap(page, page.getByRole('button', { name: '5 photos', exact: true }));
  const sheet = page.getByRole('dialog', { name: 'Photos' });
  await expect(sheet).toBeVisible();
  await atRest(sheet);
  const tiles = sheet.getByRole('button', { name: /^Photo \d/ });

  // the third of five, tapped: the large picture behind is that photo
  await tap(page, tiles.nth(2));
  await expect(tiles.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(picture).toHaveAttribute('src', photoUrl('c'));
  await signoffShot(page, testInfo, 'photos-browse-picked');

  // a drag down on its handle: the sheet rests on its strip, the picture in view above it, and it is still open
  const handle = sheet.getByRole('button', { name: 'Show the large picture' });
  const h = await box(handle);
  const finger = await touchDown(page, h.x + h.width / 2, h.y + h.height / 2);
  await finger.to(h.x + h.width / 2, h.y + h.height / 2 + 400, 12, 16);
  await finger.end();
  await atRest(sheet);
  await expect(sheet).toHaveAttribute('data-detent', 'peek');
  const strip = await box(sheet);
  const pic = await box(picture);
  expect(strip.y, 'the strip stands below the middle of the picture').toBeGreaterThan(pic.y + pic.height / 2);
  // the rest of the sheet (its notes and Use for me) is below the screen; the strip of photos is on it, one row
  const shown = await Promise.all((await tiles.all()).map(box));
  for (const t of shown) expect(t.y + t.height, 'every photo on the strip on the screen').toBeLessThanOrEqual(v.height + 0.5);
  expect(new Set(shown.map((t) => Math.round(t.y))).size, 'one row').toBe(1);

  // a swipe to the left on the picture: the next photo, the fourth, there and pressed on the strip
  await touchSwipe(page, pic.x + pic.width / 2, pic.y + pic.height / 3, -160, 0);
  await expect(picture).toHaveAttribute('src', photoUrl('0'));
  await expect(tiles.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet).toHaveAttribute('data-detent', 'peek');
  await signoffShot(page, testInfo, 'photos-browse-peek');

  // a drag up on its handle: all of it again; the X closes it and the figure's own picture is back
  const raise = sheet.getByRole('button', { name: 'Show all photos' });
  const r = await box(raise);
  const up = await touchDown(page, r.x + r.width / 2, r.y + r.height / 2);
  await up.to(r.x + r.width / 2, r.y + r.height / 2 - 400, 12, 16);
  await up.end();
  await atRest(sheet);
  await expect(sheet).toHaveAttribute('data-detent', 'all');
  await tap(page, sheet.getByRole('button', { name: 'Close photos' }));
  await expect(sheet).toHaveCount(0);
  await expect(picture).not.toHaveAttribute('src', photoUrl('0'));
});
