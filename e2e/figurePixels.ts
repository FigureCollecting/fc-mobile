import type { Page } from '@playwright/test';

/**
 * Which figure the user SEES at each CSS pixel of the case view, measured
 * from screenshots only (so it knows nothing about how the app hit-tests):
 * the page with every figure hidden, with all shown, and with each figure
 * shown alone. A pixel belongs to the figure that alone changes it and whose
 * lone render matches the full render there.
 */

export const EMPTY = -1; // no figure drawn at this pixel
export const MIXED = -2; // an edge blend or a pixel that cannot be told apart

export interface FigureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigurePixels {
  width: number;
  height: number;
  /** Accessible name of each figure button, in DOM order. */
  names: string[];
  /** Each figure button's box on screen (its tap rectangle before the fix). */
  boxes: FigureBox[];
  /** Each figure's depth (--fig-z, px; larger is nearer the viewer). */
  z: number[];
  /** Index of the shelf each figure stands on. */
  bay: number[];
  /** Per pixel, row-major: the figure index seen there, EMPTY or MIXED. */
  owner: Int16Array;
  /** Per pixel, row-major: bit i set where figure i, shown alone, draws
   *  (so also where a nearer figure hides it). */
  drawn: Uint32Array;
}

async function nextFrames(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

async function shot(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
}

/** Waits until two screenshots 150 ms apart are identical. */
async function settle(page: Page) {
  let previous = await shot(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const current = await shot(page);
    if (current.equals(previous)) return;
    previous = current;
  }
  throw new Error('the case never settled');
}

/** Hides figures with an adopted sheet (CSP-safe), or clears it with ''. */
async function setFigureCss(page: Page, css: string) {
  await page.evaluate((text) => {
    const w = window as unknown as { __e2eFigureSheet?: CSSStyleSheet };
    if (!w.__e2eFigureSheet) {
      w.__e2eFigureSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, w.__e2eFigureSheet];
    }
    w.__e2eFigureSheet.replaceSync(text);
  }, css);
  await nextFrames(page);
}

export async function figurePixels(page: Page): Promise<FigurePixels> {
  await settle(page);
  const count = await page.locator('button.shelf-figure').count();
  if (count > 32) throw new Error(`figurePixels reads at most 32 figures, not ${count}`);
  const meta = await page.evaluate(() => {
    const bays = Array.from(document.querySelectorAll('.case__bay'));
    return Array.from(document.querySelectorAll<HTMLElement>('button.shelf-figure')).map((button, i) => {
      button.dataset.e2eFigure = String(i);
      const r = button.getBoundingClientRect();
      return {
        name: button.querySelector('.sr-only')?.textContent?.trim() ?? `#${i}`,
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
        z: parseFloat(button.style.getPropertyValue('--fig-z')) || 0,
        bay: bays.indexOf(button.closest('.case__bay') as Element),
      };
    });
  });
  const full = await shot(page);
  await setFigureCss(page, '.shelf-figure{visibility:hidden !important}');
  const empty = await shot(page);
  const alone: Buffer[] = [];
  for (let i = 0; i < meta.length; i++) {
    await setFigureCss(
      page,
      `.shelf-figure{visibility:hidden !important} .shelf-figure[data-e2e-figure="${i}"]{visibility:visible !important}`,
    );
    alone.push(await shot(page));
  }
  await setFigureCss(page, '');
  if (!(await shot(page)).equals(full)) throw new Error('the case changed while it was being measured');

  // Decode in a blank page: the app's CSP does not apply there.
  const decoder = await page.context().newPage();
  try {
    const result = await decoder.evaluate(
      async ({ full, empty, alone, EMPTY, MIXED }) => {
        async function pixels(b64: string) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        }
        const F = await pixels(full);
        const E = await pixels(empty);
        const I = await Promise.all(alone.map(pixels));
        const dist = (a: ImageData, b: ImageData, k: number) =>
          Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
        const owner = new Int16Array(F.width * F.height);
        const drawnBits = new Uint32Array(F.width * F.height);
        for (let p = 0; p < owner.length; p++) {
          const k = p * 4;
          let best = -1;
          let bestD = Infinity;
          I.forEach((img, i) => {
            if (dist(img, E, k) <= 24) return; // figure i alone does not draw here
            drawnBits[p] |= 1 << i;
            const d = dist(F, img, k);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          const drawn = dist(F, E, k);
          if (best < 0) owner[p] = drawn <= 8 ? EMPTY : MIXED;
          else owner[p] = bestD <= 12 && drawn > 24 ? best : MIXED;
        }
        const base64 = (buffer: ArrayBuffer) => {
          let bin = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        };
        return { width: F.width, height: F.height, owner: base64(owner.buffer), drawn: base64(drawnBits.buffer) };
      },
      {
        full: full.toString('base64'),
        empty: empty.toString('base64'),
        alone: alone.map((b) => b.toString('base64')),
        EMPTY,
        MIXED,
      },
    );
    const raw = Buffer.from(result.owner, 'base64');
    const drawnRaw = Buffer.from(result.drawn, 'base64');
    return {
      width: result.width,
      height: result.height,
      names: meta.map((m) => m.name),
      boxes: meta.map((m) => m.box),
      z: meta.map((m) => m.z),
      bay: meta.map((m) => m.bay),
      owner: new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2),
      drawn: new Uint32Array(drawnRaw.buffer.slice(drawnRaw.byteOffset, drawnRaw.byteOffset + drawnRaw.byteLength)),
    };
  } finally {
    await decoder.close();
  }
}

export function ownerAt(fp: FigurePixels, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= fp.width || y >= fp.height) return MIXED;
  return fp.owner[y * fp.width + x];
}

