import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import type { CaseViewport } from './caseViewports';
import { figurePixels, visibleSpot, overlapSpots, emptySpotInBox } from './figurePixels';
import type { FigurePixels, Spot } from './figurePixels';

/**
 * The display case in a real browser: CSS 3D hit-testing and the
 * virtualized shelf layout are invisible to jsdom. Fixture mode, offline.
 */

test.use({ hasTouch: true, isMobile: true });

const DUAL_PANE_MIN_WIDTH = 640;

async function openCase(page: Page, size: CaseViewport, query = '', density = 'compact') {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&motif=detolf-dark&density=${density}${query}`);
  await page.waitForSelector('button.shelf-figure');
  // The boot splash veil covers the page (and takes every tap) until it is removed.
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('.case img')).every((img) => img.complete && img.naturalWidth > 0),
  );
}

function viewer(page: Page, size: CaseViewport) {
  return size.width >= DUAL_PANE_MIN_WIDTH ? page.locator('.detail-pane') : page.locator('.pswp--open');
}

async function closeViewer(page: Page, size: CaseViewport) {
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

/** Waits until every figure is back where it was measured (the case
 *  relayouts after the detail pane closes and the column widens again). */
async function figuresAt(page: Page, fp: FigurePixels) {
  const round = (boxes: { x: number; y: number; width: number; height: number }[]) =>
    boxes.map((b) => [b.x, b.y, b.width, b.height].map((v) => Math.round(v)).join(','));
  await expect
    .poll(async () =>
      round(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('button.shelf-figure')).map((b) => {
            const r = b.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        ),
      ),
    )
    .toEqual(round(fp.boxes));
}

/** Taps the pixel at `spot` and expects the viewer to open on `name`. */
async function tapOpens(page: Page, size: CaseViewport, fp: FigurePixels, spot: Spot, name: string, why: string) {
  await figuresAt(page, fp);
  await page.touchscreen.tap(spot.x + 0.5, spot.y + 0.5);
  await expect(viewer(page, size), `${why}: the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name'), why).toHaveText(name);
  await closeViewer(page, size);
}

