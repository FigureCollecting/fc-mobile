import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { resolveDepthMm, resolveMaxHeightMm } from '../sizeResolution';
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

const META: FigureDisplayMeta = {
  width: 600,
  height: 800,
  aspect: 0.75,
  relHeight: 0.65,
  footprintCenterX: 0.5,
  footprintWidth: 0.7,
  matted: false,
  baseRecovered: false,
};

describe('resolveDepthMm (footprint-depth resolution tree)', () => {
  it('uses the labeled depthMm when present and sane', () => {
    const f = fig({ _id: 'a', dimensions: { depthMm: 140 } });
    const resolved = resolveDepthMm(f, META, 200);
    expect(resolved).toEqual({ depthMm: 140, source: 'labeled' });
  });

  it('estimates depth as ~0.65x the labeled widthMm when depthMm is absent', () => {
    const f = fig({ _id: 'a', dimensions: { widthMm: 200 } });
    const resolved = resolveDepthMm(f, META, 300);
    expect(resolved.source).toBe('width-ratio');
    expect(resolved.depthMm).toBeCloseTo(200 * 0.65, 5);
  });

  it('derives width from pixel aspect x resolved height when widthMm is also absent', () => {
    // aspect 0.75, resolvedHeightMm 300 -> derived width 225 -> depth 225*0.65
    const f = fig({ _id: 'a' });
    const resolved = resolveDepthMm(f, META, 300);
    expect(resolved.source).toBe('width-ratio');
    expect(resolved.depthMm).toBeCloseTo(0.75 * 300 * 0.65, 5);
  });

  it('ignores a zero or negative labeled depthMm and falls through to the width ratio', () => {
    const f = fig({ _id: 'a', dimensions: { depthMm: 0, widthMm: 100 } });
    const resolved = resolveDepthMm(f, META, 200);
    expect(resolved.source).toBe('width-ratio');
    expect(resolved.depthMm).toBeCloseTo(65, 5);
  });

  it('ignores a non-finite labeled depthMm without throwing', () => {
    const f = fig({ _id: 'a', dimensions: { depthMm: Number.NaN, widthMm: 100 } });
    expect(() => resolveDepthMm(f, META, 200)).not.toThrow();
    expect(resolveDepthMm(f, META, 200).depthMm).toBeCloseTo(65, 5);
  });

  it('falls back to a sane constant when width is truly unresolvable (no labeled width, no height to derive one from)', () => {
    const f = fig({ _id: 'a' });
    const resolved = resolveDepthMm(f, META, null);
    expect(resolved.source).toBe('square-fallback');
    expect(resolved.depthMm).toBeGreaterThan(0);
  });

  it('never returns zero, negative, or non-finite depth for any input combination', () => {
    const inputs: Array<[Figure, number | null]> = [
      [fig({ _id: 'a' }), null],
      [fig({ _id: 'b', dimensions: {} }), 0],
      [fig({ _id: 'c', dimensions: { depthMm: -5, widthMm: -10 } }), -100],
    ];
    for (const [f, h] of inputs) {
      const resolved = resolveDepthMm(f, META, h);
      expect(Number.isFinite(resolved.depthMm)).toBe(true);
      expect(resolved.depthMm).toBeGreaterThan(0);
    }
  });

  it('prefers labeled depthMm over a labeled widthMm-derived estimate', () => {
    const f = fig({ _id: 'a', dimensions: { depthMm: 90, widthMm: 500 } });
    expect(resolveDepthMm(f, META, 300).depthMm).toBe(90);
  });
});

describe('resolveMaxHeightMm (shared mm->px scale anchor)', () => {
  it('returns the tallest resolvable heightMm across the set', () => {
    const a = fig({ _id: 'a', dimensions: { heightMm: 470 } });
    const b = fig({ _id: 'b', dimensions: { heightMm: 130 } });
    expect(resolveMaxHeightMm([a, b])).toBe(470);
  });

  it('returns 0 when nothing in the set has a resolvable height', () => {
    const figures = [fig({ _id: 'a' }), fig({ _id: 'b' })];
    expect(resolveMaxHeightMm(figures)).toBe(0);
  });

  it('never throws on an empty figure list', () => {
    expect(() => resolveMaxHeightMm([])).not.toThrow();
    expect(resolveMaxHeightMm([])).toBe(0);
  });
});
