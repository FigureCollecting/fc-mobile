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
    // The fixed tab bar is not part of the case, and on a short screen it
    // covers the lower shelves (where headless Chromium at a pixel ratio of
    // 1 also paints a black band around its + button over the 3D shelves).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.tab-bar { display: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
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

/**
 * Presses and releases a mouse at `spot` (0.2 px into the pixel) without
 * moving, and expects the viewer to open on `name`; returns the class of the
 * element the browser sent the click to.
 */
async function pressOpens(page: Page, size: CaseViewport, fp: FigurePixels, spot: Spot, name: string, why: string) {
  await figuresAt(page, fp);
  await page.evaluate(() => {
    const w = window as unknown as { __e2eClickTarget?: string };
    w.__e2eClickTarget = undefined;
    document.addEventListener('click', (e) => (w.__e2eClickTarget = (e.target as Element).getAttribute('class') ?? ''), {
      capture: true,
      once: true,
    });
  });
  await page.mouse.move(spot.x + 0.2, spot.y + 0.2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(viewer(page, size), `${why}: the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name'), why).toHaveText(name);
  const target = await page.evaluate(() => (window as unknown as { __e2eClickTarget?: string }).__e2eClickTarget);
  await closeViewer(page, size);
  return target;
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

      // Labels alone on a collection taller than the screen: the shelf COUNT
      // stays the same, so only a re-measure of the shelves (not a rebuild
      // for a new count) can move them.
      await page.goto('/?layout=case&motif=detolf-dark&density=compact&fx=12');
      await page.waitForSelector('button.shelf-figure');
      await expect(page.locator('#pre-splash')).toHaveCount(0);
      for (const query of ['compact&fx=12&labels=1', 'compact&fx=12']) {
        await page.getByRole('button', { name: /labels: (off|on)/i }).click();
        await expect(page).toHaveURL(query.endsWith('labels=1') ? /labels=1/ : /^(?!.*labels=1)/);
        inPage[query] = await caseLayout(page);
      }

      for (const [query, layout] of Object.entries(inPage)) {
        expectNoOverlap(layout, `in-page ${query}`);
        await page.goto(`/?layout=case&motif=detolf-dark&density=${query}`);
        await page.waitForSelector('button.shelf-figure');
        expect(layout, `in-page switch to ${query} matches a fresh load`).toEqual(await caseLayout(page));
      }
    });
  });
}

/**
 * Where a nearer figure's box covers part of a figure behind it, a tap
 * belongs to the figure the user sees at that pixel, never to the nearer
 * figure's transparent surroundings. At the measured Fold8 sizes the
 * silhouettes overlap only by a sliver (hence radius 1: a pixel whose 3x3
 * neighbourhood is all the figure behind) and the matted figures not at
 * all, so `slide` moves one figure halfway over its neighbour for a deep
 * overlap. Framed photos fill their whole box.
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
  { label: 'matted, three sets, one figure slid over its neighbour', size: 'fold8-open', density: 'compact', query: '&fx=3', radius: 3, slide: true },
  { label: 'silhouettes, comfortable, three sets', size: 'fold8-open', density: 'comfortable', query: '&fx=3&fxbranch=silhouette', radius: 1 },
  { label: 'matted, one figure slid over its neighbour', size: 'fold8-cover', density: 'compact', query: '', radius: 3, slide: true },
  { label: 'framed photos, compact', size: 'fold8-cover', density: 'compact', query: '&fxbranch=framed' },
  {
    label: 'framed photos, compact, three sets',
    size: 'fold8-open',
    density: 'compact',
    query: '&fx=3&fxbranch=framed',
    occluded: true,
    earlier: true,
    pin: { x: 745, y: 194, seen: 'Nendoroid Hatsune Miku', under: 'Madoka Kaname' },
  },
  {
    label: 'matted, a farther figure later in the page slid under a nearer one',
    size: 'fold8-cover',
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
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
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

/**
 * Pixels of the shelf's front edge (its lip and the flat cap in front of the
 * figures) drawn over the bottom of a figure's frame or silhouette: inside
 * the figure's drawn part, where the user sees the shelf, not the figure.
 * Per figure, the lowest such pixel at its centre (tapped 0.2 px into it,
 * so the click's whole-pixel point stays inside the part), with `rows`
 * hidden rows up to it; most hidden rows first.
 */
async function shelfEdgeSpots(page: Page, fp: FigurePixels): Promise<(Spot & { figure: number; rows: number })[]> {
  const parts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.shelf-figure')).map((button) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const edges = button.closest('.case__bay')!.querySelectorAll('.case__plinth-lip3d, .case__plinth3d');
      return { part: box(button.querySelector('.shelf-figure__frame, .shelf-figure__silhouette')!), edges: Array.from(edges).map(box) };
    }),
  );
  const spots: (Spot & { figure: number; rows: number })[] = [];
  parts.forEach(({ part, edges }, figure) => {
    const x = Math.floor((part.left + part.right) / 2);
    // The lowest pixel whose centre is inside the drawn part.
    const y = Math.ceil(part.bottom - 0.5) - 1;
    const onEdge = edges.some((e) => x + 0.5 > e.left && x + 0.5 < e.right && y + 0.5 > e.top && y + 0.5 < e.bottom);
    if (!onEdge || !solid(fp, x, y, EMPTY, 1)) return;
    let rows = 1;
    while (y - rows > part.top && ownerAt(fp, x, y - rows) === EMPTY) rows++;
    spots.push({ x, y, figure, rows });
  });
  return spots.sort((a, b) => b.rows - a.rows);
}

for (const branch of ['framed', 'silhouette']) {
  test(`a tap on the shelf's front edge over the bottom of a ${branch} figure opens nothing`, async ({ page }) => {
    const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
    await openCase(page, size, `&fxbranch=${branch}`);
    const fp = await figurePixels(page);
    const spots = await shelfEdgeSpots(page, fp);
    expect(spots.length, 'the shelf edge hides the bottom of some figure').toBeGreaterThan(0);
    for (const spot of spots.slice(0, 3)) {
      await tapOpensNothing(
        page,
        size,
        fp,
        spot,
        `tap at ${spot.x},${spot.y} on the shelf edge over the bottom of "${fp.names[spot.figure]}"`,
        0.2,
      );
    }
  });
}

