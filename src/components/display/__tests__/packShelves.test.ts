import { describe, it, expect } from 'vitest';
import { packShelves } from '../packShelves';
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
});
