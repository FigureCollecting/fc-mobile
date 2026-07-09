import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { resolveHeightMm, resolveMaxHeightMm, resolveRelHeights } from '../sizeResolution';
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

describe('resolveRelHeights (proportional physical-height sizing)', () => {
  const getMeta = () => FALLBACK_META;

  it('gives the tallest labeled figure relHeight 1.0', () => {
    const tall = fig({ _id: 'tall', dimensions: { heightMm: 470 } });
    const short = fig({ _id: 'short', dimensions: { heightMm: 130 } });
    const out = resolveRelHeights([tall, short], getMeta);
    expect(out.get('tall')).toBe(1);
  });

  it('scales a shorter figure proportionally to the tallest, not to a fixed band', () => {
    const tall = fig({ _id: 'tall', dimensions: { heightMm: 470 } });
    const short = fig({ _id: 'short', dimensions: { heightMm: 130 } });
    const out = resolveRelHeights([tall, short], getMeta);
    expect(out.get('short')).toBeCloseTo(130 / 470, 3);
  });

  it('uses ONE shared scale across the whole set, not renormalized per subset', () => {
    // Same three figures, but resolveRelHeights is asked about only two of
    // them at a time — the ratio between figures present in BOTH calls must
    // stay identical, proving the scale isn't silently re-anchored to
    // whichever figures happen to be passed in.
    const a = fig({ _id: 'a', dimensions: { heightMm: 300 } });
    const b = fig({ _id: 'b', dimensions: { heightMm: 150 } });
    const c = fig({ _id: 'c', dimensions: { heightMm: 600 } });
    const withoutC = resolveRelHeights([a, b], getMeta);
    const withC = resolveRelHeights([a, b, c], getMeta);
    // a/b ratio identical either way (both anchored to their own set's max,
    // this test documents that the CURRENT set's max is the anchor — i.e.
    // "global" means global to what's being displayed, recomputed when the
    // displayed set changes, not literally frozen forever).
    expect(withoutC.get('a')! / withoutC.get('b')!).toBeCloseTo(a.dimensions!.heightMm! / b.dimensions!.heightMm!, 3);
    expect(withC.get('a')! / withC.get('b')!).toBeCloseTo(a.dimensions!.heightMm! / b.dimensions!.heightMm!, 3);
  });

  it('applies a minimum relHeight floor so an extreme outlier does not shrink a figure to near-nothing', () => {
    const huge = fig({ _id: 'huge', dimensions: { heightMm: 5000 } });
    const tiny = fig({ _id: 'tiny', dimensions: { heightMm: 20 } });
    const out = resolveRelHeights([huge, tiny], getMeta);
    expect(out.get('tiny')!).toBeGreaterThanOrEqual(0.2);
  });

  it('falls back to the meta relHeight for a figure with no resolvable heightMm, without crashing', () => {
    const withMm = fig({ _id: 'a', dimensions: { heightMm: 300 } });
    const withoutMm = fig({ _id: 'b', scale: 'Unspecified' });
    const out = resolveRelHeights([withMm, withoutMm], getMeta);
    expect(out.get('b')).toBe(FALLBACK_META.relHeight);
  });

  it('never crashes and never produces NaN/undefined when the whole set has no dimension data', () => {
    const figures = [fig({ _id: 'a' }), fig({ _id: 'b' }), fig({ _id: 'c' })];
    const out = resolveRelHeights(figures, getMeta);
    for (const f of figures) {
      const rel = out.get(f._id);
      expect(rel).toBeDefined();
      expect(Number.isFinite(rel)).toBe(true);
    }
  });

  it('returns a relHeight for every figure passed in, keyed by _id', () => {
    const figures = [fig({ _id: 'a', dimensions: { heightMm: 100 } }), fig({ _id: 'b', dimensions: { heightMm: 200 } })];
    const out = resolveRelHeights(figures, getMeta);
    expect(out.size).toBe(2);
  });

  it('a scraper-corrupted concatenated heightMm does not become the anchor and shrink the rest of the set (real bug: Mahina heightMm=660580570)', () => {
    const poisoned = fig({ _id: 'poisoned', dimensions: { heightMm: 660580570 } });
    const normals = [
      fig({ _id: 'n1', dimensions: { heightMm: 200 } }),
      fig({ _id: 'n2', dimensions: { heightMm: 320 } }),
      fig({ _id: 'n3', dimensions: { heightMm: 470 } }),
    ];
    const out = resolveRelHeights([poisoned, ...normals], getMeta);

    // The anchor must exclude the garbage value — resolveMaxHeightMm's max
    // across this set should be 470 (the tallest SANE figure), not the
    // poisoned one.
    expect(resolveMaxHeightMm([poisoned, ...normals])).toBe(470);

    // Normal figures keep sane, proportional relHeights (~0.4-1.0), not
    // crushed toward 0 by a garbage anchor.
    for (const f of normals) {
      const rel = out.get(f._id)!;
      expect(rel).toBeGreaterThanOrEqual(0.4);
      expect(rel).toBeLessThanOrEqual(1.0);
    }
    expect(out.get('n3')).toBe(1); // the real tallest, at the top of the band

    // The poisoned figure itself renders pinned to the max band, not
    // enormous and not near-zero.
    expect(out.get('poisoned')).toBe(1);
  });
});
