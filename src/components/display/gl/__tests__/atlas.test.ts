import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ATLAS_PAD_PX, atlasBytes, mipChainBytes, packAtlas, type AtlasCell } from '../atlas';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('packAtlas', () => {
  it('places every cell on a page, inside it, with the gutter round it, and no two overlap', () => {
    const cells: AtlasCell[] = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, w: 20 + ((i * 37) % 200), h: 32 + ((i * 53) % 224) }));
    const pack = packAtlas(cells, 1024, 8);
    expect(pack.overflow).toEqual([]);
    expect(pack.places.size).toBe(60);
    const all = [...pack.places.values()];
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(ATLAS_PAD_PX);
      expect(p.y).toBeGreaterThanOrEqual(ATLAS_PAD_PX);
      expect(p.x + p.w).toBeLessThanOrEqual(1024 - ATLAS_PAD_PX);
      expect(p.y + p.h).toBeLessThanOrEqual(1024 - ATLAS_PAD_PX);
      expect(p.page).toBeLessThan(pack.pages);
    }
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].page !== all[j].page) continue;
        const grow = (p: (typeof all)[number]) => ({ x: p.x - ATLAS_PAD_PX, y: p.y - ATLAS_PAD_PX, w: p.w + 2 * ATLAS_PAD_PX, h: p.h + 2 * ATLAS_PAD_PX });
        // gutters may touch, cells never reach into another's gutter
        expect(overlaps(grow(all[i]), all[j]), `${all[i].key} vs ${all[j].key}`).toBe(false);
      }
  });

  it('keeps each cell its own size', () => {
    const pack = packAtlas([{ key: 'a', w: 100, h: 50 }], 256, 1);
    expect(pack.places.get('a')).toMatchObject({ w: 100, h: 50, page: 0 });
  });

  it('opens a second page only when the first is full', () => {
    // two to a page: each takes a shelf of its own
    const cells = Array.from({ length: 4 }, (_, i) => ({ key: `k${i}`, w: 200, h: 120 }));
    expect(packAtlas(cells, 256, 4).pages).toBe(2);
    expect(packAtlas(cells.slice(0, 2), 256, 4).pages).toBe(1);
    expect(packAtlas(cells.slice(0, 1), 256, 4).pages).toBe(1);
    expect(packAtlas([], 256, 4).pages).toBe(0);
  });

  it('lists what does not fit in the pages it may use, and a cell larger than a page', () => {
    const cells = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, w: 200, h: 120 }));
    const pack = packAtlas(cells, 256, 1);
    expect(pack.pages).toBe(1);
    expect(pack.places.size).toBe(2);
    expect(pack.overflow).toEqual(['k2', 'k3', 'k4']);
    const most = 256 - 2 * ATLAS_PAD_PX;
    expect(packAtlas([{ key: 'big', w: most + 1, h: 10 }], 256, 1).overflow).toEqual(['big']);
    expect(packAtlas([{ key: 'tall', w: 10, h: most + 1 }], 256, 1).overflow).toEqual(['tall']);
    expect(packAtlas([{ key: 'fits', w: most, h: most }], 256, 1).overflow).toEqual([]);
  });

  it('a property: any cells, never an overlap, never past a page, everything placed or listed', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ w: fc.integer({ min: 1, max: 300 }), h: fc.integer({ min: 1, max: 300 }) }), { maxLength: 40 }), (dims) => {
        const cells = dims.map((d, i) => ({ key: String(i), ...d }));
        const pack = packAtlas(cells, 512, 3);
        expect(pack.places.size + pack.overflow.length).toBe(cells.length);
        const all = [...pack.places.values()];
        for (const p of all) expect(p.x + p.w + ATLAS_PAD_PX).toBeLessThanOrEqual(512);
        for (const p of all) expect(p.y + p.h + ATLAS_PAD_PX).toBeLessThanOrEqual(512);
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++) if (all[i].page === all[j].page) expect(overlaps(all[i], all[j])).toBe(false);
      }),
    );
  });
});

describe('atlas bytes', () => {
  it('counts an RGBA page and its whole mip chain', () => {
    // 4 x 4 x 4 + 2 x 2 x 4 + 1 x 1 x 4
    expect(mipChainBytes(4)).toBe(84);
    expect(mipChainBytes(1)).toBe(4);
    expect(atlasBytes(3, 1024)).toBe(3 * mipChainBytes(1024));
    expect(atlasBytes(0, 1024)).toBe(0);
    // about a third over the base level
    expect(mipChainBytes(1024) / (1024 * 1024 * 4)).toBeCloseTo(4 / 3, 3);
  });
});
