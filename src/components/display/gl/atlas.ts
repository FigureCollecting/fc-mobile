/**
 * CASE-GL texture atlases: every figure picture the canvas draws is a cell
 * on a few square RGBA pages, so the cards of a whole wall bind one texture
 * per page (one draw call each), and the GPU holds the pages, whatever the
 * scene holds. Pure maths: the shelf packer and the byte count.
 *
 * Each cell keeps a gutter of ATLAS_PAD_PX round it, so the smaller mip
 * levels a far card samples never bleed a neighbour's colour into it.
 */

/** The gutter round every cell, px: a cell drawn as small as a quarter of its size samples none of its neighbours. */
export const ATLAS_PAD_PX = 4;

export interface AtlasCell {
  readonly key: string;
  readonly w: number;
  readonly h: number;
}

export interface AtlasPlace {
  readonly key: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasPack {
  readonly pageSize: number;
  /** Pages used. */
  readonly pages: number;
  readonly places: Map<string, AtlasPlace>;
  /** Cells no page had room for, in the order given. */
  readonly overflow: string[];
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

interface Page {
  shelves: Shelf[];
  /** The top of the space no shelf has taken yet. */
  next: number;
}

/**
 * Shelf packing, tallest first: a cell goes on the first shelf of the first
 * page with room for it, else opens a shelf, else a page, up to maxPages.
 */
export function packAtlas(cells: readonly AtlasCell[], pageSize: number, maxPages: number): AtlasPack {
  const places = new Map<string, AtlasPlace>();
  const overflow: string[] = [];
  const pages: Page[] = [];
  const order = cells.map((c, i) => ({ c, i })).sort((a, b) => b.c.h - a.c.h || b.c.w - a.c.w || a.i - b.i);
  const missed = new Set<number>();
  for (const { c, i } of order) {
    const slotW = c.w + 2 * ATLAS_PAD_PX;
    const slotH = c.h + 2 * ATLAS_PAD_PX;
    if (slotW > pageSize || slotH > pageSize) {
      missed.add(i);
      continue;
    }
    let placed = false;
    for (let p = 0; p <= pages.length && p < maxPages && !placed; p++) {
      if (p === pages.length) pages.push({ shelves: [], next: 0 });
      const page = pages[p];
      let shelf = page.shelves.find((s) => s.h >= slotH && s.x + slotW <= pageSize);
      if (!shelf && page.next + slotH <= pageSize) {
        shelf = { y: page.next, h: slotH, x: 0 };
        page.shelves.push(shelf);
        page.next += slotH;
      }
      if (!shelf) continue;
      places.set(c.key, { key: c.key, page: p, x: shelf.x + ATLAS_PAD_PX, y: shelf.y + ATLAS_PAD_PX, w: c.w, h: c.h });
      shelf.x += slotW;
      placed = true;
    }
    if (!placed) missed.add(i);
  }
  cells.forEach((c, i) => {
    if (missed.has(i)) overflow.push(c.key);
  });
  // a page opened and then left empty is not a page
  const used = pages.filter((p) => p.shelves.length > 0).length;
  return { pageSize, pages: used, places, overflow };
}

/** One square RGBA8 texture of `size` px and every mip level under it, bytes. */
export function mipChainBytes(size: number): number {
  let bytes = 0;
  for (let s = size; s >= 1; s = Math.floor(s / 2)) bytes += s * s * 4;
  return bytes;
}

/** What `pages` atlas pages of `pageSize` px cost the GPU, mip chains included. */
export function atlasBytes(pages: number, pageSize: number): number {
  return pages * mipChainBytes(pageSize);
}
