import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { atRest, takesTap } from './sheetRest';
import { touchTap } from './touch';

/**
 * SIZE-BASIS-1 (Ross 10-18, "makes me wonder if they got the size data or if they assumed height or scale"): at the Fold8's
 * four panels under a real finger, the View card's "Show estimated sizes" outlines the figures whose height or width is an
 * estimate and says how many there are; off, nothing is outlined. ?fxwidth=none drops the fixtures' labelled widths, so each
 * is sized from the photo's shape; the fixtures as they are have a height and a width each, the control with nothing to show.
 * The Info card says what the size rests on.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const DUAL_PANE_MIN_WIDTH = 640;

async function openCase(page: Page, size: { width: number; height: number }, query: string) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize(size);
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

const tap = async (page: Page, l: Locator) => {
  const b = (await l.boundingBox())!;
  await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
};

async function openViewCard(page: Page) {
  await tap(page, page.getByRole('button', { name: 'View', exact: true }));
  const card = page.locator('.bottom-sheet');
  await expect(card).toBeVisible();
  await atRest(card);
  return card;
}

/** The outline each drawn figure has, as the browser computes it. */
const outlines = (page: Page) =>
  page.locator('button.cab-figure').evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.figureId, estimated: (e as HTMLElement).dataset.sizeEstimated, style: getComputedStyle(e).outlineStyle })));

for (const size of FOLD8) {
  test(`the View card outlines the figures sized from estimates, and counts them: ${size.name}`, async ({ page }) => {
    await openCase(page, size, '&fxwidth=none');
    // nothing outlined to begin with, though every figure says its width is an estimate
    const before = await outlines(page);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((o) => o.estimated === 'width')).toBe(true);
    expect(before.every((o) => o.style === 'none')).toBe(true);

    const card = await openViewCard(page);
    await expect(card.getByText('7 figures sized from estimates')).toBeVisible();
    const box = card.getByRole('checkbox', { name: 'Show estimated sizes' });
    await expect(box).not.toBeChecked();
    // the card scrolls its body (CC5): scrolled into view there, a finger at the toggle's centre lands on it
    const reach = await takesTap(box.locator('xpath=ancestor::label'), '.bottom-sheet__content');
    expect(reach.hit, `a tap reaches the toggle: ${reach.at}`).toBe(true);

    await box.check();
    await expect(box).toBeChecked();
    const after = await outlines(page);
    expect(after.every((o) => o.style === 'dashed'), `every estimated figure is outlined: ${JSON.stringify(after.map((o) => o.style))}`).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fc-case-prefs')!).showEstimated)).toBe(true);

    // and off again
    await box.uncheck();
    expect((await outlines(page)).every((o) => o.style === 'none')).toBe(true);
  });

  test(`with every figure's height and width from the listing nothing is outlined, and the card counts none: ${size.name}`, async ({ page }) => {
    await openCase(page, size, '');
    expect((await outlines(page)).every((o) => o.estimated === '')).toBe(true);
    const card = await openViewCard(page);
    await expect(card.getByText(/sized from/)).toHaveCount(0);
    await card.getByRole('checkbox', { name: 'Show estimated sizes' }).check();
    expect((await outlines(page)).every((o) => o.style === 'none'), 'turned on, there is still nothing to outline').toBe(true);
  });
}

test('the Info card says what the size rests on', async ({ page }) => {
  const size = FOLD8.find((v) => v.width >= DUAL_PANE_MIN_WIDTH)!;
  await openCase(page, size, '&fxwidth=none');
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figs = page.locator('button.cab-figure');
  for (let i = 0; i < (await figs.count()); i++) {
    const bb = await figs.nth(i).boundingBox();
    if (bb && bb.y >= frame.y && bb.y + bb.height <= frame.y + frame.height && bb.x >= frame.x && bb.x + bb.width <= frame.x + frame.width) {
      await touchTap(page, bb.x + bb.width / 2, bb.y + bb.height / 2);
      break;
    }
  }
  const pane = page.locator('.detail-pane');
  await expect(pane).toBeVisible();
  const row = pane.locator('.figure-viewer-sheet__row', { hasText: 'Size' });
  await expect(row).toContainText('mm tall');
  await expect(row).toContainText('width from the photo');
  await expect(row).toContainText('depth from the width');
});
