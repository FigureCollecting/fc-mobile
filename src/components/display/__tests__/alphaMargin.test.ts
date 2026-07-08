import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import {
  computeBottomMarginFrac,
  useBottomMarginFrac,
  __clearAlphaMarginCache,
  computeContactBand,
  useContactBand,
  __clearContactBandCache,
} from '../alphaMargin';
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

/**
 * Builds a buffer simulating an off-center base: a FULL-WIDTH, centered
 * "body" above the bottom `bandRows` rows, and a NARROWER "base" occupying
 * only [xStart, xEnd) within those bottom rows — mirroring a real figure
 * like Ryuko, whose wide upper body doesn't tell you where her actual
 * ground contact is, only the base/feet do. The measurement must read
 * from the bottom band only, ignoring the wider body above it.
 */
function bufferWithContactBand(width: number, height: number, bandRows: number, xStart: number, xEnd: number): AlphaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  const bandStartRow = height - bandRows;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (y < bandStartRow) {
        data[i + 3] = 255; // full-width body, above the contact band
      } else if (x >= xStart && x < xEnd) {
        data[i + 3] = 255; // narrower, possibly off-center base
      }
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

describe('computeContactBand', () => {
  it('measures the horizontal center of an off-center base, ignoring the wider body above it (Ross: Ryuko)', () => {
    // 100-wide image; base occupies x=[10,30) in the bottom 8 rows, while
    // the "body" above is full-width (0..100) — a 0.5-centered measurement
    // would be wrong here; only the bottom band should count.
    const buf = bufferWithContactBand(100, 100, 8, 10, 30);
    const band = computeContactBand(buf);
    expect(band).not.toBeNull();
    // xEnd is exclusive, so the populated columns are 10..29 — center and
    // width land a half-pixel inside the naive (xStart+xEnd)/2 / (xEnd-xStart).
    expect(band!.centerXFrac).toBeCloseTo(19.5 / 100, 5); // (10+29)/2 / 100
    expect(band!.widthFrac).toBeCloseTo(19 / 100, 5); // (29-10) / 100
  });

  it('measures a centered base as centerXFrac ~0.5 (unchanged from today\'s hand-set default)', () => {
    const buf = bufferWithContactBand(100, 100, 8, 40, 60);
    const band = computeContactBand(buf);
    expect(band!.centerXFrac).toBeCloseTo(49.5 / 100, 5); // (40+59)/2 / 100
  });

  it('only reads the bottom CONTACT BAND, not the single last opaque row (robust to a thin boot tip or stray pixel)', () => {
    // A single wide row way down at the very bottom, but the real (wider)
    // base sits in the band just above it — the band should still capture
    // both, weighted by their actual footprint, not just the thinnest row.
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    // Base band: rows 90..97 (8 rows), x=[20,40).
    for (let y = 90; y < 98; y++) {
      for (let x = 20; x < 40; x++) data[(y * width + x) * 4 + 3] = 255;
    }
    // A single stray opaque pixel at the very last row, far off to the side.
    data[(99 * width + 95) * 4 + 3] = 255;
    const band = computeContactBand({ width, height, data });
    // minX should include the stray pixel (x=95) since it's within the
    // contact row's own band window, widening the measured footprint —
    // this documents the actual (not idealized) behavior rather than
    // asserting a value that assumes stray-pixel immunity it doesn't have.
    expect(band).not.toBeNull();
    expect(band!.widthFrac).toBeGreaterThan(20 / 100);
  });

  it('returns null for a fully transparent image (nothing to measure)', () => {
    const buf: AlphaBuffer = { width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4) };
    expect(computeContactBand(buf)).toBeNull();
  });

  it('never throws on a degenerate zero-size buffer', () => {
    expect(() => computeContactBand({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).not.toThrow();
    expect(computeContactBand({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });

  it('ignores near-zero anti-aliasing alpha noise (threshold, not any-nonzero)', () => {
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    // Faint AA dust across the whole bottom row — should not register as
    // real content, so the "last opaque row" scan skips past it to the
    // real base underneath.
    for (let x = 0; x < width; x++) data[(99 * width + x) * 4 + 3] = 3;
    for (let y = 90; y < 95; y++) {
      for (let x = 30; x < 50; x++) data[(y * width + x) * 4 + 3] = 255;
    }
    const band = computeContactBand({ width, height, data });
    expect(band).not.toBeNull();
    // x=30..49 populated (loop is x < 50) — center is (30+49)/2 / 100.
    expect(band!.centerXFrac).toBeCloseTo(39.5 / 100, 5);
  });
});

describe('useContactBand (canvas-backed, real image measurement)', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  function mockDecode(impl: () => Promise<void>) {
    HTMLImageElement.prototype.decode = vi.fn(impl);
  }

  beforeEach(() => {
    __clearContactBandCache();
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it('returns null synchronously (no flash of a wrong center) before measurement resolves', () => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { result } = renderHook(() => useContactBand('https://example.com/a.png'));
    expect(result.current).toBeNull();
  });

  it('resolves to the measured band once the canvas read succeeds', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithContactBand(100, 100, 8, 10, 30);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);

    const { result } = renderHook(() => useContactBand('https://example.com/measured.png'));
    await waitFor(() => expect(result.current?.centerXFrac).toBeCloseTo(19.5 / 100, 5));
  });

  it('degrades to null (caller falls back to meta fields) instead of throwing when the canvas is tainted / unsupported', async () => {
    mockDecode(() => Promise.resolve());
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException('tainted canvas', 'SecurityError');
      },
    } as unknown as CanvasRenderingContext2D);

    const { result } = renderHook(() => useContactBand('https://example.com/tainted.png'));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('degrades to null when image decode fails (broken URL) instead of throwing', async () => {
    mockDecode(() => Promise.reject(new Error('decode failed')));
    const { result } = renderHook(() => useContactBand('https://example.com/broken.png'));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('returns null for an undefined image URL without measuring anything', () => {
    const { result } = renderHook(() => useContactBand(undefined));
    expect(result.current).toBeNull();
  });

  it('caches by URL so the same figure is measured only once across renders', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithContactBand(100, 100, 8, 40, 60);
    const getImageData = vi.fn(() => buf);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);

    const first = renderHook(() => useContactBand('https://example.com/cached.png'));
    await waitFor(() => expect(first.result.current?.centerXFrac).toBeCloseTo(49.5 / 100, 5));

    renderHook(() => useContactBand('https://example.com/cached.png'));
    expect(getImageData).toHaveBeenCalledTimes(1);
  });
});
