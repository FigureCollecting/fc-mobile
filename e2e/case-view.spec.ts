import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import type { CaseViewport } from './caseViewports';

/**
 * The display case in a real browser: CSS 3D hit-testing and the
 * virtualized shelf layout are invisible to jsdom. Fixture mode, offline.
 */

test.use({ hasTouch: true, isMobile: true });

const DUAL_PANE_MIN_WIDTH = 640;

async function openCase(page: Page, size: CaseViewport, query = '') {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&motif=detolf-dark&density=compact${query}`);
  await page.waitForSelector('button.shelf-figure');
  // The boot splash veil covers the page (and takes every tap) until it is removed.
  await expect(page.locator('#pre-splash')).toHaveCount(0);
}

/** The locator's box once two reads 100 ms apart agree (the case relayouts
 *  after the detail pane closes and the column widens again). */
async function stableBox(locator: Locator) {
  let previous = await locator.boundingBox();
  for (let i = 0; i < 20; i++) {
    await locator.page().waitForTimeout(100);
    const box = await locator.boundingBox();
    if (box && previous && JSON.stringify(box) === JSON.stringify(previous)) return box;
    previous = box;
  }
  throw new Error('figure box never settled');
}

interface CaseLayout {
  caseHeight: number;
  bays: { top: number; bottom: number }[];
}

async function caseLayout(page: Page): Promise<CaseLayout> {
  await page.waitForTimeout(300);
  return page.locator('.case').evaluate((box) => ({
    caseHeight: Math.round(box.getBoundingClientRect().height),
    bays: Array.from(box.querySelectorAll('.case__bay')).map((bay) => {
      const r = bay.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  }));
}

function expectNoOverlap(layout: CaseLayout, label: string) {
  for (let i = 1; i < layout.bays.length; i++) {
    expect(layout.bays[i].top, `${label}: bay ${i} starts below bay ${i - 1}`).toBeGreaterThanOrEqual(
      layout.bays[i - 1].bottom,
    );
  }
}

for (const size of CASE_VIEWPORTS) {
  test.describe(`case view at ${size.name} ${size.width}x${size.height}`, () => {
    test('tapping a figure opens the viewer for that figure', async ({ page }) => {
      await openCase(page, size);
      const figures = page.locator('button.shelf-figure');
      const count = await figures.count();
      expect(count).toBe(7);

      for (let i = 0; i < count; i++) {
        const figure = figures.nth(i);
        const name = (await figure.locator('.sr-only').textContent())?.trim();
        const box = await stableBox(figure);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

        const opened = size.width >= DUAL_PANE_MIN_WIDTH ? page.locator('.detail-pane') : page.locator('.pswp--open');
        await expect(opened, `tap on "${name}" opens the viewer`).toBeVisible({ timeout: 3_000 });
        await expect(page.locator('.figure-viewer-sheet__name')).toHaveText(name!);

        if (size.width >= DUAL_PANE_MIN_WIDTH) {
          await page.getByRole('button', { name: 'Close detail' }).click();
          await expect(page.locator('.detail-pane')).toHaveCount(0);
        } else {
          // PhotoSwipe ignores Escape until its opening animation ends.
          await expect(async () => {
            await page.keyboard.press('Escape');
            await expect(page.locator('.pswp')).toHaveCount(0, { timeout: 500 });
          }).toPass({ timeout: 5_000 });
        }
      }
    });

    test('switching density or labels in the page relayouts the shelves like a fresh load', async ({ page }) => {
      await openCase(page, size);
      const inPage: Record<string, CaseLayout> = {};
      // compact -> gallery -> comfortable -> compact, then labels on: no reloads.
      for (const next of ['gallery', 'comfortable', 'compact']) {
        await page.locator('button[aria-label^="Density:"]').click();
        await expect(page).toHaveURL(new RegExp(`density=${next}`));
        inPage[next] = await caseLayout(page);
      }
      await page.getByRole('button', { name: /labels: off/i }).click();
      await expect(page).toHaveURL(/labels=1/);
      inPage['compact&labels=1'] = await caseLayout(page);

      for (const [query, layout] of Object.entries(inPage)) {
        expectNoOverlap(layout, `in-page ${query}`);
        await page.goto(`/?layout=case&motif=detolf-dark&density=${query}`);
        await page.waitForSelector('button.shelf-figure');
        expect(layout, `in-page switch to ${query} matches a fresh load`).toEqual(await caseLayout(page));
      }
    });
  });
}