/** Whether the element the browser hits at each spot's pixel centre, `dy` px lower, is the shelf's front edge. */
function edgeUnder(page: Page, spots: Spot[], dy = 0): Promise<boolean[]> {
  return page.evaluate(
    ({ spots, dy }) =>
      spots.map(({ x, y }) => !!document.elementFromPoint(x + 0.5, y + dy + 0.5)?.matches('.case__plinth-lip3d, .case__plinth3d')),
    { spots, dy },
  );
}

/**
 * Pixels of the shelf's front edge (lip or cap) the user sees 0 to 9 px
 * below the bottom of a figure's box, at the figure's centre: no figure is
 * drawn within 1 px, and the edge is the element under the pixel. A real
 * touch lands there, but Chromium's touch adjustment moves the click it
 * sends up onto the figure.
 */
async function edgeBelowSpots(page: Page, fp: FigurePixels): Promise<(Spot & { figure: number; below: number })[]> {
  const candidates: (Spot & { figure: number; below: number })[] = [];
  fp.boxes.forEach((box, figure) => {
    const x = Math.floor(box.x + box.width / 2);
    const bottom = box.y + box.height;
    for (let y = Math.floor(bottom); y <= Math.floor(bottom) + 9; y++) {
      const below = y + 0.5 - bottom;
      if (below >= 0 && solid(fp, x, y, EMPTY, 1)) candidates.push({ x, y, figure, below });
    }
  });
  const onEdge = await edgeUnder(page, candidates);
  return candidates.filter((_, i) => onEdge[i]);
}

