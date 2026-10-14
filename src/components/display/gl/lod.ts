/**
 * CASE-GL distance LOD and the GPU texture budget. A card's picture is
 * packed at the smallest cell height (a tier) at least as tall as the card
 * draws on screen, in device px; a card too small to show a picture draws
 * a flat placeholder and costs no texels. The pages the cells need are held
 * to the budget (default 48 MB, mip chains included): over it, the arts
 * drawn smallest on screen (the farthest) step down a tier first, and past
 * the smallest tier become placeholders, so the nearest keep their detail.
 */
import { ATLAS_PAD_PX, atlasBytes, packAtlas, type AtlasPack } from './atlas';

/** Cell heights, px, largest first. */
export const LOD_TIERS_PX = [256, 128, 64, 32] as const;
/** A card drawn shorter than this on screen (device px) is a flat placeholder. */
export const PLACEHOLDER_BELOW_PX = 8;
/** The canvas's GPU texture budget, bytes (CASE-GL brief: 48 MB by default, logged). */
export const TEXTURE_BUDGET_BYTES = 48 * 1024 * 1024;
/** Atlas page size, px: a power of two (mipmaps) every WebGL2 GPU takes (its MAX_TEXTURE_SIZE is at least 2048). */
export const ATLAS_PAGE_PX = 1024;

export type Tier = (typeof LOD_TIERS_PX)[number];

/** The tier a card `screenPx` tall needs; null: a placeholder. */
export function tierFor(screenPx: number): Tier | null {
  if (!(screenPx >= PLACEHOLDER_BELOW_PX)) return null;
  let tier: Tier = LOD_TIERS_PX[0];
  for (const t of LOD_TIERS_PX) if (t >= screenPx) tier = t;
  return tier;
}

/** A cell `tier` px tall at `aspect` (width / height), at least 1 px wide, at most `maxW` (scaled down whole). */
export function cellSize(tier: number, aspect: number, maxW: number = ATLAS_PAGE_PX - 2 * ATLAS_PAD_PX): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const w = tier * a;
  if (w > maxW) return { w: Math.floor(maxW), h: Math.max(1, Math.round(maxW / a)) };
  return { w: Math.max(1, Math.round(w)), h: tier };
}

export interface LodRequest {
  /** The art drawn: one cell however many cards draw it. */
  readonly key: string;
  /** Width / height of what the cell holds. */
  readonly aspect: number;
  /** How tall a card of it draws on screen, device px. */
  readonly screenPx: number;
}

export interface AtlasPlan {
  /** Each art's tier; null: a placeholder. */
  readonly tiers: Map<string, Tier | null>;
  readonly pack: AtlasPack;
  readonly bytes: number;
  /** Tier steps taken to fit the budget. */
  readonly downgraded: number;
}

const lower = (t: Tier): Tier | null => {
  const i = LOD_TIERS_PX.indexOf(t);
  return i + 1 < LOD_TIERS_PX.length ? LOD_TIERS_PX[i + 1] : null;
};

/** Fill share a shelf packer reaches on mixed cells: the area estimate's allowance before it packs. */
const FILL = 0.8;

/** The tiers, cells and pages for these requests within `budgetBytes`. */
export function planAtlas(requests: readonly LodRequest[], budgetBytes: number, pageSize: number = ATLAS_PAGE_PX): AtlasPlan {
  // one cell per art, at its largest card
  const arts = new Map<string, { key: string; aspect: number; screenPx: number }>();
  for (const r of requests) {
    const seen = arts.get(r.key);
    if (!seen || r.screenPx > seen.screenPx) arts.set(r.key, { key: r.key, aspect: r.aspect, screenPx: r.screenPx });
  }
  const tiers = new Map<string, Tier | null>();
  for (const a of arts.values()) tiers.set(a.key, tierFor(a.screenPx));
  const maxPages = Math.floor(budgetBytes / atlasBytes(1, pageSize));
  // the farthest first: the order arts step down in
  const byFar = [...arts.values()].sort((a, b) => a.screenPx - b.screenPx || (a.key < b.key ? -1 : 1));
  const area = (key: string) => {
    const t = tiers.get(key);
    if (t == null) return 0;
    const c = cellSize(t, arts.get(key)!.aspect, pageSize - 2 * ATLAS_PAD_PX);
    return (c.w + 2 * ATLAS_PAD_PX) * (c.h + 2 * ATLAS_PAD_PX);
  };
  let downgraded = 0;
  let total = byFar.reduce((sum, a) => sum + area(a.key), 0);
  // over the budget the largest cells go first (the top mip level, as texture streaming drops it), the farthest of
  // them first: a pass steps each art at the largest tier anyone holds down one, until the estimate fits
  const stepDown = (capacity: number): void => {
    while (total > capacity) {
      // over the capacity, some art still holds a cell: the largest tier held is a tier
      const top = Math.max(0, ...byFar.map((a) => tiers.get(a.key) ?? 0));
      for (const a of byFar) {
        if (total <= capacity) return;
        const t = tiers.get(a.key);
        if (t !== top) continue;
        const before = area(a.key);
        tiers.set(a.key, lower(t));
        total += area(a.key) - before;
        downgraded++;
      }
    }
  };
  const cellsNow = () =>
    byFar.flatMap((a) => {
      const t = tiers.get(a.key);
      return t == null ? [] : [{ key: a.key, ...cellSize(t, a.aspect, pageSize - 2 * ATLAS_PAD_PX) }];
    });
  // the area estimate can be short of what the packer reaches: allow less and step on until nothing overflows
  let fill = FILL;
  let pack: AtlasPack;
  for (;;) {
    stepDown(maxPages * pageSize * pageSize * fill);
    pack = packAtlas(cellsNow(), pageSize, maxPages);
    if (pack.overflow.length === 0 || total === 0) break;
    fill *= 0.9;
  }
  return { tiers, pack, bytes: atlasBytes(pack.pages, pageSize), downgraded };
}
