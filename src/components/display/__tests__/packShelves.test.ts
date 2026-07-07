import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { packShelves } from '../packShelves';
import { SHELF_BAND } from '../density';
import { UNMATTED_META } from '../displayMeta';
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

  describe('slotWidth (nameplate footprint — Ross: widen plates to the slot, not the figure)', () => {
    // Three identical unmatted figures give three equal-width items, so the
    // row's leftover space (and hence the space-evenly gap) is exact and
    // predictable to hand-verify.
    const unmatted: Figure[] = ['a', 'b', 'c'].map(
      (id) => ({ _id: id, name: id, manufacturer: '', scale: '', userId: '', createdAt: '', updatedAt: '' }) as Figure,
    );

    it('is always at least as wide as the figure itself', () => {
      const rows = packShelves(FIXTURE_FIGURES, 340, 168);
      for (const item of rows.flat()) {
        expect(item.slotWidth).toBeGreaterThanOrEqual(item.w);
      }
    });

    it('gives edge items half the gap and middle items the full gap either side, with zero leftover', () => {
      const gap = 8;
      const band = 168;
      const w = Math.round(Math.round(UNMATTED_META.relHeight * band) * UNMATTED_META.aspect);
      const usable = w * 3 + gap * 2; // exactly fills the row: no space-evenly slack

      const rows = packShelves(unmatted, usable, band, gap);
      expect(rows).toHaveLength(1);
      const [first, middle, last] = rows[0];

      expect(first.slotWidth).toBe(w + gap / 2);
      expect(middle.slotWidth).toBe(w + gap);
      expect(last.slotWidth).toBe(w + gap / 2);
    });

    it('grows every slot when the row has leftover space to distribute', () => {
      const gap = 8;
      const band = 168;
      const w = Math.round(Math.round(UNMATTED_META.relHeight * band) * UNMATTED_META.aspect);
      const tightUsable = w * 3 + gap * 2;
      const roomyUsable = tightUsable + 60; // extra slack for space-evenly to distribute

      const tight = packShelves(unmatted, tightUsable, band, gap)[0];
      const roomy = packShelves(unmatted, roomyUsable, band, gap)[0];

      for (let i = 0; i < 3; i++) {
        expect(roomy[i].slotWidth).toBeGreaterThan(tight[i].slotWidth);
      }
    });
  });

  describe('getRelHeight override (proportional physical-height sizing)', () => {
    it('defaults to the meta relHeight when no override is passed (unchanged behavior)', () => {
      const withOverride = packShelves(FIXTURE_FIGURES, 2000, 168);
      const withIdentityOverride = packShelves(FIXTURE_FIGURES, 2000, 168, 8, (_f, meta) => meta.relHeight);
      expect(withOverride.flat().map((i) => i.h)).toEqual(withIdentityOverride.flat().map((i) => i.h));
    });

    it('sizes items from the override instead of the meta relHeight when provided', () => {
      const band = 168;
      const rows = packShelves(FIXTURE_FIGURES, 2000, band, 8, () => 0.5);
      for (const item of rows.flat()) {
        expect(item.h).toBe(Math.round(0.5 * band));
      }
    });

    it('passes the figure and its resolved meta through to the override', () => {
      const seen: Array<{ id: string; aspect: number }> = [];
      packShelves(FIXTURE_FIGURES, 2000, 168, 8, (figure, meta) => {
        seen.push({ id: figure._id, aspect: meta.aspect });
        return meta.relHeight;
      });
      expect(seen.map((s) => s.id)).toEqual(FIXTURE_FIGURES.map((f) => f._id));
      expect(seen.find((s) => s.id === 'fx-rem')!.aspect).toBe(FIXTURE_META['fx-rem'].aspect);
    });
  });
});