/**
 * Per figure, its last visible row right above the shelf's front edge: at
 * the figure's centre, the lowest pixel whose centre the browser hits on the
 * figure's drawn part (for a matted figure, where the user sees its art),
 * with the edge hit 1 or 2 px lower. A frame's drop shadow below it falls on
 * the shelf, not on the figure.
 */
async function lastRowSpots(page: Page, fp: FigurePixels): Promise<(Spot & { figure: number })[]> {
  const parts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.shelf-figure')).map((button) => {
      const part = button.querySelector('.shelf-figure__frame, .shelf-figure__silhouette, .shelf-figure__img')!;
      const r = part.getBoundingClientRect();
      return { matted: part.matches('img'), top: r.top, bottom: r.bottom };
    }),
  );
  const rows: (Spot & { figure: number })[] = [];
  parts.forEach(({ top, bottom }, figure) => {
    const x = Math.floor(fp.boxes[figure].x + fp.boxes[figure].width / 2);
    for (let y = Math.ceil(bottom - 0.5) - 1; y >= Math.max(top, bottom - 12); y--) rows.push({ x, y, figure });
  });
  const hits = await page.evaluate(
    (rows) =>
      rows.map(({ x, y }) => {
        const at = (dy: number) => document.elementFromPoint(x + 0.5, y + dy + 0.5);
        const onEdge = (el: Element | null) => !!el?.matches('.case__plinth-lip3d, .case__plinth3d');
        const button = at(0)?.closest<HTMLElement>('button.shelf-figure');
        return { figure: button ? Number(button.dataset.e2eFigure) : -1, edgeBelow: onEdge(at(1)) || onEdge(at(2)) };
      }),
    rows,
  );
  const spots: (Spot & { figure: number })[] = [];
  const seen = new Set<number>();
  rows.forEach((spot, i) => {
    const { x, y, figure } = spot;
    if (seen.has(figure) || hits[i].figure !== figure) return;
    if (parts[figure].matted && ![x - 1, x, x + 1].every((px) => ownerAt(fp, px, y) === figure)) return;
    seen.add(figure);
    if (hits[i].edgeBelow) spots.push(spot);
  });
  return spots;
}

/**
 * Per figure, its last visible row right above where the shelf's front edge
 * (its cap) is drawn, as the screenshots show it, not as the browser
 * hit-tests it (Chromium hit-tests the cap from about 1 px above its drawn
 * top): in a column of the figure's drawn part (not a frame's drop shadow),
 * the lowest pixel the user sees as the figure, one or two rows above the
 * first row of the drawn cap (`edgeY`); the row right above the cap first,
 * then the column nearest the part's centre.
 */
async function lastVisibleRowSpots(page: Page, fp: FigurePixels): Promise<(Spot & { figure: number; edgeY: number })[]> {
  const parts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.shelf-figure')).map((button) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        part: box(button.querySelector('.shelf-figure__frame, .shelf-figure__silhouette, .shelf-figure__img')!),
        capTop: button.closest('.case__bay')!.querySelector('.case__plinth3d')!.getBoundingClientRect().top,
      };
    }),
  );
  const spots: (Spot & { figure: number; edgeY: number })[] = [];
  parts.forEach(({ part, capTop }, figure) => {
    const edgeY = Math.ceil(capTop);
    const inPart = (y: number) => y + 0.5 > part.top && y + 0.5 < part.bottom;
    // The figure's last visible row in column x, if it is one of the two rows right above the drawn cap.
    const lastRow = (x: number) =>
      [edgeY - 1, edgeY - 2].find(
        (y) => inPart(y) && ownerAt(fp, x, y) === figure && !(inPart(y + 1) && ownerAt(fp, x, y + 1) === figure),
      );
    const centre = (part.left + part.right) / 2;
    const columns: Spot[] = [];
    for (let x = Math.ceil(part.left); x + 1 <= part.right; x++) {
      const y = lastRow(x);
      if (y !== undefined) columns.push({ x, y });
    }
    columns.sort((a, b) => b.y - a.y || Math.abs(a.x + 0.5 - centre) - Math.abs(b.x + 0.5 - centre));
    if (columns.length) spots.push({ ...columns[0], figure, edgeY });
  });
  return spots;
}

