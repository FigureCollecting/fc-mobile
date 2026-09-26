import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { resolveHeightMm, resolveRelHeights } from '../sizeResolution';
import type { FigureDisplayMeta } from '../displayMeta';

function fig(overrides: Partial<Figure> & { _id: string }): Figure {
  return {
    name: overrides._id,
    manufacturer: '',
    scale: '',
    userId: 'u1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as Figure;
}

const FALLBACK_META: FigureDisplayMeta = {
  width: 600,
  height: 800,
  aspect: 0.75,
  relHeight: 0.65,
  footprintCenterX: 0.5,
  footprintWidth: 0.7,
  matted: false,
  baseRecovered: false,
};

describe('resolveHeightMm (size resolution tree)', () => {
  it('uses the labeled heightMm when present and sane', () => {
    const f = fig({ _id: 'a', dimensions: { heightMm: 240 } });
    expect(resolveHeightMm(f)).toEqual({ heightMm: 240, source: 'labeled' });
  });

  it('estimates from scale x nominal 1600mm when heightMm is absent', () => {
    const f = fig({ _id: 'a', scale: '1/8' });
    const resolved = resolveHeightMm(f);
    expect(resolved).not.toBeNull();
    expect(resolved!.heightMm).toBeCloseTo(200, 5); // 1600 / 8
    expect(resolved!.source).toBe('scale-estimate');
  });

  it('parses scale strings with surrounding whitespace', () => {
    const f = fig({ _id: 'a', scale: ' 1 / 7 ' });
    expect(resolveHeightMm(f)!.heightMm).toBeCloseTo(1600 / 7, 5);
  });

  it('returns null when neither heightMm nor a parseable scale is available', () => {
    const f = fig({ _id: 'a', scale: '' });
    expect(resolveHeightMm(f)).toBeNull();
  });

  it('returns null for a non-fraction scale string (never crashes)', () => {
    const f = fig({ _id: 'a', scale: 'Unspecified' });
    expect(resolveHeightMm(f)).toBeNull();
  });

  it('ignores a zero or negative labeled heightMm and falls through to scale', () => {
    const f = fig({ _id: 'a', dimensions: { heightMm: 0 }, scale: '1/7' });
    expect(resolveHeightMm(f)!.source).toBe('scale-estimate');
  });

  it('ignores a non-finite labeled heightMm without throwing', () => {
    const f = fig({ _id: 'a', dimensions: { heightMm: Number.NaN } });
    expect(() => resolveHeightMm(f)).not.toThrow();
    expect(resolveHeightMm(f)).toBeNull();
  });
});

describe('resolveRelHeights (case-anchored physical-height sizing)', () => {
  const getMeta = () => FALLBACK_META;
  // Mirrors CaseShelf's own DEFAULT_DYNAMIC_COMPARTMENT_MM value — kept as
  // a local constant here (rather than importing across the display/CaseShelf
  // boundary from a sizeResolution test) since the exact number is
  // arbitrary for these tests; what's under test is the ANCHORING BEHAVIOR
  // (case-anchored, not figure-anchored), not any particular mm value.
  const ANCHOR_MM = 470;

  it('gives a figure exactly the anchor height a relHeight of 1.0', () => {
    const f = fig({ _id: 'a', dimensions: { heightMm: ANCHOR_MM } });
    const out = resolveRelHeights([f], getMeta, ANCHOR_MM);
    expect(out.get('a')).toBe(1);
  });

  it('scales a figure proportionally to the anchor (compartment), not to other figures in the set', () => {
    const short = fig({ _id: 'short', dimensions: { heightMm: 130 } });
    const out = resolveRelHeights([short], getMeta, ANCHOR_MM);
    expect(out.get('short')).toBeCloseTo(130 / ANCHOR_MM, 3);
  });

  it('lets a figure taller than the anchor OVERFLOW past 1.0, not clamp to fit', () => {
    // A real, plausible figure (700mm) taller than the compartment — this
    // is the "won't fit"/overflow case Ross wants VISIBLE, not silently
    // resized to look like it fits.
    const tall = fig({ _id: 'tall', dimensions: { heightMm: 700 } });
    const out = resolveRelHeights([tall], getMeta, ANCHOR_MM);
    expect(out.get('tall')).toBeCloseTo(700 / ANCHOR_MM, 3);
    expect(out.get('tall')!).toBeGreaterThan(1);
  });

  it('a figure\'s relHeight is identical regardless of what else is in the set — CASE-anchored, not figure-anchored', () => {
    // Same figures, resolveRelHeights asked about only two of them at a
    // time — 'a' and 'b' must get the EXACT SAME relHeight in both calls
    // (not just the same ratio, the literal same value), proving the
    // anchor comes entirely from outside the figure set, unlike the old
    // figure-anchored design where adding 'c' could shift the whole scale.
    const a = fig({ _id: 'a', dimensions: { heightMm: 300 } });
    const b = fig({ _id: 'b', dimensions: { heightMm: 150 } });
    const c = fig({ _id: 'c', dimensions: { heightMm: 5000 } }); // even a huge addition
    const withoutC = resolveRelHeights([a, b], getMeta, ANCHOR_MM);
    const withC = resolveRelHeights([a, b, c], getMeta, ANCHOR_MM);
    expect(withC.get('a')).toBe(withoutC.get('a'));
    expect(withC.get('b')).toBe(withoutC.get('b'));
  });

  it('applies a minimum relHeight floor so a very short figure never shrinks to near-nothing', () => {
    const tiny = fig({ _id: 'tiny', dimensions: { heightMm: 20 } });
    const out = resolveRelHeights([tiny], getMeta, ANCHOR_MM);
    // 20/470 would be ~0.043 unfloored — the floor must lift it.
    expect(out.get('tiny')!).toBeGreaterThanOrEqual(0.25);
  });

  it('falls back to the meta relHeight for a figure with no resolvable heightMm, without crashing', () => {
    const withMm = fig({ _id: 'a', dimensions: { heightMm: 300 } });
    const withoutMm = fig({ _id: 'b', scale: 'Unspecified' });
    const out = resolveRelHeights([withMm, withoutMm], getMeta, ANCHOR_MM);
    expect(out.get('b')).toBe(FALLBACK_META.relHeight);
  });

  it('never crashes and never produces NaN/undefined when the whole set has no dimension data', () => {
    const figures = [fig({ _id: 'a' }), fig({ _id: 'b' }), fig({ _id: 'c' })];
    const out = resolveRelHeights(figures, getMeta, ANCHOR_MM);
    for (const f of figures) {
      const rel = out.get(f._id);
      expect(rel).toBeDefined();
      expect(Number.isFinite(rel)).toBe(true);
    }
  });

  it('returns a relHeight for every figure passed in, keyed by _id', () => {
    const figures = [fig({ _id: 'a', dimensions: { heightMm: 100 } }), fig({ _id: 'b', dimensions: { heightMm: 200 } })];
    const out = resolveRelHeights(figures, getMeta, ANCHOR_MM);
    expect(out.size).toBe(2);
  });

  it('never crashes and falls back to the meta default when the anchor itself is zero/invalid', () => {
    const f = fig({ _id: 'a', dimensions: { heightMm: 300 } });
    const out = resolveRelHeights([f], getMeta, 0);
    expect(out.get('a')).toBe(FALLBACK_META.relHeight);
  });

  it('a scraper-corrupted concatenated heightMm renders GARGANTUAN, not clamped-to-fit, and does not shrink its neighbors (real bug: Mahina heightMm=660580570)', () => {
    const poisoned = fig({ _id: 'poisoned', dimensions: { heightMm: 660580570 } });
    const normals = [
      fig({ _id: 'n1', dimensions: { heightMm: 200 } }),
      fig({ _id: 'n2', dimensions: { heightMm: 320 } }),
      fig({ _id: 'n3', dimensions: { heightMm: 470 } }),
    ];
    const withoutPoison = resolveRelHeights(normals, getMeta, ANCHOR_MM);
    const withPoison = resolveRelHeights([poisoned, ...normals], getMeta, ANCHOR_MM);

    // Neighbors are completely unaffected by the poisoned figure's presence
    // — each gets its own heightMm/ANCHOR_MM ratio, identical with or
    // without the poisoned figure in the set.
    for (const f of normals) {
      expect(withPoison.get(f._id)).toBe(withoutPoison.get(f._id));
      expect(withPoison.get(f._id)).toBeCloseTo(f.dimensions!.heightMm! / ANCHOR_MM, 3);
    }

    // The poisoned figure itself renders GARGANTUAN (clamped only by the
    // MAX_PLAUSIBLE_HEIGHT_MM=2500 secondary safety net, not to 1.0) —
    // visibly overflowing, not quietly resized to fit.
    const poisonedRel = withPoison.get('poisoned')!;
    expect(poisonedRel).toBeCloseTo(2500 / ANCHOR_MM, 3);
    expect(poisonedRel).toBeGreaterThan(5);
  });
});