/** True when every pixel within `r` of (x, y) has the given owner. */
export function solid(fp: FigurePixels, x: number, y: number, owner: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (ownerAt(fp, x + dx, y + dy) !== owner) return false;
    }
  }
  return true;
}

export function inBox(box: FigureBox, x: number, y: number, inset = 0): boolean {
  return x >= box.x + inset && x < box.x + box.width - inset && y >= box.y + inset && y < box.y + box.height - inset;
}

/** Figure b is drawn over figure a where their boxes overlap. */
export function inFrontOf(fp: FigurePixels, b: number, a: number): boolean {
  if (fp.bay[a] !== fp.bay[b]) return false;
  return fp.z[b] > fp.z[a] || (fp.z[b] === fp.z[a] && b > a);
}

export interface Spot {
  x: number;
  y: number;
}

/** The largest r <= max for which solid(fp, x, y, owner, r) holds, or -1. */
function solidRadius(fp: FigurePixels, x: number, y: number, owner: number, max: number): number {
  let r = -1;
  while (r < max && solid(fp, x, y, owner, r + 1)) r++;
  return r;
}

/** The pixel in `box` whose neighbourhood is `owner` farthest out (at
 *  least `min`, at most `max` px), nearest the box centre among those. */
function deepestSpot(fp: FigurePixels, box: FigureBox, owner: number, min: number, max: number, inset = 0): Spot | null {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let best: Spot | null = null;
  let bestR = min - 1;
  let bestD = Infinity;
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(fp.height, box.y + box.height); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(fp.width, box.x + box.width); x++) {
      if (ownerAt(fp, x, y) !== owner || !inBox(box, x, y, inset)) continue;
      const r = solidRadius(fp, x, y, owner, max);
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (r > bestR || (r === bestR && d < bestD)) {
        bestR = r;
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** A pixel of figure i deep inside what the user sees of it. */
export function visibleSpot(fp: FigurePixels, i: number): Spot | null {
  return deepestSpot(fp, fp.boxes[i], i, 1, 3);
}

export interface OverlapSpot extends Spot {
  /** The figure the user sees there. */
  seen: number;
  /** The nearer figure whose box covers the spot. */
  front: number;
  /** Distance to the nearest pixel of the nearer figure. */
  edge: number;
}

/**
 * Pixels of a figure the user sees INSIDE the box of a figure standing in
 * front of it (so a box-shaped tap target gives them to the wrong figure),
 * nearest the front figure's own outline first; one per pair of figures.
 */
export function overlapSpots(fp: FigurePixels, r = 3, reach = 12): OverlapSpot[] {
  const bestByPair = new Map<string, OverlapSpot>();
  for (let y = 0; y < fp.height; y++) {
    for (let x = 0; x < fp.width; x++) {
      const seen = ownerAt(fp, x, y);
      if (seen < 0) continue;
      for (let front = 0; front < fp.boxes.length; front++) {
        if (front === seen || !inFrontOf(fp, front, seen) || !inBox(fp.boxes[front], x, y, 2)) continue;
        if (!solid(fp, x, y, seen, r)) continue;
        let edge = Infinity;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            if (ownerAt(fp, x + dx, y + dy) === front) edge = Math.min(edge, Math.hypot(dx, dy));
          }
        }
        const key = `${seen}>${front}`;
        const held = bestByPair.get(key);
        if (!held || edge < held.edge) bestByPair.set(key, { x, y, seen, front, edge });
      }
    }
  }
  return [...bestByPair.values()].sort((a, b) => a.edge - b.edge);
}

export interface OccludingSpot extends Spot {
  /** The nearer figure the user sees there. */
  seen: number;
  /** A figure behind it, drawn at the same pixels. */
  under: number;
  /** How far out every pixel around the spot is still `seen` drawn over `under`. */
  depth: number;
}

/** Whether figure `figure`, shown alone, draws at pixel (x, y). */
function drawnBy(fp: FigurePixels, x: number, y: number, figure: number): boolean {
  if (x < 0 || y < 0 || x >= fp.width || y >= fp.height) return false;
  return (fp.drawn[y * fp.width + x] & (1 << figure)) !== 0;
}

/**
 * Pixels the user sees of a figure standing in front of another figure that
 * is drawn there too, so the tap belongs to the nearer one whatever order
 * the browser lists them in. The deepest spot (at least `r`, at most 4 px)
 * per pair of figures, deepest first.
 */
export function occludingSpots(fp: FigurePixels, r = 1): OccludingSpot[] {
  const best = new Map<string, OccludingSpot>();
  for (let y = 0; y < fp.height; y++) {
    for (let x = 0; x < fp.width; x++) {
      const seen = ownerAt(fp, x, y);
      if (seen < 0) continue;
      for (let under = 0; under < fp.names.length; under++) {
        if (under === seen || !drawnBy(fp, x, y, under) || !inFrontOf(fp, seen, under)) continue;
        let depth = 0;
        while (depth < 4) {
          const d = depth + 1;
          let all = true;
          for (let dy = -d; dy <= d && all; dy++) {
            for (let dx = -d; dx <= d && all; dx++) {
              all = ownerAt(fp, x + dx, y + dy) === seen && drawnBy(fp, x + dx, y + dy, under);
            }
          }
          if (!all) break;
          depth = d;
        }
        if (depth < r) continue;
        const key = `${seen}>${under}`;
        const held = best.get(key);
        if (!held || depth > held.depth) best.set(key, { x, y, seen, under, depth });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.depth - a.depth);
}

/** A pixel inside figure i's box with no figure drawn around it. */
export function emptySpotInBox(fp: FigurePixels, i: number): Spot | null {
  return deepestSpot(fp, fp.boxes[i], EMPTY, 2, 4, 2);
}