/** Touch-taps each spot's pixel centre in turn; none of them may open a viewer. */
async function tapsOpenNothing(page: Page, fp: FigurePixels, spots: Spot[], why: (spot: Spot) => string) {
  await figuresAt(page, fp);
  await page.evaluate(() => {
    const w = window as unknown as { __e2eClicks: number };
    w.__e2eClicks = 0;
    document.addEventListener('click', () => w.__e2eClicks++, { capture: true });
  });
  const opened = page.locator('.figure-viewer-sheet, .detail-pane');
  for (const [n, spot] of spots.entries()) {
    await page.touchscreen.tap(spot.x + 0.5, spot.y + 0.5);
    // The tap's click, then two frames for a viewer to render.
    await page.waitForFunction((n) => (window as unknown as { __e2eClicks: number }).__e2eClicks > n, n);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await opened.count(), why(spot)).toBe(0);
  }
  await page.waitForTimeout(800);
  await expect(opened, 'no viewer opens late').toHaveCount(0);
}

/**
 * Real touches at the phone's own pixel ratio: a touch goes by where the
 * finger landed, not by the point Chromium's touch adjustment moves its
 * click to.
 */
test.describe('touches at the Fold8 pixel ratio', () => {
  test.use({ deviceScaleFactor: 2.8125 });

  for (const size of CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'))) {
    for (const branch of ['matted', 'framed', 'silhouette']) {
      test(`a touch on the shelf's front edge just below a ${branch} figure opens nothing, and one on its last row above the edge opens it, at ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
        test.setTimeout(90_000);
        await openCase(page, size, branch === 'matted' ? '' : `&fxbranch=${branch}`);
        const fp = await figurePixels(page);
        const below = await edgeBelowSpots(page, fp);
        expect(below.length, 'the shelf edge shows just below some figure').toBeGreaterThan(0);
        await tapsOpenNothing(page, fp, below, (spot) => {
          const s = spot as (typeof below)[number];
          return `touch at ${s.x},${s.y}, ${s.below.toFixed(1)} px below the box of "${fp.names[s.figure]}", on the shelf edge`;
        });
        const rows = await lastRowSpots(page, fp);
        expect(rows.length, "some figure's last visible row sits right above the shelf edge").toBeGreaterThan(0);
        for (const s of rows) {
          await tapOpens(page, size, fp, s, fp.names[s.figure], `touch on the last row of "${fp.names[s.figure]}" at ${s.x},${s.y}, right above the shelf edge`);
        }
      });

      test(`a touch on a ${branch} figure's last visible row right above the drawn shelf edge opens it, and one on the drawn edge under it opens nothing, at ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
        test.setTimeout(90_000);
        await openCase(page, size, branch === 'matted' ? '' : `&fxbranch=${branch}`);
        const fp = await figurePixels(page);
        const rows = await lastVisibleRowSpots(page, fp);
        expect(rows.filter((s) => s.y === s.edgeY - 1).length, "some figure's art reaches the row right above the drawn shelf edge").toBeGreaterThan(0);
        for (const s of rows) {
          await tapOpens(page, size, fp, s, fp.names[s.figure], `touch on the last visible row of "${fp.names[s.figure]}" at ${s.x},${s.y}, the shelf edge drawn from row ${s.edgeY}`);
        }
        const edge = rows.map((s) => ({ ...s, y: s.edgeY })).filter((s) => ownerAt(fp, s.x, s.y) === EMPTY);
        expect(edge.length, 'the drawn shelf edge shows right under some of those rows').toBeGreaterThan(0);
        await tapsOpenNothing(page, fp, edge, (spot) => {
          const s = spot as (typeof edge)[number];
          return `touch at ${s.x},${s.y} on the drawn shelf edge right under the last visible row of "${fp.names[s.figure]}"`;
        });
      });
    }
  }
});

