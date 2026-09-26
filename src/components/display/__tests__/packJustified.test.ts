import { describe, it, expect } from 'vitest';
import { packJustified } from '../packJustified';
import { FIXTURE_FIGURES, FIXTURE_META } from '../../../dev-fixtures/fixtures';

describe('packJustified', () => {
  it('fills every full row edge-to-edge within a pixel of the container', () => {
    const width = 360;
    const rows = packJustified(FIXTURE_FIGURES, width, 132, 2);
    for (const row of rows.slice(0, -1)) {
      const total = row.items.reduce((s, i) => s + i.w, 0) + (row.items.length - 1) * 2;
      expect(Math.abs(total - width)).toBeLessThanOrEqual(row.items.length + 1); // rounding slack
    }
  });

  it('keeps native aspect: width tracks aspect at the row height', () => {
    const rows = packJustified(FIXTURE_FIGURES, 360, 132, 2);
    for (const row of rows) {
      for (const item of row.items) {
        const aspect = FIXTURE_META[item.figure._id].aspect;
        expect(item.w).toBeCloseTo(aspect * row.height, 0);
      }
    }
  });

  it('does not stretch the last row above the base height', () => {
    const rows = packJustified(FIXTURE_FIGURES.slice(0, 1), 360, 132, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBeLessThanOrEqual(132);
  });

  it('includes every figure once, in order', () => {
    const rows = packJustified(FIXTURE_FIGURES, 360, 132, 2);
    const ids = rows.flatMap((r) => r.items.map((i) => i.figure._id));
    expect(ids).toEqual(FIXTURE_FIGURES.map((f) => f._id));
  });
});
