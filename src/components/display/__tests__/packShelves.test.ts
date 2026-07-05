import { describe, it, expect } from 'vitest';
import { packShelves } from '../packShelves';
import { SHELF_BAND } from '../density';
import { FIXTURE_FIGURES, FIXTURE_META } from '../../../dev-fixtures/fixtures';

describe('packShelves', () => {
  it('keeps figure order and includes every figure exactly once', () => {
    const rows = packShelves(FIXTURE_FIGURES, 340, 168);
    const flat = rows.flat();
    expect(flat.map((i) => i.figure._id)).toEqual(FIXTURE_FIGURES.map((f) => f._id));
    expect(flat.map((i) => i.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('never overflows the container width (except single-figure rows)', () => {
    const width = 340;
    const rows = packShelves(FIXTURE_FIGURES, width, 168, 8);
    for (const row of rows) {
      if (row.length === 1) continue;
      const total = row.reduce((sum, i) => sum + i.w, 0) + (row.length - 1) * 8;
      expect(total).toBeLessThanOrEqual(width);
    }
  });

  it('sizes figures from the shared height band: chibi shorter than standing', () => {
    const rows = packShelves(FIXTURE_FIGURES, 2000, 168);
    const flat = rows.flat();
    const rem = flat.find((i) => i.figure._id === 'fx-rem')!;
    const nendo = flat.find((i) => i.figure._id === 'fx-miku-nendo')!;
    expect(rem.h).toBe(168); // relHeight 1.0 fills the band
    expect(nendo.h).toBeLessThan(rem.h); // chibi sits lower in the band
    // natural width variance from native aspect
    expect(rem.w).toBe(Math.round(rem.h * FIXTURE_META['fx-rem'].aspect));
  });

  it('packs more figures per row when the band shrinks (density)', () => {
    const compact = packShelves(FIXTURE_FIGURES, 340, 168);
    const gallery = packShelves(FIXTURE_FIGURES, 340, 126);
    expect(gallery.length).toBeLessThanOrEqual(compact.length);
  });

  it('puts a wider-than-container figure alone on its row', () => {
    const rows = packShelves(FIXTURE_FIGURES, 130, 168);
    for (const row of rows) expect(row.length).toBe(1);
  });

  it('Compact density packs ~3 figures per shelf at a 360px phone viewport', () => {
    // Mirrors CaseShelf's usable-width formula: Math.max(160, width - 48).
    // A realistic-size collection (4x the fixture set) avoids edge effects
    // from a partial trailing shelf skewing the average.
    const usable = Math.max(160, 360 - 48);
    const collection = [...FIXTURE_FIGURES, ...FIXTURE_FIGURES, ...FIXTURE_FIGURES, ...FIXTURE_FIGURES];
    const rows = packShelves(collection, usable, SHELF_BAND.compact);
    const counts = rows.map((r) => r.length);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(avg).toBeGreaterThanOrEqual(2.7);
    // Most shelves should hit 3-across, not just the average.
    expect(counts.filter((c) => c >= 3).length).toBeGreaterThan(counts.filter((c) => c < 3).length);
  });
});
