import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { resolveHeightMm } from '../sizeResolution';

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