/** A pen press at (x, y) through the DevTools protocol, moving to (x, y - up) before it lifts. */
async function penPress(page: Page, x: number, y: number, up = 0) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', at: number, buttons: number) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y: at, button: 'left', buttons, clickCount: 1, pointerType: 'pen' });
  await send('mouseMoved', y, 0);
  await send('mousePressed', y, 1);
  for (let step = 1; step <= 4 && up; step++) await send('mouseMoved', y - (up * step) / 4, 1);
  await send('mouseReleased', y - up, 0);
  await cdp.detach();
}

/** Waits long enough for a viewer to open, and expects none. */
async function opensNothing(page: Page, why: string) {
  await page.waitForTimeout(800);
  await expect(page.locator('.figure-viewer-sheet, .detail-pane'), why).toHaveCount(0);
}

test('a mouse or pen press opens the figure drawn under it and nothing on the shelf edge, and a drag opens nothing', async ({ page }) => {
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size, '&fxbranch=silhouette');
  const fp = await figurePixels(page);
  // A pixel deep inside a figure, and another 20 to 30 px above it that the user also sees of it.
  const drag = fp.names
    .map((_, figure) => {
      const from = visibleSpot(fp, figure);
      const up = from ? [20, 22, 24, 26, 28, 30].find((dy) => solid(fp, from.x, from.y - dy, figure, 1)) : undefined;
      return from && up ? { figure, from, up } : null;
    })
    .find((d) => d !== null);
  expect(drag, 'a figure tall enough to drag across').toBeTruthy();
  const { figure, from, up } = drag!;
  const name = fp.names[figure];
  const [edge] = await edgeBelowSpots(page, fp);
  expect(edge, 'the shelf edge shows just below some figure').toBeTruthy();

  await figuresAt(page, fp);
  await page.mouse.move(from.x + 0.5, from.y + 0.5);
  await page.mouse.down();
  await page.mouse.move(from.x + 0.5, from.y + 0.5 - up, { steps: 5 });
  await page.mouse.up();
  await opensNothing(page, `a mouse drag ${up} px up across "${name}" from ${from.x},${from.y}`);
  await penPress(page, from.x + 0.5, from.y + 0.5, up);
  await opensNothing(page, `a pen drag ${up} px up across "${name}" from ${from.x},${from.y}`);

  await penPress(page, from.x + 0.5, from.y + 0.5);
  await expect(viewer(page, size), `a pen press on "${name}": the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name')).toHaveText(name);
  await closeViewer(page, size);
  await figuresAt(page, fp);
  await penPress(page, edge.x + 0.5, edge.y + 0.5);
  await opensNothing(page, `a pen press at ${edge.x},${edge.y} on the shelf edge`);
  await page.mouse.click(edge.x + 0.5, edge.y + 0.5);
  await opensNothing(page, `a mouse press at ${edge.x},${edge.y} on the shelf edge`);
  await page.mouse.click(from.x + 0.5, from.y + 0.5);
  await expect(viewer(page, size), `a mouse press on "${name}": the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name')).toHaveText(name);
});

/** A pen press through the DevTools protocol that goes down at the first point, moves through the others, and lifts at the last. */
async function penPath(page: Page, points: Spot[]) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', { x, y }: Spot, buttons: number) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' });
  await send('mouseMoved', points[0], 0);
  await send('mousePressed', points[0], 1);
  for (const point of points.slice(1)) await send('mouseMoved', point, 1);
  await send('mouseReleased', points[points.length - 1], 0);
  await cdp.detach();
}

