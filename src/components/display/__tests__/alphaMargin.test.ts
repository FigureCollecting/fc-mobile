import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { computeBottomMarginFrac, useBottomMarginFrac, __clearAlphaMarginCache } from '../alphaMargin';
import type { AlphaBuffer } from '../alphaMargin';

/** Builds a synthetic RGBA buffer: fully opaque above `opaqueUntilRow`
 *  (exclusive), fully transparent from there to the bottom. */
function bufferWithBottomMargin(width: number, height: number, opaqueUntilRow: number): AlphaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < opaqueUntilRow; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i + 3] = 255; // opaque
    }
  }
  return { width, height, data };
}

describe('computeBottomMarginFrac', () => {
  it('returns 0 when content extends to the very last row', () => {
    const buf = bufferWithBottomMargin(10, 100, 100);
    expect(computeBottomMarginFrac(buf)).toBe(0);
  });

  it('returns the exact fraction of transparent rows below the last opaque row', () => {
    // Opaque rows 0..77 (78 rows), transparent 78..99 (22 rows) of 100.
    const buf = bufferWithBottomMargin(10, 100, 78);
    expect(computeBottomMarginFrac(buf)).toBeCloseTo(22 / 100, 5);
  });

  it('matches real measured figures from the case-depth-study (madoka: 41/712)', () => {
    const buf = bufferWithBottomMargin(10, 712, 712 - 41);
    expect(computeBottomMarginFrac(buf)).toBeCloseTo(41 / 712, 3);
  });

  it('ignores near-zero anti-aliasing alpha noise (threshold, not any-nonzero)', () => {
    const width = 10;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4);
    // Fully opaque top half.
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = 255;
    }
    // Faint AA dust in the bottom half — should NOT count as "content".
    for (let y = 20; y < 50; y++) {
      for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = 3;
    }
    expect(computeBottomMarginFrac({ width, height, data })).toBeCloseTo(30 / 50, 5);
  });

  it('returns 0 for a fully transparent image rather than a bogus 100% margin', () => {
    const buf: AlphaBuffer = { width: 10, height: 40, data: new Uint8ClampedArray(10 * 40 * 4) };
    expect(computeBottomMarginFrac(buf)).toBe(0);
  });

  it('never throws on a degenerate zero-size buffer', () => {
    expect(() => computeBottomMarginFrac({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).not.toThrow();
    expect(computeBottomMarginFrac({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBe(0);
  });
});

describe('useBottomMarginFrac (canvas-backed, real image measurement)', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  // jsdom doesn't implement HTMLImageElement#decode at all (no property to
  // spy on), so it's assigned directly and torn down manually rather than
  // via vi.spyOn/mockRestore.
  function mockDecode(impl: () => Promise<void>) {
    HTMLImageElement.prototype.decode = vi.fn(impl);
  }

  beforeEach(() => {
    __clearAlphaMarginCache();
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it('returns 0 synchronously (no flash of huge margin) before measurement resolves', () => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { result } = renderHook(() => useBottomMarginFrac('https://example.com/a.png'));
    expect(result.current).toBe(0);
  });

  it('resolves to the measured margin once the canvas read succeeds', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithBottomMargin(10, 100, 78);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);

    const { result } = renderHook(() => useBottomMarginFrac('https://example.com/measured.png'));
    await waitFor(() => expect(result.current).toBeCloseTo(22 / 100, 5));
  });

  it('degrades to 0 (no correction) instead of throwing when the canvas is tainted / unsupported', async () => {
    mockDecode(() => Promise.resolve());
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException('tainted canvas', 'SecurityError');
      },
    } as unknown as CanvasRenderingContext2D);

    const { result } = renderHook(() => useBottomMarginFrac('https://example.com/tainted.png'));
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('degrades to 0 when image decode fails (broken URL) instead of throwing', async () => {
    mockDecode(() => Promise.reject(new Error('decode failed')));
    const { result } = renderHook(() => useBottomMarginFrac('https://example.com/broken.png'));
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('returns 0 for an undefined image URL without measuring anything', () => {
    const { result } = renderHook(() => useBottomMarginFrac(undefined));
    expect(result.current).toBe(0);
  });

  it('caches by URL so the same figure is measured only once across renders', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 40, configurable: true });
    const buf = bufferWithBottomMargin(10, 40, 36);
    const getImageData = vi.fn(() => buf);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);

    const first = renderHook(() => useBottomMarginFrac('https://example.com/cached.png'));
    await waitFor(() => expect(first.result.current).toBeCloseTo(4 / 40, 5));

    renderHook(() => useBottomMarginFrac('https://example.com/cached.png'));
    // Second mount for the same URL should hit the cache, not re-measure.
    expect(getImageData).toHaveBeenCalledTimes(1);
  });
});
