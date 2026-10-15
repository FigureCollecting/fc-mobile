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
      // past Chromium's touch slop (it holds back a finger's first moves on a scroller), so the card is taken by now
      // whether the finger landed on the handle or, the card still settling, just below it on the contents
      await finger.to(grip.x, grip.y + way * 20, 3, 16);
      // the card is drawn a frame after it moves: read it with the finger still
      await page.waitForTimeout(50);
      const taken = await top(sheet);
      await finger.to(grip.x, grip.y + card.handleDy, 4, 16);
      await page.waitForTimeout(50);
      const held = await top(sheet);
      await finger.end();
      const travel = card.handleDy - way * 20;
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

/** A tap on each card's handle does the opposite of a short drag the other way: View's closes it, Refine's raises it to full, Info's opens every field. */
const INVERTED: Record<Card['name'], { dy: number; rests: (sheet: Locator) => Promise<void> }> = {
  View: { dy: -1, rests: async (sheet) => expect(sheet).toHaveCount(1) },
  Refine: { dy: 1, rests: async (sheet) => expect(sheet).toHaveAttribute('data-detent', 'half') },
  Info: { dy: 1, rests: async (sheet) => expect(sheet).toHaveAttribute('data-detent', 'summary') },
};

for (const size of FOLD8) {
  for (const card of CARDS.filter((c) => c.name !== 'Info' || size.width < DUAL_PANE_MIN_WIDTH)) {
    for (const px of [6, 12]) {
      test(`${card.name}: a ${px} px touch drag on the handle is a drag, never also the handle's tap: ${size.name}`, async ({ page }) => {
        await openCase(page, size);
        const sheet = await openCard(page, card);
        const rest = await top(sheet);
        const grip = await centre(page.locator(card.handle));
        const way = INVERTED[card.name].dy;
        // past the card's own slop, within the browser's tap slop: the browser still sends a click on the lift
        const finger = await touchDown(page, grip.x, grip.y);
        await finger.to(grip.x, grip.y + way * px, 3, 16);
        await page.waitForTimeout(50);
        const held = await top(sheet);
        await finger.end();
        await page.waitForTimeout(500);
        expect.soft(held - rest, `the card followed the finger (rest ${rest}, held ${held})`).not.toBe(0);
        await INVERTED[card.name].rests(sheet);
        await atRest(sheet);
        expect(Math.abs((await top(sheet)) - rest), 'back on the detent it left').toBeLessThanOrEqual(1);
      });
    }
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

for (const size of FOLD8) {
  test(`Refine applies live under the finger: a maker narrows the case behind the card at once, N of M; Done closes it; the row shows only while filtered: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    // nothing filtered: no filter row, no filter bar, no holdings tab row
    await expect(page.locator('.applied-chips')).toHaveCount(0);
    await expect(page.locator('.filter-bar')).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Collections' })).toHaveCount(0);
    await tapCentre(page, page.getByRole('button', { name: 'Refine', exact: true }));
    const card = page.locator('.detent-sheet');
    await atRest(card);
    const count = card.locator('.filter-sheet2__count');
    const all = Number((await count.innerText()).split(' of ')[1]);
    await expect(count).toHaveText(`${all} of ${all}`);
    await expect(card.getByRole('button', { name: /^Show/ })).toHaveCount(0);
    await card.getByRole('button', { name: /^Good Smile Company\s*\d/ }).first().tap();
    // the card is still open, and the case behind it already shows only that maker
    await expect(count).toHaveText(new RegExp(`^[1-9]\\d* of ${all}$`));
    const shown = Number((await count.innerText()).split(' of ')[0]);
    expect(shown).toBeLessThan(all);
    await expect(card).toBeVisible();
    await expect.poll(async () => (await page.locator('button.cab-figure').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).length).toBeLessThanOrEqual(shown);
    await card.getByRole('button', { name: 'Done' }).tap();
    await expect(card).toHaveCount(0);
    const row = page.locator('.applied-chips');
    await expect(row).toBeVisible();
    await expect(row.locator('.applied-chips__count')).toHaveText(`${shown} of ${all}`);
    await row.getByRole('listitem', { name: 'Remove filter Good Smile Company' }).tap();
    await expect(row).toHaveCount(0);
  });

  test(`Holdings live in Refine with their counts; Wished alone applies at once: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await tapCentre(page, page.getByRole('button', { name: 'Refine', exact: true }));
    const card = page.locator('.detent-sheet');
    await atRest(card);
    const holding = card.getByRole('group', { name: 'Holding' });
    const names = await holding.getByRole('button').allInnerTexts();
    expect(names.map((n) => n.replace(/\s*\d+$/, ''))).toEqual(['Owned', 'Ordered', 'Wished', 'No longer owned']);
    const wished = holding.getByRole('button', { name: /^Wished/ });
    const n = Number((await wished.innerText()).match(/(\d+)$/)![1]);
    expect(n).toBeGreaterThan(0);
    await wished.tap();
    await expect(wished).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.filter-sheet2__count')).toHaveText(`${n} of ${n}`);
  });

  test(`Header: two mode buttons at fixed places, the active one opens its views with the current ticked; no Select: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0);
    const caseBtn = page.getByRole('button', { name: /^Case,/ });
    const tilesBtn = page.getByRole('button', { name: /^Tiles,/ });
    const labelsBtn = page.getByRole('button', { name: /^Labels:/ });
    const places = async () => JSON.stringify(await Promise.all([caseBtn, tilesBtn, labelsBtn].map((b) => b.boundingBox())));
    const at = await places();
    await caseBtn.tap();
    const menu = page.getByRole('menu', { name: 'Case views' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Whole cabinets' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: 'One shelf' }).tap();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-view', 'shelf');
    await expect(caseBtn).toHaveAttribute('aria-label', 'Case, One shelf');
    expect(await places(), 'no button moved or grew picking a view').toBe(at);
    await tilesBtn.tap();
    await expect(page.locator('.jrows')).toBeVisible();
    expect(await places(), 'no button moved or grew switching to the tiles').toBe(at);
    await tilesBtn.tap();
    const tiles = page.getByRole('menu', { name: 'Tiles views' });
    await expect(tiles.getByRole('menuitemradio')).toHaveText(['Comfortable', 'Compact', 'Gallery']);
    await tiles.getByRole('menuitemradio', { name: 'Gallery' }).tap();
    await expect(tilesBtn).toHaveAttribute('aria-label', 'Tiles, Gallery');
    expect(await places(), 'no button moved or grew picking a density').toBe(at);
    // the tiles keep Refine (and Info) under the thumb
    await expect(page.locator('.case-tabs__tab[data-tab="refine"]')).toBeVisible();
  });
}

for (const size of FOLD8.filter((v) => v.width < DUAL_PANE_MIN_WIDTH)) {
  test(`Info: an X from the first moment, Back, a tap off the picture and Esc each close it; prev/next by swipe stay; every field at the top detent: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    const url = page.url();
    const viewer = page.locator('.pswp');
    const x = page.getByRole('button', { name: 'Close', exact: true });
    // the X, at once, with no tap
    await openFigure(page);
    await expect(viewer).toBeVisible();
    await expect(x).toBeVisible();
    // clear of PhotoSwipe's own top-bar buttons (its zoom), never over one
    const xBox = (await x.boundingBox())!;
    for (const b of await page.locator('.pswp__top-bar .pswp__button').all()) {
      const box = await b.boundingBox();
      if (!box || !(await b.isVisible())) continue;
      const overlaps = box.x < xBox.x + xBox.width && xBox.x < box.x + box.width && box.y < xBox.y + xBox.height && xBox.y < box.y + box.height;
      expect(overlaps, `the X overlaps ${await b.getAttribute('class')}`).toBe(false);
    }
    await x.tap();
    await expect(viewer).toHaveCount(0);
    await expect(x).toHaveCount(0);
    // Back
    await openFigure(page);
    await expect(viewer).toBeVisible();
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    expect(page.url()).toBe(url);
    // a tap off the picture
    await openFigure(page);
    await expect(viewer).toBeVisible();
    await page.waitForTimeout(400);
    await touchTap(page, 8, Math.round(size.height * 0.2));
    await expect(viewer).toHaveCount(0);
    // Esc
    await openFigure(page);
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    // a swipe left on the picture still moves to the next figure, and the sheet follows
    await openFigure(page);
    const counter = page.locator('.figure-viewer-sheet__counter');
    const before = await counter.innerText();
    await page.waitForTimeout(400);
    await touchSwipe(page, size.width * 0.75, size.height * 0.35, -size.width * 0.5, 0, 8, 16);
    await expect(counter).not.toHaveText(before);
    // every field shows at the top detent: the handle's tap takes it there, nothing else needed
    const sheet = page.locator('.figure-viewer-sheet');
    await atRest(sheet);
    await page.locator('.figure-viewer-sheet__handle').tap();
    await expect(sheet).toHaveAttribute('data-detent', 'all');
    await atRest(sheet);
    const rows = sheet.locator('.figure-viewer-sheet__row');
    expect(await rows.count()).toBeGreaterThan(2);
    const body = (await sheet.locator('.figure-viewer-sheet__body').boundingBox())!;
    const last = (await rows.last().boundingBox())!;
    expect(last.y + last.height, 'the last field is within the sheet, a scroll away at most').toBeLessThanOrEqual(body.y + Math.max(body.height, (await sheet.locator('.figure-viewer-sheet__body').evaluate((el) => el.scrollHeight))) + 1);
    expect(body.y + body.height).toBeLessThanOrEqual(size.height + 1);
  });
}

