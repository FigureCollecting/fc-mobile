import { test, expect, type Page } from '@playwright/test';

/**
 * These tests exist because jsdom (the unit-test environment) cannot see
 * real layout or stacking — bugs like a bottom sheet anchoring to a
 * transformed ancestor instead of the viewport, or a portal painting under
 * an overlay, only show up with a real browser computing real boxes. Phase
 * 1 found exactly that bug this way; these guard against a regression and
 * cover the new Phase 2 surfaces.
 *
 * Runs against `vite preview` (a real production build), in fixture mode —
 * fully offline against the seven dev fixtures, no backend required.
 */

async function seedFixtureMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
}

test.describe('overlay layout and stacking (real browser, fixture mode)', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixtureMode(page);
  });

  test('filter sheet is viewport-anchored, not nested inside a transformed ancestor', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/?layout=case&motif=detolf-dark');
    await page.waitForSelector('button.shelf-figure');

    await page.locator('.filter-bar__btn').first().click();
    const sheet = page.locator('.detent-sheet[data-detent="half"]');
    await expect(sheet).toBeVisible();
    // The open/detent transition is a framer-motion spring — let it settle
    // before reading geometry (mirrors the Phase 1 diagnostic script, which
    // waited ~1s for the same reason).
    await page.waitForTimeout(700);

    // The actual regression this guards: the sheet must be a direct child
    // of <body> (portaled), sharing the real viewport as its containing
    // block. Nested inside the page instead, a `.cq-grid` container-query
    // ancestor becomes the containing block for position:fixed and the
    // sheet anchors to that box instead of the viewport.
    const parentTag = await sheet.evaluate((el) => el.parentElement?.tagName.toLowerCase());
    expect(parentTag).toBe('body');

    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    // At the "half" detent by design only the top portion peeks into the
    // viewport — its top edge should land near the vertical midpoint, not
    // some viewport-unrelated number a broken containing block would produce.
    expect(box!.y).toBeGreaterThan(780 * 0.35);
    expect(box!.y).toBeLessThan(780 * 0.65);
  });

  test('viewer pull-up sheet is visible above photoswipe', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/?layout=rows');
    await page.waitForSelector('.jrows__item');

    await page.locator('.jrows__item').first().click();
    await page.waitForSelector('.pswp');
    const sheet = page.locator('.figure-viewer-sheet');
    await expect(sheet).toBeVisible();

    // Portaled to body, sharing photoswipe's stacking context.
    const parentTag = await sheet.evaluate((el) => el.parentElement?.tagName.toLowerCase());
    expect(parentTag).toBe('body');

    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.top ?? box!.y).toBeLessThan(780);
    expect(box!.y + box!.height).toBeLessThanOrEqual(780 + 2);

    const [sheetZ, pswpZ] = await Promise.all([
      sheet.evaluate((el) => Number(getComputedStyle(el).zIndex)),
      page.locator('.pswp').evaluate((el) => Number(getComputedStyle(el).zIndex)),
    ]);
    expect(sheetZ).toBeGreaterThan(pswpZ);
  });

  test('labels toggle shows museum nameplates on the display', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/?layout=case&motif=detolf-dark');
    await page.waitForSelector('button.shelf-figure');

    expect(await page.locator('.shelf-figure__plate').count()).toBe(0);

    await page.getByRole('button', { name: /labels: off/i }).click();

    const plate = page.locator('.shelf-figure__plate').first();
    await expect(plate).toBeVisible();
    await expect(plate.locator('.shelf-figure__plate-name')).not.toBeEmpty();
    await expect(page).toHaveURL(/labels=1/);
  });

  test('Fold-open dual-pane replaces the full-screen viewer at >= 640px', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto('/?layout=rows');
    await page.waitForSelector('.jrows__item');

    await page.locator('.jrows__item').first().click();

    const pane = page.locator('.detail-pane');
    await expect(pane).toBeVisible();
    // No full-screen takeover: photoswipe never mounts.
    expect(await page.locator('.pswp').count()).toBe(0);
    // The grid stays visible and interactive alongside the pane.
    expect(await page.locator('.jrows__item').count()).toBeGreaterThan(1);
  });
});
