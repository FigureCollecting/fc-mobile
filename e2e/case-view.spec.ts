import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import type { CaseViewport } from './caseViewports';
import { figurePixels, visibleSpot, overlapSpots, occludingSpots, emptySpotInBox, ownerAt, inBox, inFrontOf, solid, EMPTY } from './figurePixels';
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

/** Taps the pixel at `spot` (at `within` of the way into it) and expects nothing to open. */
async function tapOpensNothing(page: Page, size: CaseViewport, fp: FigurePixels, spot: Spot, why: string, within = 0.5) {
  await figuresAt(page, fp);
  await page.touchscreen.tap(spot.x + within, spot.y + within);
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

      // Labels alone on a collection taller than the screen: no empty shelves
      // either way, so the shelf COUNT stays the same and only a re-measure
      // of the shelves (not a rebuild for a new count) can move them.
      await page.goto('/?layout=case&motif=detolf-dark&density=compact&fx=12');
      await page.waitForSelector('button.shelf-figure');
      await expect(page.locator('#pre-splash')).toHaveCount(0);
      for (const query of ['compact&fx=12&labels=1', 'compact&fx=12']) {
        await page.getByRole('button', { name: /labels: (off|on)/i }).click();
        await expect(page).toHaveURL(query.endsWith('labels=1') ? /labels=1/ : /^(?!.*labels=1)/);
        inPage[query] = await caseLayout(page);
        expect(await page.locator('.case__bay[data-empty="true"]').count(), `${query}: no empty shelves`).toBe(0);
      }

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
 *
 * `occluded`: where a nearer figure is drawn over a farther one, the tap
 * belongs to the nearer one. The browser lists the elements at a point in
 * page order, not depth order, so the pairs that matter are a nearer figure
 * that comes EARLIER in the page than the figure it covers (`earlier`
 * requires one); `slideUnder` makes such a pair deep by sliding the farther
 * figure under the nearer one. `pin` is a pixel of `seen` that opened
 * `under`, the figure behind it, before.
 */
interface PixelCase {
  label: string;
  size: string;
  density: string;
  query: string;
  radius?: number;
  slide?: boolean;
  slideUnder?: boolean;
  occluded?: boolean;
  earlier?: boolean;
  pin?: { x: number; y: number; seen: string; under: string };
}

const PIXEL_CASES: PixelCase[] = [
  { label: 'matted, compact, three sets', size: 'fold8-open-landscape-est', density: 'compact', query: '&fx=3', radius: 1 },
  { label: 'silhouettes, compact, three sets', size: 'fold8-open-landscape-est', density: 'compact', query: '&fx=3&fxbranch=silhouette', radius: 1 },
  { label: 'matted, one figure slid over its neighbour', size: 'fold8-cover-est', density: 'compact', query: '', radius: 3, slide: true },
  { label: 'framed photos, compact', size: 'fold8-cover-est', density: 'compact', query: '&fxbranch=framed' },
  {
    label: 'framed photos, compact, three sets',
    size: 'fold8-open-landscape-est',
    density: 'compact',
    query: '&fx=3&fxbranch=framed',
    occluded: true,
    earlier: true,
    pin: { x: 757, y: 190, seen: 'Nendoroid Hatsune Miku', under: 'Madoka Kaname' },
  },
  {
    label: 'matted, a farther figure later in the page slid under a nearer one',
    size: 'fold8-cover-est',
    density: 'compact',
    query: '',
    slideUnder: true,
    occluded: true,
    earlier: true,
  },
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

/** On the first shelf, slides a figure that stands farther back and comes
 *  later in the page under the centre of the nearer figure just before it;
 *  returns both accessible names. */
async function slideFartherUnder(page: Page): Promise<{ front: string; back: string }> {
  return page.evaluate(() => {
    const bay = document.querySelector('.case__bay')!;
    const figures = Array.from(bay.querySelectorAll<HTMLElement>('button.shelf-figure')).map((el) => ({
      el,
      x: parseFloat(el.style.getPropertyValue('--fig-x')),
      z: parseFloat(el.style.getPropertyValue('--fig-z')),
      w: parseFloat(el.style.width),
    }));
    const k = figures.findIndex((front, i) => i + 1 < figures.length && front.z > figures[i + 1].z);
    if (k < 0) throw new Error('no figure on the first shelf stands in front of the next one');
    const [front, back] = [figures[k], figures[k + 1]];
    back.el.dataset.e2eSlid = '1';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`.shelf-figure[data-e2e-slid]{--fig-x:${front.x + (front.w - back.w) / 2}px !important}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const name = (el: HTMLElement) => el.querySelector('.sr-only')!.textContent!.trim();
    return { front: name(front.el), back: name(back.el) };
  });
}

for (const c of PIXEL_CASES) {
  const size = CASE_VIEWPORTS.find((v) => v.name === c.size)!;
  test(`tap targets follow the drawn pixels: ${c.label} at ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    await openCase(page, size, c.query, c.density);
    const slid = c.slide ? await slideNeighbourOver(page) : null;
    const slidUnder = c.slideUnder ? await slideFartherUnder(page) : null;
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

    if (c.pin) {
      const { x, y, seen, under } = c.pin;
      const at = ownerAt(fp, x, y);
      expect(at >= 0 ? fp.names[at] : at, `the pinned pixel ${x},${y} shows "${seen}"`).toBe(seen);
      // The click lands on the rounded point (x + 1, y + 1), where the
      // browser also lists the frame of the figure behind.
      const behind = fp.names.findIndex((name, i) => name === under && inFrontOf(fp, at, i) && inBox(fp.boxes[i], x + 1, y, -1));
      expect(behind, `"${under}" stands behind "${seen}", its box within a pixel of ${x},${y}`).toBeGreaterThanOrEqual(0);
      await tapOpens(page, size, fp, { x, y }, seen, `tap on "${seen}" at ${x},${y}, in front of "${under}"`);
    }

    if (c.occluded) {
      const spots = occludingSpots(fp);
      expect(spots.length, 'a nearer figure is drawn over a figure behind it').toBeGreaterThan(0);
      // The nearer figure comes earlier in the page than the one it covers.
      const earlier = spots.filter((spot) => spot.seen < spot.under);
      if (c.earlier) expect(earlier.length, 'a nearer figure earlier in the page covers a later one').toBeGreaterThan(0);
      if (slidUnder) {
        expect(
          earlier.map((spot) => `${fp.names[spot.seen]} over ${fp.names[spot.under]}`),
          'the slid figure is drawn under the nearer one',
        ).toContain(`${slidUnder.front} over ${slidUnder.back}`);
      }
      const later = spots.filter((spot) => spot.seen > spot.under);
      for (const spot of [...earlier.slice(0, 3), ...later.slice(0, 1)]) {
        await tapOpens(
          page,
          size,
          fp,
          spot,
          fp.names[spot.seen],
          `tap on "${fp.names[spot.seen]}" at ${spot.x},${spot.y}, drawn over "${fp.names[spot.under]}" behind it`,
        );
      }
    }

    // Every figure of the first set still opens from a pixel of its own.
    for (let i = 0; i < Math.min(7, fp.names.length); i++) {
      const spot = visibleSpot(fp, i);
      expect(spot, `"${fp.names[i]}" shows on screen`).toBeTruthy();
      await tapOpens(page, size, fp, spot!, fp.names[i], `tap on "${fp.names[i]}" at ${spot!.x},${spot!.y}`);
    }
  });
}

/**
 * Pixel rows just inside the top of a figure's image that pressing it
 * (.shelf-figure:active shrinks the figure 1.5 %) moves out from under the
 * finger, with nothing drawn within 2 px: a real tap there clicks at a point
 * outside the pressed element. Each spot is the pixel whose top-left corner
 * the click reports.
 */
async function pressBandSpots(page: Page, fp: FigurePixels): Promise<(Spot & { figure: number })[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const drawnBox = (i: number) =>
    page.evaluate((i) => {
      const button = document.querySelector(`button.shelf-figure[data-e2e-figure="${i}"]`)!;
      const r = button.querySelector('.shelf-figure__img, .shelf-figure__silhouette')!.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right };
    }, i);
  const spots: (Spot & { figure: number })[] = [];
  for (let i = 0; i < fp.names.length; i++) {
    const rest = await drawnBox(i);
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `button.shelf-figure[data-e2e-figure="${i}"]`,
    });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const pressed = await drawnBox(i);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    const y = Math.ceil(rest.top);
    if (y >= pressed.top) continue;
    for (let x = Math.ceil(rest.left) + 2; x < Math.floor(rest.right) - 2; x++) {
      if (solid(fp, x, y, EMPTY, 2)) spots.push({ x, y, figure: i });
    }
  }
  await cdp.detach();
  return spots;
}

test('a tap in the band a pressed figure shrinks away from resolves by what is drawn there', async ({ page }) => {
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover-est')!;
  await openCase(page, size, '', 'comfortable');
  const fp = await figurePixels(page);
  const spots = await pressBandSpots(page, fp);
  // The press starts on that figure: its image is the element under the finger.
  const pressedFirst = await page.evaluate(
    (spots) =>
      spots.filter(({ x, y, figure }) => {
        const hit = document.elementFromPoint(x + 0.2, y + 0.2)?.closest<HTMLElement>('button.shelf-figure');
        return hit?.dataset.e2eFigure === String(figure);
      }),
    spots,
  );
  expect(pressedFirst.length, 'a pixel in some figure\'s press band with nothing drawn around it').toBeGreaterThan(0);
  const spot = pressedFirst[Math.floor(pressedFirst.length / 2)];
  await tapOpensNothing(
    page,
    size,
    fp,
    spot,
    `tap at ${spot.x},${spot.y}, in the press band of "${fp.names[spot.figure]}", where no figure is drawn`,
    0.2,
  );
});