test('a mouse or pen drag that leaves the case and comes back near where it went down opens nothing', async ({ page }) => {
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size, '&fxbranch=silhouette');
  const fp = await figurePixels(page);
  const figure = fp.names.findIndex((_, i) => visibleSpot(fp, i) !== null);
  const from = visibleSpot(fp, figure)!;
  const name = fp.names[figure];
  const start = { x: from.x + 0.5, y: from.y + 0.5 };
  // Up off the case, over the page's header, in one move; and back to 3 px from the start in one more.
  const off = { x: start.x, y: (await page.locator('.case').evaluate((c) => c.getBoundingClientRect().top)) - 60 };
  const back = { x: start.x, y: start.y + 3 };
  expect(off.y, 'the page shows something above the case').toBeGreaterThan(0);

  await figuresAt(page, fp);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(off.x, off.y);
  await page.mouse.move(back.x, back.y);
  await page.mouse.up();
  await opensNothing(page, `a mouse drag from ${from.x},${from.y} on "${name}" off the case to ${off.x},${off.y} and back`);
  await penPath(page, [start, off, back]);
  await opensNothing(page, `a pen drag from ${from.x},${from.y} on "${name}" off the case to ${off.x},${off.y} and back`);

  // The same press without the trip off the case is a tap.
  await penPath(page, [start, back]);
  await expect(viewer(page, size), `a pen press on "${name}" that moved 3 px: the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name')).toHaveText(name);
});

/**
 * Points 0.25 px inside a framed or silhouette figure's drawn part, at the
 * middle of each side, where the browser hits the part at rest but not while
 * the figure is pressed (.shelf-figure:active shrinks it 1.5 % off the
 * point). Chromium makes a mouse or pen press :active before the case's
 * pointerdown handler runs.
 */
async function outlineRingSpots(page: Page): Promise<(Spot & { figure: number; side: string })[]> {
  const atRest = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.shelf-figure')).flatMap((button) => {
      const part = button.querySelector('.shelf-figure__frame, .shelf-figure__silhouette')!;
      const r = part.getBoundingClientRect();
      const midX = (r.left + r.right) / 2;
      const midY = (r.top + r.bottom) / 2;
      return [
        { x: midX, y: r.bottom - 0.25, side: 'bottom' },
        { x: r.left + 0.25, y: midY, side: 'left' },
        { x: r.right - 0.25, y: midY, side: 'right' },
        { x: midX, y: r.top + 0.25, side: 'top' },
      ]
        .filter((p) => document.elementFromPoint(p.x, p.y) === part)
        .map((p) => ({ ...p, figure: Number(button.dataset.e2eFigure) }));
    }),
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const spots: (Spot & { figure: number; side: string })[] = [];
  for (const figure of new Set(atRest.map((s) => s.figure))) {
    const own = atRest.filter((s) => s.figure === figure);
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `button.shelf-figure[data-e2e-figure="${figure}"]`,
    });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const pressed = await page.evaluate(
      (points) =>
        points.map(({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('button.shelf-figure')?.dataset.e2eFigure ?? null),
      own,
    );
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    own.forEach((spot, i) => {
      if (pressed[i] !== String(figure)) spots.push(spot);
    });
  }
  await cdp.detach();
  return spots;
}

test.describe('mouse and pen presses at the Fold8 pixel ratio', () => {
  test.use({ deviceScaleFactor: 2.8125 });

  for (const branch of ['framed', 'silhouette']) {
    test(`a mouse or pen press just inside a ${branch} figure's outline opens it, though the press shrinks the figure off the point`, async ({ page }) => {
      test.setTimeout(150_000);
      const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
      await openCase(page, size, `&fxbranch=${branch}`);
      const fp = await figurePixels(page);
      const spots = await outlineRingSpots(page);
      expect(spots.length, 'a point inside a figure outline that the pressed figure shrinks off').toBeGreaterThan(0);
      for (const s of spots) {
        for (const input of ['mouse', 'pen']) {
          await figuresAt(page, fp);
          if (input === 'mouse') {
            await page.mouse.move(s.x, s.y);
            await page.mouse.down();
            await page.mouse.up();
          } else {
            await penPath(page, [s]);
          }
          const why = `a ${input} press at ${s.x.toFixed(2)},${s.y.toFixed(2)}, 0.25 px inside the ${s.side} of "${fp.names[s.figure]}"`;
          await expect(viewer(page, size), `${why}: the viewer opens`).toBeVisible({ timeout: 3_000 });
          await expect(page.locator('.figure-viewer-sheet__name'), why).toHaveText(fp.names[s.figure]);
          await closeViewer(page, size);
        }
      }
    });
  }
});