/** Taps the pixel at `spot` and expects nothing to open. */
async function tapOpensNothing(page: Page, size: CaseViewport, fp: FigurePixels, spot: Spot, why: string) {
  await figuresAt(page, fp);
  await page.touchscreen.tap(spot.x + 0.5, spot.y + 0.5);
  await page.waitForTimeout(800);
  await expect(viewer(page, size), why).toHaveCount(0);
  await expect(page.locator('.pswp'), why).toHaveCount(0);
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
    test('a tap opens the figure drawn under the finger, and nothing where no figure is drawn', async ({ page }) => {
      await openCase(page, size);
      const fp = await figurePixels(page);
      expect(fp.names).toHaveLength(7);

      // A transparent spot inside a figure's box (its rectangle took every
      // such tap before).
      const empty = fp.boxes.map((_, i) => emptySpotInBox(fp, i)).find((spot) => spot !== null);
      expect(empty, 'a transparent spot inside some figure box').toBeTruthy();
      await tapOpensNothing(page, size, fp, empty!, `tap at ${empty!.x},${empty!.y} where no figure is drawn`);

      for (let i = 0; i < fp.names.length; i++) {
        const spot = visibleSpot(fp, i);
        expect(spot, `"${fp.names[i]}" shows on screen`).toBeTruthy();
        await tapOpens(page, size, fp, spot!, fp.names[i], `tap on "${fp.names[i]}" at ${spot!.x},${spot!.y}`);
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

    test('a short collection fills the screen with empty shelves, without scrolling', async ({ page }) => {
      await openCase(page, size);
      const layout = await caseLayout(page);
      const fit = await page.evaluate(() => {
        const scroller = document.querySelector('.app-content') as HTMLElement;
        const box = document.querySelector('.case') as HTMLElement;
        const visibleBottom =
          scroller.getBoundingClientRect().top + scroller.clientHeight - parseFloat(getComputedStyle(scroller).paddingBottom);
        return {
          gap: Math.round(visibleBottom - box.getBoundingClientRect().bottom),
          scrolls: scroller.scrollHeight > scroller.clientHeight,
          empty: Array.from(document.querySelectorAll('.case__bay[data-empty="true"]')).map((bay) => ({
            height: Math.round(bay.getBoundingClientRect().height),
            figures: bay.querySelectorAll('.shelf-figure').length,
          })),
          occupied: Array.from(document.querySelectorAll('.case__bay:not([data-empty])')).map((bay) =>
            Math.round(bay.getBoundingClientRect().height),
          ),
        };
      });
      expectNoOverlap(layout, 'filled case');
      expect(fit.scrolls, 'the filled case never makes the page scroll').toBe(false);
      expect(fit.empty.length, 'empty shelves below the figures').toBeGreaterThan(0);
      const pitch = fit.empty[0].height;
      for (const bay of fit.empty) {
        expect(bay).toEqual({ height: pitch, figures: 0 });
      }
      expect(pitch).toBeLessThanOrEqual(Math.max(...fit.occupied));
      expect(pitch).toBeGreaterThanOrEqual(Math.min(...fit.occupied));
      // Down to the bottom of the screen: less than one more shelf (plus the
      // page's own bottom padding) is left under the cabinet.
      expect(fit.gap).toBeGreaterThanOrEqual(0);
      expect(fit.gap).toBeLessThan(pitch + 16);
    });

    test('a collection taller than the screen gets no empty shelves', async ({ page }) => {
      await openCase(page, size, '&fx=12');
      expect(await page.locator('.case__bay[data-empty="true"]').count()).toBe(0);
    });
  });
}

/**
 * Where a nearer figure's box covers part of a figure behind it, a tap
 * belongs to the figure the user sees at that pixel, never to the nearer
 * figure's transparent surroundings. The fixtures overlap only by a sliver
 * in these layouts (hence radius 1: a pixel whose 3x3 neighbourhood is all
 * the figure behind); `slide` also moves one figure halfway over its
 * neighbour for a deep overlap. Framed photos fill their whole box.
 */
const PIXEL_CASES = [
  { label: 'matted, compact, three sets', size: 'fold8-open-landscape-est', density: 'compact', query: '&fx=3', radius: 1 },
  { label: 'silhouettes, compact, three sets', size: 'fold8-open-landscape-est', density: 'compact', query: '&fx=3&fxbranch=silhouette', radius: 1 },
  { label: 'matted, one figure slid over its neighbour', size: 'fold8-cover-est', density: 'compact', query: '', radius: 3, slide: true },
  { label: 'framed photos, compact', size: 'fold8-cover-est', density: 'compact', query: '&fxbranch=framed' },
];

/** Moves the nearer of two neighbouring figures on the first shelf over the
 *  other one's centre; returns the moved figure's accessible name. */
async function slideNeighbourOver(page: Page): Promise<string> {
  const name = await page.evaluate(() => {
    const bay = document.querySelector('.case__bay')!;
    const figures = Array.from(bay.querySelectorAll<HTMLElement>('button.shelf-figure')).map((el) => ({
      el,
      x: parseFloat(el.style.getPropertyValue('--fig-x')),
      z: parseFloat(el.style.getPropertyValue('--fig-z')),
      w: parseFloat(el.style.width),
    }));
    figures.sort((a, b) => a.x - b.x);
    const pairs = figures.slice(1).map((b, i) => [figures[i], b]);
    const [back, front] = pairs.map(([a, b]) => (a.z < b.z ? [a, b] : [b, a])).find(([a, b]) => b.z > a.z)!;
    front.el.dataset.e2eSlid = '1';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`.shelf-figure[data-e2e-slid]{--fig-x:${back.x + (back.w - front.w) / 2}px !important}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return front.el.querySelector('.sr-only')!.textContent!.trim();
  });
  return name;
}

for (const c of PIXEL_CASES) {
  const size = CASE_VIEWPORTS.find((v) => v.name === c.size)!;
  test(`tap targets follow the drawn pixels: ${c.label} at ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    await openCase(page, size, c.query, c.density);
    const slid = c.slide ? await slideNeighbourOver(page) : null;
    const fp = await figurePixels(page);

    if (c.radius !== undefined) {
      const spots = overlapSpots(fp, c.radius);
      expect(spots.length, 'a figure is seen inside the box of a figure in front of it').toBeGreaterThan(0);
      if (slid) expect(fp.names[spots[0].front]).toBe(slid);
      // The spot nearest a front figure's outline, for up to three figures seen.
      const bySeen = new Map<number, (typeof spots)[number]>();
      for (const spot of spots) if (!bySeen.has(spot.seen)) bySeen.set(spot.seen, spot);
      for (const spot of [...bySeen.values()].slice(0, 3)) {
        await tapOpens(
          page,
          size,
          fp,
          spot,
          fp.names[spot.seen],
          `tap on "${fp.names[spot.seen]}" at ${spot.x},${spot.y}, inside the box of "${fp.names[spot.front]}" in front of it`,
        );
      }
      const empty = fp.boxes.map((_, i) => emptySpotInBox(fp, i)).find((spot) => spot !== null);
      expect(empty, 'a transparent spot inside some figure box').toBeTruthy();
      await tapOpensNothing(page, size, fp, empty!, `tap at ${empty!.x},${empty!.y} where no figure is drawn`);
    }

    // Every figure of the first set still opens from a pixel of its own.
    for (let i = 0; i < Math.min(7, fp.names.length); i++) {
      const spot = visibleSpot(fp, i);
      expect(spot, `"${fp.names[i]}" shows on screen`).toBeTruthy();
      await tapOpens(page, size, fp, spot!, fp.names[i], `tap on "${fp.names[i]}" at ${spot!.x},${spot!.y}`);
    }
  });
}