for (const size of FOLD8) {
  for (const card of CARDS.filter((c) => c.name !== 'Info')) {
    test(`${card.name}: Back and Esc close it, the page stays where it was: ${size.name}`, async ({ page }) => {
      await openCase(page, size);
      const url = page.url();
      const sheet = await openCard(page, card);
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      expect(page.url()).toBe(url);
      await openCard(page, card);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      expect(page.url()).toBe(url);
    });
  }
}

for (const size of FOLD8.filter((v) => v.width >= DUAL_PANE_MIN_WIDTH)) {
  for (const card of CARDS.filter((c) => c.name !== 'Info')) {
    test(`Info pane under ${card.name}: Esc and Back close ${card.name} on top and leave the pane; the next Back closes the pane: ${size.name}`, async ({ page }) => {
      await openCase(page, size);
      const url = page.url();
      const pane = page.locator('.detail-pane');
      await openFigure(page);
      await expect(pane).toBeVisible();
      const sheet = await openCard(page, card);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(pane).toBeVisible();
      await openCard(page, card);
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(pane).toBeVisible();
      expect(page.url()).toBe(url);
      await page.goBack();
      await expect(pane).toHaveCount(0);
      expect(page.url()).toBe(url);
    });
  }
}

for (const size of FOLD8) {
  test(`Refine: the last chosen holding stays chosen (no empty choice); Clear goes back to the defaults: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    await openCard(page, CARDS.find((c) => c.name === 'Refine')!);
    const holding = page.getByRole('group', { name: 'Holding' });
    const owned = holding.getByRole('button', { name: /^Owned/ });
    const count = page.locator('.filter-sheet2__count');
    await tapCentre(page, owned);
    await expect(owned).toHaveAttribute('aria-pressed', 'true');
    const ownedOnly = await count.textContent();
    await tapCentre(page, owned);
    await page.waitForTimeout(300);
    await expect(owned).toHaveAttribute('aria-pressed', 'true');
    await expect(count).toHaveText(ownedOnly!);
    await tapCentre(page, page.getByRole('button', { name: 'Clear', exact: true }));
    // the fixtures' default holds none: every holding but No longer owned shows
    await expect(holding.locator('[aria-pressed="true"]')).toHaveCount(0);
  });
}

test('a holding the address names twice is one chip; one it does not know is none', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(FOLD8[0]);
  await page.goto('/?layout=case&status=owned|owned|bogus');
  await page.waitForSelector('button.cab-figure');
  const list = page.getByRole('list', { name: 'Applied filters' });
  await expect(list.getByRole('listitem').filter({ hasText: /^Owned$/ })).toHaveCount(1);
  await expect(list).not.toContainText('bogus');
});

/** The collection, reached from Settings, so a Back that is not the viewer's own leaves for Settings. */
async function openCaseFromSettings(page: Page, size: { width: number; height: number }): Promise<{ settings: string; collection: string }> {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  const settings = page.url();
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  // the case frames itself to the screen: let it settle before aiming at a figure
  await page.waitForTimeout(500);
  return { settings, collection: page.url() };
}

for (const size of FOLD8.filter((v) => v.width < DUAL_PANE_MIN_WIDTH)) {
  test(`History: Info closed by its X three times leaves no entry behind; Back then leaves the page: ${size.name}`, async ({ page }) => {
    const { settings, collection } = await openCaseFromSettings(page, size);
    for (let i = 0; i < 3; i++) {
      await openFigure(page);
      await expect(page.locator('.pswp')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(page.locator('.pswp')).toHaveCount(0);
    }
    await page.waitForTimeout(300);
    expect(page.url()).toBe(collection);
    await page.goBack();
    await expect.poll(() => page.url()).toBe(settings);
  });

  test(`History: Info closed by its X and opened again at once (its Back still owed): Back closes it, the next Back leaves: ${size.name}`, async ({ page }) => {
    const { settings, collection } = await openCaseFromSettings(page, size);
    await openFigure(page);
    await expect(page.locator('.pswp')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await openFigure(page);
    await expect(page.locator('.figure-viewer-sheet')).toBeVisible();
    await page.waitForTimeout(500);
    await page.goBack();
    await expect(page.locator('.figure-viewer-sheet')).toHaveCount(0);
    expect(page.url()).toBe(collection);
    await page.goBack();
    await expect.poll(() => page.url()).toBe(settings);
  });
}

for (const size of FOLD8.filter((v) => v.width >= DUAL_PANE_MIN_WIDTH)) {
  test(`Info pane: its X, Back and Esc each close it; every field shows: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    const url = page.url();
    const pane = page.locator('.detail-pane');
    await openFigure(page);
    await expect(pane).toBeVisible();
    expect(await pane.locator('.figure-viewer-sheet__row').count()).toBeGreaterThan(2);
    await pane.getByRole('button', { name: 'Close detail' }).tap();
    await expect(pane).toHaveCount(0);
    // the case re-frames to the width the pane leaves it: let it settle before aiming at a figure
    await page.waitForTimeout(500);
    await openFigure(page);
    await expect(pane).toBeVisible();
    await page.goBack();
    await expect(pane).toHaveCount(0);
    expect(page.url()).toBe(url);
    await page.waitForTimeout(500);
    await openFigure(page);
    await expect(pane).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
  });
}