test('the keyboard opens the focused figure, even right after a touch on the shelf edge', async ({ page }) => {
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size, '&fxbranch=framed');
  const fp = await figurePixels(page);
  const [edge] = await edgeBelowSpots(page, fp);
  expect(edge, 'the shelf edge shows just below some figure').toBeTruthy();
  await tapsOpenNothing(page, fp, [edge], () => `a touch at ${edge.x},${edge.y} on the shelf edge`);
  const name = fp.names[edge.figure];
  await page.locator(`button.shelf-figure[data-e2e-figure="${edge.figure}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(viewer(page, size), `Enter on the focused "${name}": the viewer opens`).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.figure-viewer-sheet__name')).toHaveText(name);
});

/**
 * Pixels where a press lands on the box of one figure while the user sees
 * another one, and the pressed figure's shrink (.shelf-figure:active) moves
 * its box off the point, so the release lands on the figure seen there: two
 * different elements, and the browser sends the click to their common
 * parent. Each spot is pressed 0.2 px into the pixel.
 */
async function shrinkAwaySpots(page: Page, fp: FigurePixels): Promise<(Spot & { seen: number; pressed: number })[]> {
  const figureAt = (spots: Spot[]) =>
    page.evaluate(
      (spots) =>
        spots.map(({ x, y }) => {
          const button = document.elementFromPoint(x + 0.2, y + 0.2)?.closest<HTMLElement>('button.shelf-figure');
          return button ? Number(button.dataset.e2eFigure) : -1;
        }),
      spots,
    );
  const seenSpots: (Spot & { seen: number })[] = [];
  for (let y = 0; y < fp.height; y++) {
    for (let x = 0; x < fp.width; x++) {
      const seen = ownerAt(fp, x, y);
      if (seen >= 0 && solid(fp, x, y, seen, 1)) seenSpots.push({ x, y, seen });
    }
  }
  const atRest = await figureAt(seenSpots);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const spots: (Spot & { seen: number; pressed: number })[] = [];
  for (let pressed = 0; pressed < fp.names.length; pressed++) {
    const onOther = seenSpots.filter((spot, i) => atRest[i] === pressed && spot.seen !== pressed);
    if (!onOther.length) continue;
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `button.shelf-figure[data-e2e-figure="${pressed}"]`,
    });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const released = await figureAt(onOther);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    onOther.forEach((spot, i) => {
      if (released[i] === spot.seen) spots.push({ ...spot, pressed });
    });
  }
  await cdp.detach();
  return spots;
}

test('a press the pressed figure shrinks away from opens the figure seen there', async ({ page }) => {
  const size = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size);
  await slideNeighbourOver(page);
  const fp = await figurePixels(page);
  const spots = await shrinkAwaySpots(page, fp);
  expect(spots.length, "a pixel of one figure inside the box of a figure in front of it, in that figure's press band").toBeGreaterThan(0);
  const spot = spots[Math.floor(spots.length / 2)];
  const target = await pressOpens(
    page,
    size,
    fp,
    spot,
    fp.names[spot.seen],
    `press at ${spot.x},${spot.y} on "${fp.names[spot.seen]}", in the box of "${fp.names[spot.pressed]}" that shrinks away when pressed`,
  );
  expect(target, 'the browser sends such a click to the shelf row').toBe('case__row');
});
