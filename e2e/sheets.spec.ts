import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest } from './sheetRest';
import { touchDown, touchSwipe, touchTap } from './touch';

/**
 * SHEETS-FB1 (Ross's Fold8 session, 10-14): the case's pull-up cards under a real finger (Chromium's touch
 * pipeline, which cancels the pointer once it scrolls a scroller), at the four Fold8 panels. A swipe on a card's
 * contents never leaves it creeping: it settles on a detent within 400 ms and stays there, and its handle drags
 * at once, mid-settle included.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
/** Below this width Info is the viewer's pull-up sheet; at or above it, the pane beside the case (Collection.tsx). */
const DUAL_PANE_MIN_WIDTH = 640;

async function openCase(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const b = (await locator.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function tapCentre(page: Page, locator: Locator) {
  const c = await centre(locator);
  await touchTap(page, c.x, c.y);
}

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

const top = async (sheet: Locator) => (await sheet.boundingBox())!.y;

interface Card {
  name: 'View' | 'Refine' | 'Info';
  sheet: string;
  handle: string;
  /** Where on the contents the finger lands. */
  contents: string;
  /** The way the handle can move from the card's opening detent (a resting card can always go down; View opens at its top). */
  handleDy: number;
}

const CARDS: Card[] = [
  { name: 'View', sheet: '.bottom-sheet', handle: '.bottom-sheet__handle-area', contents: '.bottom-sheet__content legend', handleDy: 40 },
  { name: 'Refine', sheet: '.detent-sheet', handle: '.detent-sheet__handle-area', contents: '.detent-sheet__content', handleDy: -40 },
  { name: 'Info', sheet: '.figure-viewer-sheet', handle: '.figure-viewer-sheet__handle', contents: '.figure-viewer-sheet__name', handleDy: -40 },
];

async function openCard(page: Page, card: Card): Promise<Locator> {
  if (card.name === 'Info') await openFigure(page);
  else await tapCentre(page, page.getByRole('button', { name: card.name, exact: true }));
  const sheet = page.locator(card.sheet);
  await expect(sheet).toBeVisible();
  await atRest(sheet);
  return sheet;
}

/** A finger on the card's contents, 40 px down at about 300 px/s. */
async function swipeContents(page: Page, card: Card) {
  const at = await centre(page.locator(card.contents).first());
  await touchSwipe(page, at.x, at.y, 0, 40, 8, 16);
}

for (const size of FOLD8) {
  for (const card of CARDS.filter((c) => c.name !== 'Info' || size.width < DUAL_PANE_MIN_WIDTH)) {
    test(`${card.name}: a swipe on its contents settles on its detent within 400 ms and stays; no creep: ${size.name}`, async ({ page }) => {
      await openCase(page, size);
      const sheet = await openCard(page, card);
      const rest = await top(sheet);
      await swipeContents(page, card);
      const released = Date.now();
      await page.waitForTimeout(400 - (Date.now() - released));
      const at400 = await top(sheet);
      await page.waitForTimeout(500);
      const at900 = await top(sheet);
      expect.soft(Math.abs(at400 - rest), `back on its detent 400 ms after the finger lifts (rest ${rest}, at 400 ms ${at400})`).toBeLessThanOrEqual(1);
      expect(Math.abs(at900 - at400), `still from 400 ms to 900 ms (${at400} -> ${at900})`).toBeLessThanOrEqual(0.5);
    });

    test(`${card.name}: right after a swipe on its contents, mid-settle, the handle drags it at finger speed: ${size.name}`, async ({ page }) => {
      await openCase(page, size);
      const sheet = await openCard(page, card);
      const rest = await top(sheet);
      await swipeContents(page, card);
      // no wait: the handle takes the card wherever the settle has it, then the card moves with the finger
      const grip = await centre(page.locator(card.handle));
      const way = Math.sign(card.handleDy);
      const finger = await touchDown(page, grip.x, grip.y);
      await finger.to(grip.x, grip.y + way * 10, 2, 16);
      // the card is drawn a frame after it moves: read it with the finger still
      await page.waitForTimeout(50);
      const taken = await top(sheet);
      await finger.to(grip.x, grip.y + card.handleDy, 4, 16);
      await page.waitForTimeout(50);
      const held = await top(sheet);
      await finger.end();
      const travel = card.handleDy - way * 10;
      expect.soft(Math.abs(held - taken - travel), `the card follows the finger ${travel} px (from ${taken} to ${held})`).toBeLessThanOrEqual(2);
      const released = Date.now();
      await page.waitForTimeout(400 - (Date.now() - released));
      const at400 = await top(sheet);
      await page.waitForTimeout(500);
      expect(Math.abs((await top(sheet)) - at400), 'at rest by 400 ms').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at400 - rest), `a 40 px handle drag settles back on the detent it left (rest ${rest}, now ${at400})`).toBeLessThanOrEqual(1);
    });
  }
}

for (const size of FOLD8.filter((v) => v.width >= DUAL_PANE_MIN_WIDTH)) {
  test(`Info pane: no sheet handle to mistake for one, and a swipe on its contents moves nothing: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await openFigure(page);
    const pane = page.locator('.detail-pane');
    await expect(pane).toBeVisible();
    await expect(pane.locator('.figure-viewer-sheet__handle')).toHaveCount(0);
    const before = (await pane.boundingBox())!;
    const at = await centre(pane.locator('.figure-viewer-sheet__name'));
    await touchSwipe(page, at.x, at.y, 0, 40);
    await page.waitForTimeout(400);
    expect((await pane.boundingBox())!).toEqual(before);
  });
}

test('the hand-off: a finger pulling down on scrolled contents scrolls them to their top, then moves the card with it (View, the sideways cover)', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-cover-sideways')!;
  await openCase(page, size);
  const sheet = await openCard(page, CARDS[0]);
  const body = page.locator('.bottom-sheet__content');
  const room = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(room, 'the View card scrolls its body on the sideways cover').toBeGreaterThan(40);
  await body.evaluate((el) => { el.scrollTop = 30; });
  const rest = await top(sheet);
  const b = (await body.boundingBox())!;
  const finger = await touchDown(page, b.x + b.width / 2, b.y + 10);
  await finger.to(b.x + b.width / 2, b.y + 10 + 90, 15, 16);
  const scrolled = await body.evaluate((el) => el.scrollTop);
  const moved = (await top(sheet)) - rest;
  await finger.end();
  expect.soft(scrolled, 'the contents first scrolled to their top').toBe(0);
  // 90 px of finger: about 30 to scroll the contents home, the rest moves the card (the browser's touch slop takes a few)
  expect(moved, `the card moved with the finger once the contents were home (${moved} px)`).toBeGreaterThan(35);
  expect(moved).toBeLessThan(75);
});
