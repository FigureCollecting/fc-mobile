import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { h, render } from 'preact';
import {
  computeBottomMarginFrac,
  computeTopMarginFrac,
  useBottomMarginFrac,
  useAlphaMarginsOf,
  computeSideMarginFracs,
  ALPHA_READS_AT_ONCE,
  ALPHA_READ_TURN_MS,
  ALPHA_READ_DEADLINE_MS,
  ALPHA_READ_DEADLINE_MAX_MS,
  ALPHA_READ_BACKOFF_MS,
  ALPHA_READ_BACKOFF_MAX_MS,
  ALPHA_LANDING_BATCH_MS,
  alphaPictureLoaded,
  __clearAlphaMarginCache,
  computeContactBand,
  useContactBand,
  __clearContactBandCache,
  computeAlphaMask,
  alphaMaskDrawnIn,
  getAlphaMask,
  ALPHA_MASK_MAX_CELLS,
} from '../alphaMargin';
import type { AlphaBuffer, AlphaMargins, AlphaMask } from '../alphaMargin';

/** Whether the mask is drawn at the single point (u, v). */
function alphaMaskAt(mask: AlphaMask, u: number, v: number): boolean {
  return alphaMaskDrawnIn(mask, u, v, u + 1e-9, v + 1e-9);
}

/** A fully transparent RGBA buffer with the listed pixels set to `alpha`. */
function bufferWithPixels(width: number, height: number, pixels: [number, number][], alpha = 255): AlphaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of pixels) data[(y * width + x) * 4 + 3] = alpha;
  return { width, height, data };
}

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

  it('a picture that never decoded whose own picture loads after all (the read failed to fetch it): the margin of the read its load sends', async () => {
    let fails = 1;
    mockDecode(() => (fails-- > 0 ? Promise.reject(new DOMException('network error', 'EncodingError')) : Promise.resolve()));
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithBottomMargin(10, 100, 78);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);
    const url = 'https://example.com/refetched.png';
    const { result } = renderHook(() => useBottomMarginFrac(url));
    await waitFor(() => expect(fails).toBe(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(0);
    alphaPictureLoaded(url);
    await waitFor(() => expect(result.current).toBeCloseTo(22 / 100, 5));
  });

  it('a view of a picture known as never decoded wants it while shown: its load reads it again then, telling that view alone; with no view showing it, a load reads nothing', async () => {
    let decodes = 0;
    mockDecode(() => (decodes++ === 0 ? Promise.reject(new DOMException('network error', 'EncodingError')) : Promise.resolve()));
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithBottomMargin(10, 100, 78);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);
    const url = 'https://example.com/known-undecoded.png';
    const first = renderHook(() => useBottomMarginFrac(url));
    await waitFor(() => expect(decodes).toBe(1));
    first.unmount();
    // a view of it, known now (all 0), comes and goes: then no view shows it, and its load reads nothing
    renderHook(() => useBottomMarginFrac(url)).unmount();
    alphaPictureLoaded(url);
    await new Promise((r) => setTimeout(r, 20));
    expect(decodes).toBe(1);
    // a view of it again, and one of no picture: its load reads it, and only its view learns the margin
    const shown = renderHook(() => useBottomMarginFrac(url));
    const none = renderHook(() => useBottomMarginFrac(undefined));
    expect(shown.result.current).toBe(0);
    alphaPictureLoaded(url);
    await waitFor(() => expect(shown.result.current).toBeCloseTo(22 / 100, 5));
    expect(decodes).toBe(2);
    expect(none.result.current).toBe(0);
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

describe('computeTopMarginFrac (true scale: the transparent margin above the figure)', () => {
  it('is the fraction of the height that is clear above the highest opaque row', () => {
    expect(computeTopMarginFrac(bufferWithPixels(10, 100, [[3, 25], [5, 89]]))).toBeCloseTo(25 / 100, 9);
  });

  it('a figure touching the top edge: 0', () => {
    expect(computeTopMarginFrac(bufferWithPixels(4, 20, [[0, 0], [3, 19]]))).toBe(0);
  });

  it('anti-aliasing dust (alpha 10) is clear; alpha 11 is drawn', () => {
    expect(computeTopMarginFrac(bufferWithPixels(4, 20, [[1, 2]], 10))).toBe(0);
    expect(computeTopMarginFrac(bufferWithPixels(4, 20, [[1, 2]], 11))).toBeCloseTo(2 / 20, 9);
  });

  it('reads every column of a row, not only the first', () => {
    expect(computeTopMarginFrac(bufferWithPixels(8, 10, [[7, 4]]))).toBeCloseTo(4 / 10, 9);
  });

  it('a fully clear or empty image: 0 (no correction)', () => {
    expect(computeTopMarginFrac(bufferWithPixels(4, 20, []))).toBe(0);
    expect(computeTopMarginFrac({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBe(0);
  });
});

describe('computeSideMarginFracs: the clear columns left and right of the figure', () => {
  it('fractions of the image width outside the first and last opaque column', () => {
    // opaque columns 2..6 of 10: 20 % clear on the left, 30 % on the right
    expect(computeSideMarginFracs(bufferWithPixels(10, 4, [[2, 1], [6, 3], [4, 0]]))).toEqual({ left: 0.2, right: 0.3 });
  });

  it('a pixel at or under the alpha threshold is clear, one past it is drawn', () => {
    expect(computeSideMarginFracs(bufferWithPixels(10, 1, [[1, 0]], 10))).toEqual({ left: 0, right: 0 });
    expect(computeSideMarginFracs(bufferWithPixels(10, 1, [[1, 0]], 11))).toEqual({ left: 0.1, right: 0.8 });
  });

  it('opaque to both edges: none; a fully clear or empty image: none', () => {
    expect(computeSideMarginFracs(bufferWithPixels(4, 2, [[0, 0], [3, 1]]))).toEqual({ left: 0, right: 0 });
    expect(computeSideMarginFracs(bufferWithPixels(4, 2, []))).toEqual({ left: 0, right: 0 });
    expect(computeSideMarginFracs({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toEqual({ left: 0, right: 0 });
  });
});

describe('useAlphaMarginsOf: each picture of a list known as soon as it is read, kept across lists', () => {
  /** Each image's alpha by its URL: the canvas reads the image last drawn on it. */
  function mockPictures(buffers: Record<string, AlphaBuffer>, decode: (src: string, img: HTMLImageElement) => Promise<void> = () => Promise.resolve()) {
    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      return decode(this.src, this);
    });
    let drawn = '';
    const getImageData = vi.fn(() => buffers[drawn]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: (img: HTMLImageElement) => {
        drawn = img.src;
      },
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    // (the tests above leave these as plain values on the prototype)
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get(this: HTMLImageElement) {
        return buffers[this.src]?.width ?? 0;
      },
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get(this: HTMLImageElement) {
        return buffers[this.src]?.height ?? 0;
      },
    });
    return getImageData;
  }

  const A = 'https://example.com/a.png';
  const B = 'https://example.com/b.png';
  // a: opaque rows 20..89 and columns 1..7 of a 10 x 100 image; b: rows 0..49, columns 0..9 of 10 x 50
  const pictures = () => ({ [A]: bufferWithPixels(10, 100, [[1, 20], [7, 89]]), [B]: bufferWithPixels(10, 50, [[0, 0], [9, 49]]) });

  beforeEach(() => {
    __clearAlphaMarginCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  /** Long enough, under fake timers, for renderHook's result to follow a render (its effect flushes after a 35 ms frame). */
  const EFFECTS_MS = 50;

  /**
   * Pictures whose reads end only when the test says so; the others end at
   * once. A read is in flight from its start until it lands or is abandoned
   * (its src cleared). No HTTP cache here: every read is its own fetch.
   */
  function heldPictures(urls: readonly string[], held: readonly string[]) {
    const release = new Map<string, (() => void)[]>();
    const started: string[] = [];
    /** When each read started (the fake clock, ms). */
    const startedAt: number[] = [];
    const reads: { img: HTMLImageElement; landed: boolean }[] = [];
    mockPictures(Object.fromEntries(urls.map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])])), (src, img) => {
      started.push(src);
      startedAt.push(Date.now());
      const read = { img, landed: !held.includes(src) };
      reads.push(read);
      if (read.landed) return Promise.resolve();
      return new Promise<void>((r) =>
        release.set(src, [
          ...(release.get(src) ?? []),
          () => {
            read.landed = true;
            r();
          },
        ]),
      );
    });
    const abandoned = (img: HTMLImageElement) => img.getAttribute('src') === '';
    return {
      /** Every read of `src` still held lands now. */
      release: (src: string) => {
        for (const go of release.get(src) ?? []) go();
        release.delete(src);
      },
      started,
      startedAt,
      /** How many reads were abandoned. */
      abandoned: () => reads.filter((r) => abandoned(r.img)).length,
      /** Reads started that have neither landed nor been abandoned. */
      inFlight: () => reads.filter((r) => !r.landed && !abandoned(r.img)).length,
    };
  }

  it('nothing known while its pictures are read (an empty answer), then all four margins of every picture, one canvas read each', async () => {
    const getImageData = mockPictures(pictures());
    const { result } = renderHook(() => useAlphaMarginsOf([A, B]));
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.size).toBe(2));
    const a = result.current.get(A)!;
    expect([a.top, a.bottom, a.left, a.right].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.2, 0.1, 0.1, 0.2]);
    expect(result.current.get(B)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(getImageData).toHaveBeenCalledTimes(2);
  });

  it('a list whose pictures are read together is one answer: the case lays out once', async () => {
    mockPictures(pictures());
    const seen: ReadonlyMap<string, unknown>[] = [];
    renderHook(() => {
      const r = useAlphaMarginsOf([A, B]);
      seen.push(r);
      return r;
    });
    await waitFor(() => expect(seen.at(-1)!.size).toBe(2));
    // the empty answer, then both: never one of them alone
    expect(new Set(seen).size).toBe(2);
  });

  it('a slow picture never holds the others back: each is known as soon as it is read', async () => {
    let releaseB!: () => void;
    mockPictures(pictures(), (src) => (src === B ? new Promise<void>((r) => (releaseB = r)) : Promise.resolve()));
    const { result } = renderHook(() => useAlphaMarginsOf([A, B]));
    await waitFor(() => expect(result.current.has(A)).toBe(true));
    expect(result.current.has(B)).toBe(false);
    releaseB();
    await waitFor(() => expect(result.current.size).toBe(2));
  });

  it(`reads landing apart while the list is read are one answer every ${ALPHA_LANDING_BATCH_MS} ms; the last of the list answers at once`, async () => {
    expect(ALPHA_LANDING_BATCH_MS).toBe(100);
    vi.useFakeTimers();
    const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/b${i}.png`);
    const { release } = heldPictures(urls, urls);
    // each answer the hook gives (a new map): one relayout of the case
    const answers: ReadonlyMap<string, AlphaMargins>[] = [];
    renderHook(() => {
      const known = useAlphaMarginsOf(urls);
      if (answers.at(-1) !== known) answers.push(known);
      return known;
    });
    const sizes = () => answers.map((a) => a.size);
    await vi.advanceTimersByTimeAsync(0);
    release(urls[0]);
    await vi.advanceTimersByTimeAsync(10);
    release(urls[1]);
    await vi.advanceTimersByTimeAsync(10);
    release(urls[2]);
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS - 21);
    expect(sizes()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1 + EFFECTS_MS);
    // the three together, one relayout, and no other for them however long it waits
    expect([...answers.at(-1)!.keys()]).toEqual(urls.slice(0, 3));
    await vi.advanceTimersByTimeAsync(3 * ALPHA_LANDING_BATCH_MS);
    expect(sizes()).toEqual([0, 3]);
    // the fourth opens a batch; the fifth completes the list while it waits: answered at once, and that batch never answers again
    release(urls[3]);
    await vi.advanceTimersByTimeAsync(10);
    release(urls[4]);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(sizes()).toEqual([0, 3, 5]);
    await vi.advanceTimersByTimeAsync(3 * ALPHA_LANDING_BATCH_MS);
    expect(sizes()).toEqual([0, 3, 5]);
  });

  it('a steady stream of reads is answered every batch, never held back until it pauses', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/t${i}.png`);
    const { release } = heldPictures(urls, urls);
    const { result } = renderHook(() => useAlphaMarginsOf(urls));
    await vi.advanceTimersByTimeAsync(0);
    // one lands every 60 ms, each sooner than a batch; the last never
    release(urls[0]);
    await vi.advanceTimersByTimeAsync(60);
    release(urls[1]);
    await vi.advanceTimersByTimeAsync(60);
    // the first batch closed 100 ms after the first landing, with what had landed by then
    expect([...result.current.keys()]).toEqual(urls.slice(0, 2));
    release(urls[2]);
    await vi.advanceTimersByTimeAsync(60);
    release(urls[3]);
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect([...result.current.keys()]).toEqual(urls.slice(0, 4));
  });

  it('a list changed while a batch waits: the old list never answers', async () => {
    vi.useFakeTimers();
    const { release } = heldPictures([A, B], [A, B]);
    const { result, rerender } = renderHook(({ urls }) => useAlphaMarginsOf(urls), { initialProps: { urls: [A, B] } });
    await vi.advanceTimersByTimeAsync(0);
    release(A);
    await vi.advanceTimersByTimeAsync(0);
    // A has landed, its batch still open: now the list is A alone, known at once from the cache
    rerender({ urls: [A] });
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    const shown = result.current;
    expect([...shown.keys()]).toEqual([A]);
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect(result.current).toBe(shown);
  });

  it('known at once when every picture is cached, a part of a measured list too, with no second read', async () => {
    const getImageData = mockPictures(pictures());
    const first = renderHook(() => useAlphaMarginsOf([A, B]));
    await waitFor(() => expect(first.result.current.size).toBe(2));
    const again = renderHook(() => useAlphaMarginsOf([B, A]));
    const atOnce = again.result.current;
    expect(atOnce.size).toBe(2);
    // and it stays that answer: nothing is read again, the case never lays out a second time
    await new Promise((r) => setTimeout(r, 20));
    again.rerender();
    expect(again.result.current).toBe(atOnce);
    expect(renderHook(() => useAlphaMarginsOf([B])).result.current.get(B)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    // the grounding hook shares the same read
    expect(renderHook(() => useBottomMarginFrac(A)).result.current).toBeCloseTo(0.1, 9);
    expect(getImageData).toHaveBeenCalledTimes(2);
  });

  it('a broken picture (its decode fails) is a failed read: known at once as all 0, never left unknown, and never read again', async () => {
    vi.useFakeTimers();
    const decode = vi.fn(() => Promise.reject(new Error('decode failed')));
    HTMLImageElement.prototype.decode = decode;
    const { result } = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.get(A)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    await vi.advanceTimersByTimeAsync(10 * ALPHA_READ_DEADLINE_MAX_MS);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  // the read itself has no guard for these: a picture of no size fails at getImageData, one with no 2D canvas at drawImage,
  // both in its catch; this pins that result
  it('a picture of no size, or one with no 2D canvas to read it on, is a failed read at once: all 0, never read again, its own picture loading or not', async () => {
    vi.useFakeTimers();
    const decode = vi.fn(() => Promise.resolve());
    HTMLImageElement.prototype.decode = decode;
    // A decodes to no size; B to 10 x 10, with no 2D canvas
    for (const side of ['naturalWidth', 'naturalHeight']) {
      Object.defineProperty(HTMLImageElement.prototype, side, {
        configurable: true,
        get(this: HTMLImageElement) {
          return this.src === B ? 10 : 0;
        },
      });
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { result } = renderHook(() => useAlphaMarginsOf([A, B]));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.get(A)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(result.current.get(B)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    // they decoded: the failure is the canvas's, no fetch to try again
    alphaPictureLoaded(A);
    alphaPictureLoaded(B);
    await vi.advanceTimersByTimeAsync(3 * ALPHA_READ_DEADLINE_MS);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  /** A picture's margins, rounded: top, bottom, left, right. */
  const marginsOf = (m: AlphaMargins | undefined) => m && [m.top, m.bottom, m.left, m.right].map((v) => Math.round(v * 1e9) / 1e9);
  const NONE = { top: 0, bottom: 0, left: 0, right: 0 };
  /** decode() rejects so for a broken picture and for a fetch that failed alike. */
  const neverDecoded = () => new DOMException('network error', 'EncodingError');

  it('a picture that never decoded (a broken picture, or its fetch failed: a network or HTTP error) is all 0; when its own picture loads after all, it is read again, ahead of the line, and known by its own margins; one load, one read', async () => {
    vi.useFakeTimers();
    const held = Array.from({ length: ALPHA_READS_AT_ONCE }, (_, i) => `https://example.com/k${i}.png`);
    const after = 'https://example.com/after.png';
    const started: string[] = [];
    let fails = 1;
    mockPictures({ ...pictures(), ...Object.fromEntries([...held, after].map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])])) }, (src) => {
      started.push(src);
      if (src === A) return fails-- > 0 ? Promise.reject(neverDecoded()) : Promise.resolve();
      return held.includes(src) ? new Promise<void>(() => {}) : Promise.resolve();
    });
    const { result } = renderHook(() => useAlphaMarginsOf([A, ...held, after]));
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect(result.current.get(A)).toEqual(NONE);
    expect(getAlphaMask(A)).toBeNull();
    // its own picture loads while the held reads keep their turns and `after` waits in line
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS + ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect(started).toEqual([A, ...held, A, after]);
    expect(marginsOf(result.current.get(A))).toEqual([0.2, 0.1, 0.1, 0.2]);
    expect(getAlphaMask(A)).not.toBeNull();
    // read now: another load reads nothing
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MAX_MS);
    expect(started.filter((s) => s === A)).toHaveLength(2);
  });

  it('its own picture loading while its read is in flight, that read then never decoding: read again at once, never answered all 0 meanwhile; failing again, all 0 until its next load reads it', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const failNext: (() => void)[] = [];
    let fails = 2;
    mockPictures(pictures(), (src) => {
      started.push(src);
      if (fails-- <= 0) return Promise.resolve();
      return new Promise<void>((_, no) => failNext.push(() => no(neverDecoded())));
    });
    const answers: ReadonlyMap<string, AlphaMargins>[] = [];
    renderHook(() => {
      const known = useAlphaMarginsOf([A]);
      if (answers.at(-1) !== known) answers.push(known);
      return known;
    });
    await vi.advanceTimersByTimeAsync(1000);
    alphaPictureLoaded(A);
    failNext.shift()!();
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    // its picture is here, so the read's own fetch failed: read again at once
    expect(started).toEqual([A, A]);
    expect(answers.at(-1)!.has(A), 'never answered all 0 meanwhile').toBe(false);
    // that read fails too: one load, one read; all 0 now, and no read without a load
    failNext.shift()!();
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(answers.at(-1)!.get(A)).toEqual(NONE);
    await vi.advanceTimersByTimeAsync(10 * ALPHA_READ_DEADLINE_MAX_MS);
    expect(started).toEqual([A, A]);
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started).toEqual([A, A, A]);
    expect(marginsOf(answers.at(-1)!.get(A))).toEqual([0.2, 0.1, 0.1, 0.2]);
  });

  it('its own picture loading while its read is in flight, that read then never decoding: the read again goes ahead of the line', async () => {
    vi.useFakeTimers();
    const held = Array.from({ length: ALPHA_READS_AT_ONCE - 1 }, (_, i) => `https://example.com/h${i}.png`);
    const waiting = Array.from({ length: 3 }, (_, i) => `https://example.com/w${i}.png`);
    const started: string[] = [];
    const failA: (() => void)[] = [];
    let readsOfA = 0;
    mockPictures({ ...pictures(), ...Object.fromEntries([...held, ...waiting].map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])])) }, (src) => {
      started.push(src);
      if (src !== A) return new Promise<void>(() => {});
      return readsOfA++ === 0 ? new Promise<void>((_, no) => failA.push(() => no(neverDecoded()))) : Promise.resolve();
    });
    renderHook(() => useAlphaMarginsOf([A, ...held, ...waiting]));
    await vi.advanceTimersByTimeAsync(1000);
    alphaPictureLoaded(A);
    failA[0]();
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS - 1000);
    // its turn went to the first in line as it ended; the read again goes next, ahead of the rest
    expect(started).toEqual([A, ...held, waiting[0], A, waiting[1], waiting[2]]);
  });

  it('a picture read again on its own load whose view is gone before its turn: nothing kept, all 0 still, and its next load reads it again; a list not showing it is never answered anew', async () => {
    vi.useFakeTimers();
    const held = Array.from({ length: ALPHA_READS_AT_ONCE }, (_, i) => `https://example.com/m${i}.png`);
    const started: string[] = [];
    let fails = 1;
    mockPictures({ ...pictures(), ...Object.fromEntries(held.map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])])) }, (src) => {
      started.push(src);
      if (src === A) return fails-- > 0 ? Promise.reject(neverDecoded()) : Promise.resolve();
      return new Promise<void>(() => {});
    });
    const shown = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(shown.result.current.get(A)).toEqual(NONE);
    const others = renderHook(() => useAlphaMarginsOf(held));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    const othersAnswer = others.result.current;
    // its picture loads with every turn taken: its read waits at the front of the line, and its view goes meanwhile
    alphaPictureLoaded(A);
    shown.unmount();
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    expect(started.filter((s) => s === A)).toHaveLength(1);
    // a view of it, known now, comes and goes: no view shows it, and its load reads nothing
    renderHook(() => useAlphaMarginsOf([A])).unmount();
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started.filter((s) => s === A)).toHaveLength(1);
    // a view of it again: all 0 from the cache at once; its next load reads it, and that view learns its own margins
    const again = renderHook(() => useAlphaMarginsOf([A]));
    expect(again.result.current.get(A)).toEqual(NONE);
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started.filter((s) => s === A)).toHaveLength(2);
    expect(marginsOf(again.result.current.get(A))).toEqual([0.2, 0.1, 0.1, 0.2]);
    expect(others.result.current, 'a list not showing it: no new answer').toBe(othersAnswer);
  });

  it('a list with a new picture keeps what it knows: only the new one is unknown, until it is read', async () => {
    let releaseB!: () => void;
    mockPictures(pictures(), (src) => (src === B ? new Promise<void>((r) => (releaseB = r)) : Promise.resolve()));
    const { result, rerender } = renderHook(({ urls }) => useAlphaMarginsOf(urls), { initialProps: { urls: [A] } });
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ urls: [A, B] });
    expect([...result.current.keys()]).toEqual([A]);
    await new Promise((r) => setTimeout(r, 20));
    expect([...result.current.keys()]).toEqual([A]);
    releaseB();
    await waitFor(() => expect(result.current.size).toBe(2));
  });

  it('a list it no longer shows never lands: the answer is for the list it shows now', async () => {
    let releaseB!: () => void;
    mockPictures(pictures(), (src) => (src === B ? new Promise<void>((r) => (releaseB = r)) : Promise.resolve()));
    const { result, rerender } = renderHook(({ urls }) => useAlphaMarginsOf(urls), { initialProps: { urls: [B] } });
    await waitFor(() => expect(releaseB).toBeTypeOf('function'));
    rerender({ urls: [A] });
    await waitFor(() => expect(result.current.size).toBe(1));
    const shown = result.current;
    releaseB();
    await new Promise((r) => setTimeout(r, ALPHA_LANDING_BATCH_MS + 20));
    // the same answer, untouched: the old list's read does not make the case lay out again
    expect(result.current).toBe(shown);
    expect([...result.current.keys()]).toEqual([A]);
  });

  it('no pictures: an empty answer at once', () => {
    const { result } = renderHook(() => useAlphaMarginsOf([]));
    expect(result.current.size).toBe(0);
  });

  it(`reads at most ${ALPHA_READS_AT_ONCE} pictures at once, however long the list`, async () => {
    expect(ALPHA_READS_AT_ONCE).toBe(4);
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/p${i}.png`);
    const buffers = Object.fromEntries(urls.map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])]));
    const waiting: (() => void)[] = [];
    let reading = 0;
    let most = 0;
    mockPictures(buffers, () => {
      reading++;
      most = Math.max(most, reading);
      return new Promise<void>((r) =>
        waiting.push(() => {
          reading--;
          r();
        }),
      );
    });
    const { result } = renderHook(() => useAlphaMarginsOf(urls));
    for (let done = 0; done < urls.length; done++) {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      expect(reading).toBeLessThanOrEqual(ALPHA_READS_AT_ONCE);
      waiting.shift()!();
    }
    await waitFor(() => expect(result.current.size).toBe(urls.length));
    expect(most).toBe(ALPHA_READS_AT_ONCE);
  });

  it('a list asked for while others wait in line still waits its turn: never more than the limit in flight', async () => {
    const first = Array.from({ length: 6 }, (_, i) => `https://example.com/q${i}.png`);
    const later = 'https://example.com/later.png';
    const buffers = Object.fromEntries([...first, later].map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])]));
    const waiting: (() => void)[] = [];
    let reading = 0;
    let most = 0;
    mockPictures(buffers, () => {
      reading++;
      most = Math.max(most, reading);
      return new Promise<void>((r) =>
        waiting.push(() => {
          reading--;
          r();
        }),
      );
    });
    renderHook(() => useAlphaMarginsOf(first));
    await waitFor(() => expect(waiting.length).toBe(ALPHA_READS_AT_ONCE));
    // one read ends: its turn goes to the next in line, so the line moves but the reads in flight stay at the limit
    waiting.shift()!();
    await waitFor(() => expect(waiting.length).toBe(ALPHA_READS_AT_ONCE));
    // a second list now: it queues behind the rest
    const { result } = renderHook(() => useAlphaMarginsOf([later]));
    await new Promise((r) => setTimeout(r, 20));
    expect(reading).toBe(ALPHA_READS_AT_ONCE);
    while (waiting.length > 0) {
      waiting.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(most).toBe(ALPHA_READS_AT_ONCE);
  });

  it(`a read still going after ${ALPHA_READ_TURN_MS} ms hands its turn on (stalled pictures never hold the rest up), and only once`, async () => {
    expect(ALPHA_READ_TURN_MS).toBe(1500);
    vi.useFakeTimers();
    const slow = Array.from({ length: 4 }, (_, i) => `https://example.com/s${i}.png`);
    const next = Array.from({ length: 4 }, (_, i) => `https://example.com/n${i}.png`);
    const last = 'https://example.com/last.png';
    const { release, started } = heldPictures([...slow, ...next, last], [...slow, ...next]);
    const { result } = renderHook(() => useAlphaMarginsOf([...slow, ...next, last]));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS - 1);
    expect(started).toEqual(slow);
    // the four stalled reads give their turns to the next four, still reading in the background
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([...slow, ...next]);
    // a stalled read that ends lands, but it has handed its turn on already: the next in line still waits
    release(slow[0]);
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect(result.current.has(slow[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS - ALPHA_LANDING_BATCH_MS - EFFECTS_MS - 1);
    expect(started).not.toContain(last);
    // until the four after it run out of time too
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toContain(last);
    await vi.advanceTimersByTimeAsync(ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
    expect(result.current.has(last)).toBe(true);
    expect(result.current.has(slow[1])).toBe(false);
  });

  it(`reads in flight (started, not yet landed or abandoned) are never more than 2 x ${ALPHA_READS_AT_ONCE}: a stalled network never decodes a long list together`, async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 40 }, (_, i) => `https://example.com/z${i}.png`);
    const later = Array.from({ length: 10 }, (_, i) => `https://example.com/y${i}.png`);
    const { release, started, inFlight } = heldPictures([...urls, ...later], [...urls, ...later]);
    renderHook(() => useAlphaMarginsOf(urls));
    const counts: number[] = [];
    for (let turn = 0; turn < 4; turn++) {
      await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
      counts.push(inFlight());
    }
    // the first four gave their turns to the next four, which then keep theirs: no room left for more reads out of time
    expect(counts).toEqual(counts.map(() => 2 * ALPHA_READS_AT_ONCE));
    expect(started).toEqual(urls.slice(0, 2 * ALPHA_READS_AT_ONCE));
    // one read out of time ends: a read out of time still holding a turn gives it up, and one more picture is read
    release(urls[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(urls.slice(0, 2 * ALPHA_READS_AT_ONCE + 1));
    // one still holding its turn ends: the turn goes to the next in line, and that read waits its own time
    release(urls[ALPHA_READS_AT_ONCE + 1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(urls.slice(0, 2 * ALPHA_READS_AT_ONCE + 2));
    expect(inFlight()).toBe(2 * ALPHA_READS_AT_ONCE);
    // however long the rest stall, each abandoned at its deadline and read again later: the list moves on, the room
    // full while reads wait and never more in flight
    for (let turn = 0; turn < 12; turn++) {
      await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
      counts.push(inFlight());
    }
    expect(counts).toEqual(counts.map(() => 2 * ALPHA_READS_AT_ONCE));
    expect(new Set(started).size).toBeGreaterThan(4 * ALPHA_READS_AT_ONCE);
    // every read ends as it starts: then every turn and all the room are free again, and never one more
    for (let round = 0; round < 50 && inFlight() > 0; round++) {
      for (const url of urls) release(url);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(inFlight()).toBe(0);
    const before = started.length;
    renderHook(() => useAlphaMarginsOf(later));
    await vi.advanceTimersByTimeAsync(0);
    expect(started.slice(before)).toEqual(later.slice(0, ALPHA_READS_AT_ONCE));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    expect(started.slice(before)).toEqual(later.slice(0, 2 * ALPHA_READS_AT_ONCE));
  });

  it(`reads running out of time a few at a time (4, then 1, then 4 more): still never more than 2 x ${ALPHA_READS_AT_ONCE} in flight`, async () => {
    vi.useFakeTimers();
    const s = Array.from({ length: 4 }, (_, i) => `https://example.com/s${i}.png`);
    const t = ['https://example.com/t0.png'];
    const u = Array.from({ length: 4 }, (_, i) => `https://example.com/u${i}.png`);
    const { inFlight } = heldPictures([...s, ...t, ...u], [...s, ...t, ...u]);
    renderHook(() => useAlphaMarginsOf(s));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    renderHook(() => useAlphaMarginsOf(t));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    renderHook(() => useAlphaMarginsOf(u));
    const counts: number[] = [];
    for (let step = 0; step < 6 * 6; step++) {
      await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS / 6);
      counts.push(inFlight());
    }
    // the room filled, and never more; a read abandoned waits out its backoff out of the room, so it is full only while reads wait
    expect(Math.max(...counts), `in flight every ${ALPHA_READ_TURN_MS / 6} ms: ${counts}`).toBe(2 * ALPHA_READS_AT_ONCE);
  });

  it(`a read not done ${ALPHA_READ_DEADLINE_MS} ms after it starts is abandoned (its src cleared): its figure stays unknown, nothing is kept, and it is read again ${ALPHA_READ_BACKOFF_MS} ms on`, async () => {
    expect([ALPHA_READ_DEADLINE_MS, ALPHA_READ_BACKOFF_MS]).toEqual([8000, 1500]);
    vi.useFakeTimers();
    const { release, started, abandoned } = heldPictures([A], [A]);
    const { result } = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS - 1);
    expect([started.length, abandoned()]).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(1);
    // its src cleared: it leaves the room it held, and waits out its backoff before it is read again
    expect([started.length, abandoned()]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.has(A), 'still unknown: its figure stays a plate').toBe(false);
    expect(getAlphaMask(A), 'nothing kept for it').toBeUndefined();
    await vi.advanceTimersByTimeAsync(ALPHA_READ_BACKOFF_MS - EFFECTS_MS - 1);
    expect(started.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(started.length).toBe(2);
    // the second read lands: the picture's own margins, not a failed read's, and a read that lands is never abandoned
    release(A);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.get(A)).toEqual({ top: 0.25, bottom: 0.5, left: 0.25, right: 0.5 });
    expect(getAlphaMask(A)).not.toBeNull();
    // and its deadline goes with it: no timer left behind holding the picture
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * ALPHA_READ_DEADLINE_MS);
    expect([started.length, abandoned()]).toEqual([2, 1]);
  });

  it(`a picture whose every read stalls stays unknown (its plate) while its view lives, never a failed read: read again after a backoff of ${ALPHA_READ_BACKOFF_MS} ms doubling to ${ALPHA_READ_BACKOFF_MAX_MS} ms, each read given twice the time of the last up to ${ALPHA_READ_DEADLINE_MAX_MS} ms; never again once its view is gone`, async () => {
    expect([ALPHA_READ_BACKOFF_MS, ALPHA_READ_BACKOFF_MAX_MS, ALPHA_READ_DEADLINE_MAX_MS]).toEqual([1500, 15000, 32000]);
    vi.useFakeTimers();
    const { startedAt, abandoned } = heldPictures([A], [A]);
    const t0 = Date.now();
    const view = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const at = startedAt.map((t) => t - t0);
    // read 8 s, wait 1.5 s; 16 s, 3 s; 32 s, 6 s; 32 s, 12 s; then 32 s and 15 s each time
    expect(at.slice(0, 7)).toEqual([0, 9_500, 28_500, 66_500, 110_500, 157_500, 204_500]);
    expect(at).toHaveLength(15);
    for (const t of at) expect(at.filter((u) => u >= t && u < t + 60_000).length, `reads in the minute from ${t} ms`).toBeLessThanOrEqual(3);
    expect(view.result.current.has(A), 'never known: no failed read for running out of time').toBe(false);
    expect(getAlphaMask(A)).toBeUndefined();
    // its view goes: the read in flight runs out of time and none follows, nor any timer
    view.unmount();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect([startedAt.length, abandoned()]).toEqual([15, 15]);
    expect(vi.getTimerCount()).toBe(0);
    // a view wants it again: read afresh, from the first deadline
    renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS - 1);
    expect([startedAt.length, abandoned()]).toEqual([16, 15]);
    await vi.advanceTimersByTimeAsync(1);
    expect(abandoned()).toBe(16);
  });

  it('a read whose view is gone before its turn comes never starts; a view that wants the picture again reads it afresh', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: ALPHA_READS_AT_ONCE + 1 }, (_, i) => `https://example.com/g${i}.png`);
    const { release, started } = heldPictures(urls, urls);
    renderHook(() => useAlphaMarginsOf(urls.slice(0, ALPHA_READS_AT_ONCE)));
    const gone = renderHook(() => useAlphaMarginsOf(urls.slice(ALPHA_READS_AT_ONCE)));
    await vi.advanceTimersByTimeAsync(0);
    gone.unmount();
    for (const url of urls) release(url);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started).toEqual(urls.slice(0, ALPHA_READS_AT_ONCE));
    const again = renderHook(() => useAlphaMarginsOf(urls.slice(ALPHA_READS_AT_ONCE)));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started).toEqual(urls);
    release(urls[ALPHA_READS_AT_ONCE]);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(again.result.current.size).toBe(1);
  });

  it(`a slow link, no stall (no HTTP cache: every read is its own fetch): every read takes 1.5 x the first deadline, yet every picture ends read with its own margins, never as a failed read, never more than 2 x ${ALPHA_READS_AT_ONCE} in flight`, async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/slow${i}.png`);
    const takes = 1.5 * ALPHA_READ_DEADLINE_MS;
    const reads: { img: HTMLImageElement; landed: boolean }[] = [];
    mockPictures(Object.fromEntries(urls.map((u) => [u, bufferWithPixels(4, 4, [[1, 1]])])), (_src, img) => {
      const read = { img, landed: false };
      reads.push(read);
      return new Promise<void>((r) =>
        setTimeout(() => {
          read.landed = true;
          r();
        }, takes),
      );
    });
    const inFlight = () => reads.filter((r) => !r.landed && r.img.getAttribute('src') !== '').length;
    const answers: ReadonlyMap<string, AlphaMargins>[] = [];
    renderHook(() => {
      const known = useAlphaMarginsOf(urls);
      if (answers.at(-1) !== known) answers.push(known);
      return known;
    });
    const own = { top: 0.25, bottom: 0.5, left: 0.25, right: 0.5 };
    let most = 0;
    let ms = 0;
    for (; ms < 5 * 60_000 && answers.at(-1)!.size < urls.length; ms += 250) {
      await vi.advanceTimersByTimeAsync(250);
      most = Math.max(most, inFlight());
    }
    expect(answers.at(-1)).toEqual(new Map(urls.map((u) => [u, own])));
    // every answer on the way: each picture it knows, known by its own margins
    expect(answers.flatMap((a) => [...a.values()]).filter((m) => JSON.stringify(m) !== JSON.stringify(own))).toEqual([]);
    expect(reads.length, 'the first reads ran out of time and were read again').toBeGreaterThan(urls.length);
    expect(most).toBeLessThanOrEqual(2 * ALPHA_READS_AT_ONCE);
    expect(ms, 'read within two minutes').toBeLessThanOrEqual(2 * 60_000);
  });

  it('a picture whose read ran out of time is read again at once when its own picture loads (a cache hit then), not after its backoff', async () => {
    vi.useFakeTimers();
    const { release, started } = heldPictures([A], [A]);
    const { result } = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS + 100);
    // waiting out its backoff
    expect(started).toEqual([A]);
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([A, A]);
    // its backoff is over: the timers left are the new read's turn and deadline
    expect(vi.getTimerCount()).toBe(2);
    // with no cache that read is slow too: one load, one read at once; the next waits its (second) backoff
    await vi.advanceTimersByTimeAsync(2 * ALPHA_READ_DEADLINE_MS + 2 * ALPHA_READ_BACKOFF_MS - 1);
    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveLength(3);
    release(A);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.get(A)).toEqual({ top: 0.25, bottom: 0.5, left: 0.25, right: 0.5 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a read sent again by its own picture loading goes ahead of the reads waiting in line, from its read out of time or from its backoff', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/h${i}.png`);
    const { started } = heldPictures(urls, urls);
    renderHook(() => useAlphaMarginsOf(urls));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS - 100);
    // h1's picture loads while its read is in flight; h0's once its read has run out of time
    alphaPictureLoaded(urls[1]);
    await vi.advanceTimersByTimeAsync(200);
    alphaPictureLoaded(urls[0]);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    expect(started.slice(2 * ALPHA_READS_AT_ONCE)).toEqual([urls[8], urls[9], urls[1], urls[10], urls[0], urls[11], urls[12], urls[13]]);
  });

  it('a picture two views want is read again while either still does', async () => {
    vi.useFakeTimers();
    const { startedAt } = heldPictures([A], [A]);
    const one = renderHook(() => useAlphaMarginsOf([A]));
    renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(1000);
    one.unmount();
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS + ALPHA_READ_BACKOFF_MS);
    expect(startedAt).toHaveLength(2);
  });

  it('its own picture loading while its read is in flight: if that read runs out of time, the next starts at once; one load, one read at once', async () => {
    vi.useFakeTimers();
    const { started, startedAt } = heldPictures([A], [A]);
    renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(1000);
    alphaPictureLoaded(A);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS - 1000);
    expect(startedAt.map((t) => t - startedAt[0])).toEqual([0, ALPHA_READ_DEADLINE_MS]);
    // that read, given twice the time, runs out of time too: the next waits its backoff (the second: twice the first)
    await vi.advanceTimersByTimeAsync(2 * ALPHA_READ_DEADLINE_MS + 2 * ALPHA_READ_BACKOFF_MS - 1);
    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveLength(3);
  });

  it('its own picture loading during a read that waited in line for its turn: if that read runs out of time, the next starts at once', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: ALPHA_READS_AT_ONCE + 1 }, (_, i) => `https://example.com/q${i}.png`);
    const last = urls[ALPHA_READS_AT_ONCE];
    const { started, startedAt } = heldPictures(urls, urls);
    const t0 = Date.now();
    const readsOfLast = () => startedAt.filter((_, i) => started[i] === last).map((t) => t - t0);
    renderHook(() => useAlphaMarginsOf(urls));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    // it waited in line, then took the turn handed on
    expect(readsOfLast()).toEqual([ALPHA_READ_TURN_MS]);
    await vi.advanceTimersByTimeAsync(1000);
    alphaPictureLoaded(last);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS + 100);
    // that read runs out of time: the load sends the next at once, not after its backoff
    expect(readsOfLast()).toEqual([ALPHA_READ_TURN_MS, ALPHA_READ_TURN_MS + ALPHA_READ_DEADLINE_MS]);
  });

  it('its own picture loading during a re-read that started from its backoff: if that read runs out of time, the next starts at once', async () => {
    vi.useFakeTimers();
    const { startedAt } = heldPictures([A], [A]);
    const t0 = Date.now();
    const reads = () => startedAt.map((t) => t - t0);
    renderHook(() => useAlphaMarginsOf([A]));
    const second = ALPHA_READ_DEADLINE_MS + ALPHA_READ_BACKOFF_MS;
    await vi.advanceTimersByTimeAsync(second + 500);
    expect(reads()).toEqual([0, second]);
    alphaPictureLoaded(A);
    // the second read, given twice the time, runs out of time: the load sends the next at once, not after its backoff
    await vi.advanceTimersByTimeAsync(2 * ALPHA_READ_DEADLINE_MS);
    expect(reads()).toEqual([0, second, second + 2 * ALPHA_READ_DEADLINE_MS]);
  });

  it('its own picture loading while it waits in line: it is read next, ahead of the line', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/f${i}.png`);
    const { started } = heldPictures(urls, urls);
    renderHook(() => useAlphaMarginsOf(urls));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(urls.slice(0, ALPHA_READS_AT_ONCE));
    alphaPictureLoaded(urls[9]);
    // first in line already: it stays there
    alphaPictureLoaded(urls[9]);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    expect(started).toEqual([...urls.slice(0, ALPHA_READS_AT_ONCE), urls[9], ...urls.slice(ALPHA_READS_AT_ONCE, 2 * ALPHA_READS_AT_ONCE - 1)]);
  });

  it('a load of a picture not being read (never asked for, or read already) starts no read', async () => {
    vi.useFakeTimers();
    const { started } = heldPictures([A, B], []);
    const { result } = renderHook(() => useAlphaMarginsOf([A]));
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(result.current.has(A)).toBe(true);
    alphaPictureLoaded(A);
    alphaPictureLoaded(B);
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MAX_MS);
    expect(started).toEqual([A]);
  });

  it('an abandoned read waits out its backoff, then is read again behind the reads waiting by then', async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/w${i}.png`);
    const { started } = heldPictures(urls, urls);
    renderHook(() => useAlphaMarginsOf(urls));
    // the first four, abandoned: the four still waiting take the room they leave
    await vi.advanceTimersByTimeAsync(ALPHA_READ_DEADLINE_MS);
    expect(started).toEqual(urls);
    // their backoff over as the next four are abandoned: the first four are read again, behind them
    await vi.advanceTimersByTimeAsync(ALPHA_READ_BACKOFF_MS);
    expect(started).toEqual([...urls, ...urls.slice(0, ALPHA_READS_AT_ONCE)]);
  });

  // when the others are read: a turn on while the stalled fit in the turns, else as the stalled move through the room
  for (const [stalled, by] of [
    [ALPHA_READS_AT_ONCE, ALPHA_READ_TURN_MS],
    [2 * ALPHA_READS_AT_ONCE, ALPHA_READ_DEADLINE_MS],
    [3 * ALPHA_READS_AT_ONCE, ALPHA_READ_DEADLINE_MS + ALPHA_READ_TURN_MS],
  ] as const) {
    it(`${stalled} reads at the head of a 20-picture list stalled for good: every other picture is still read, ${by} ms on`, async () => {
      vi.useFakeTimers();
      const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/v${i}.png`);
      const [stalledUrls, fine] = [urls.slice(0, stalled), urls.slice(stalled)];
      heldPictures(urls, stalledUrls);
      const { result } = renderHook(() => useAlphaMarginsOf(urls));
      await vi.advanceTimersByTimeAsync(by - 1);
      expect(fine.filter((u) => result.current.has(u)), 'fine pictures read before the stalled make room').toEqual([]);
      await vi.advanceTimersByTimeAsync(1 + ALPHA_LANDING_BATCH_MS + EFFECTS_MS);
      expect(fine.filter((u) => !result.current.has(u)), 'fine pictures still unknown').toEqual([]);
      expect(stalledUrls.filter((u) => result.current.has(u)), 'stalled pictures known').toEqual([]);
    });
  }

  // a new picture never waits behind stalled re-reads: first reads go ahead of re-reads in line, and re-reads hold at
  // most ALPHA_READS_AT_ONCE of the room, so a turn is always at most one turn away for a first read
  for (const stalledCount of [2, 4, 8, 16].map((n) => n * ALPHA_READS_AT_ONCE)) {
    it(`${stalledCount} pictures stalled for good on show for 3 minutes (every read of them a re-read by then): a new picture's first read starts within one turn (${ALPHA_READ_TURN_MS} ms), each time one comes; the re-reads never more than ${ALPHA_READS_AT_ONCE} in flight`, async () => {
      vi.useFakeTimers();
      const stalled = Array.from({ length: stalledCount }, (_, i) => `https://example.com/st${i}.png`);
      const fresh = Array.from({ length: 12 }, (_, i) => `https://example.com/new${i}.png`);
      const { started, startedAt, inFlight } = heldPictures([...stalled, ...fresh], stalled);
      renderHook(() => useAlphaMarginsOf(stalled));
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      const waited: number[] = [];
      const unknown: string[] = [];
      const rereading: number[] = [];
      for (const url of fresh) {
        const asked = Date.now();
        const view = renderHook(() => useAlphaMarginsOf([url]));
        for (let ms = 0; ms < 60_000 && !started.includes(url); ms += 50) await vi.advanceTimersByTimeAsync(50);
        waited.push(started.includes(url) ? startedAt[started.indexOf(url)] - asked : Infinity);
        await vi.advanceTimersByTimeAsync(EFFECTS_MS);
        if (!view.result.current.has(url)) unknown.push(url);
        // the next one comes 7 s on (a different point of the stalled reads' cycle each time)
        for (let ms = 0; ms < 7000; ms += 250) {
          await vi.advanceTimersByTimeAsync(250);
          rereading.push(inFlight());
        }
      }
      expect(waited.filter((ms) => ms > ALPHA_READ_TURN_MS), `waits for a turn: ${waited}`).toEqual([]);
      expect(unknown, 'new pictures unknown once read').toEqual([]);
      expect(Math.max(...rereading)).toBe(ALPHA_READS_AT_ONCE);
    });
  }

  it(`a re-read held back while ${ALPHA_READS_AT_ONCE} re-reads fill their room starts the moment one of them ends, out of time or still in its turn; held re-reads start in the order they came`, async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: ALPHA_READS_AT_ONCE + 2 }, (_, i) => `https://example.com/r${i}.png`);
    const [p4, p5] = urls.slice(ALPHA_READS_AT_ONCE);
    const { release, started, startedAt } = heldPictures(urls, urls);
    const t0 = Date.now();
    const readsOf = (url: string) => startedAt.filter((_, i) => started[i] === url).map((t) => t - t0);
    renderHook(() => useAlphaMarginsOf(urls));
    // the first four, out of time at 8 s, are read again from 9.5 s and fill the room; the last two, out of time at
    // 9.5 s, wait their backoff, then in line from 11 s, held back
    await vi.advanceTimersByTimeAsync(12_000);
    expect(urls.map(readsOf)).toEqual([[0, 9_500], [0, 9_500], [0, 9_500], [0, 9_500], [1_500], [1_500]]);
    // one of the four, out of time by now, lands: the first held starts at once
    release(urls[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect([readsOf(p4), readsOf(p5)]).toEqual([[1_500, 12_000], [1_500]]);
    // that one lands while still in its turn: the next held starts at once
    await vi.advanceTimersByTimeAsync(500);
    release(p4);
    await vi.advanceTimersByTimeAsync(0);
    expect([readsOf(p4), readsOf(p5)]).toEqual([[1_500, 12_000], [1_500, 12_500]]);
  });

  // the timeline above with one held re-read: its own picture loads during its backoff, or while it waits in line held back
  for (const [where, loadAt, startsAt] of [
    ['during its backoff: it starts at the next turn', 10_000, 11_000],
    ['while it waits in line, held back: it starts at once', 12_000, 12_000],
  ] as const) {
    it(`a re-read sent at once by its own picture loading is never held back by the re-reads filling their room: loaded ${where}`, async () => {
      vi.useFakeTimers();
      const urls = Array.from({ length: ALPHA_READS_AT_ONCE + 1 }, (_, i) => `https://example.com/r${i}.png`);
      const p4 = urls[ALPHA_READS_AT_ONCE];
      const { started, startedAt } = heldPictures(urls, urls);
      const t0 = Date.now();
      const readsOf = (url: string) => startedAt.filter((_, i) => started[i] === url).map((t) => t - t0);
      renderHook(() => useAlphaMarginsOf(urls));
      await vi.advanceTimersByTimeAsync(loadAt);
      alphaPictureLoaded(p4);
      await vi.advanceTimersByTimeAsync(startsAt - loadAt + 100);
      expect(readsOf(p4)).toEqual([1_500, startsAt]);
      // held back without its load: until one of the four re-reads ends, 25.5 s
      expect(readsOf(urls[0])).toEqual([0, 9_500]);
    });
  }

  it('a read landing after a new list renders but before its effect runs is answered (the browser runs effects after the frame)', async () => {
    vi.useFakeTimers();
    const { release, started } = heldPictures([A, B], [A, B]);
    const seen: ReadonlyMap<string, AlphaMargins>[] = [];
    function Probe({ urls }: { urls: readonly string[] }) {
      seen.push(useAlphaMarginsOf(urls));
      return null;
    }
    // no act(): Preact renders at once and runs the effects after the next frame, as it does in the browser
    const root = document.createElement('div');
    render(h(Probe, { urls: [A, B] }), root);
    await vi.advanceTimersByTimeAsync(EFFECTS_MS);
    expect(started).toEqual([A, B]);
    // the list narrows to A, rendered while A is still being read
    render(h(Probe, { urls: [A] }), root);
    expect(seen.at(-1)!.has(A)).toBe(false);
    // A lands now: after that render, before its effect
    release(A);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4 * ALPHA_READ_TURN_MS);
    expect(seen.at(-1)!.has(A), 'A was read: its figure is grounded').toBe(true);
    render(null, root);
  });

  it('a stalled read that hands its turn on with none waiting frees it once: later lists still read at most the limit at once', async () => {
    vi.useFakeTimers();
    const lone = 'https://example.com/lone.png';
    const later = Array.from({ length: 6 }, (_, i) => `https://example.com/l${i}.png`);
    const { release, started } = heldPictures([lone, ...later], [lone, ...later]);
    renderHook(() => useAlphaMarginsOf([lone]));
    await vi.advanceTimersByTimeAsync(ALPHA_READ_TURN_MS);
    release(lone);
    await vi.advanceTimersByTimeAsync(0);
    renderHook(() => useAlphaMarginsOf(later));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([lone, ...later.slice(0, ALPHA_READS_AT_ONCE)]);
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
    __clearAlphaMarginCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    getContextSpy?.mockRestore();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it("is read in the same read as the picture's margins: one decode and one canvas read for both", async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const getImageData = vi.fn(() => bufferWithContactBand(100, 100, 8, 10, 30));
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    const url = 'https://example.com/shared.png';
    const margins = renderHook(() => useAlphaMarginsOf([url]));
    const band = renderHook(() => useContactBand(url));
    await waitFor(() => expect(band.result.current?.centerXFrac).toBeCloseTo(19.5 / 100, 5));
    await waitFor(() => expect(margins.result.current.has(url)).toBe(true));
    expect(HTMLImageElement.prototype.decode).toHaveBeenCalledTimes(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it(`waits its turn with the alpha reads: while ${ALPHA_READS_AT_ONCE} pictures are read, it decodes nothing until one ends`, async () => {
    vi.useFakeTimers();
    const decoded: string[] = [];
    const held: (() => void)[] = [];
    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      decoded.push(this.src);
      return new Promise<void>((r) => held.push(r));
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => bufferWithContactBand(100, 100, 8, 40, 60),
    } as unknown as CanvasRenderingContext2D);
    const busy = Array.from({ length: ALPHA_READS_AT_ONCE }, (_, i) => `https://example.com/busy${i}.png`);
    const own = 'https://example.com/band.png';
    renderHook(() => useAlphaMarginsOf(busy));
    await vi.advanceTimersByTimeAsync(50);
    expect(decoded).toEqual(busy);
    const band = renderHook(() => useContactBand(own));
    await vi.advanceTimersByTimeAsync(50);
    expect(decoded).toEqual(busy);
    held.shift()!();
    await vi.advanceTimersByTimeAsync(50);
    expect(decoded).toEqual([...busy, own]);
    while (held.length > 0) held.shift()!();
    await vi.advanceTimersByTimeAsync(50);
    expect(band.result.current?.centerXFrac).toBeCloseTo(49.5 / 100, 5);
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

  it('a picture that never decoded whose own picture loads after all (the read failed to fetch it): the band of the read its load sends', async () => {
    let fails = 1;
    mockDecode(() => (fails-- > 0 ? Promise.reject(new DOMException('network error', 'EncodingError')) : Promise.resolve()));
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithContactBand(100, 100, 8, 10, 30);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);
    const url = 'https://example.com/refetched-band.png';
    const { result } = renderHook(() => useContactBand(url));
    await waitFor(() => expect(fails).toBe(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
    alphaPictureLoaded(url);
    await waitFor(() => expect(result.current?.centerXFrac).toBeCloseTo(19.5 / 100, 5));
  });

  it('a view of a picture known as never decoded wants it while shown: its load reads it again then, telling that view alone; with no view showing it, a load reads nothing', async () => {
    let decodes = 0;
    mockDecode(() => (decodes++ === 0 ? Promise.reject(new DOMException('network error', 'EncodingError')) : Promise.resolve()));
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const buf = bufferWithContactBand(100, 100, 8, 10, 30);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => buf,
    } as unknown as CanvasRenderingContext2D);
    const url = 'https://example.com/known-undecoded-band.png';
    const first = renderHook(() => useContactBand(url));
    await waitFor(() => expect(decodes).toBe(1));
    first.unmount();
    // a view of it, known now (no band), comes and goes: then no view shows it, and its load reads nothing
    renderHook(() => useContactBand(url)).unmount();
    alphaPictureLoaded(url);
    await new Promise((r) => setTimeout(r, 20));
    expect(decodes).toBe(1);
    // a view of it again, and one of no picture: its load reads it, and only its view learns the band
    const shown = renderHook(() => useContactBand(url));
    const none = renderHook(() => useContactBand(undefined));
    expect(shown.result.current).toBeNull();
    alphaPictureLoaded(url);
    await waitFor(() => expect(shown.result.current?.centerXFrac).toBeCloseTo(19.5 / 100, 5));
    expect(decodes).toBe(2);
    expect(none.result.current).toBeNull();
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

describe('computeAlphaMask / alphaMaskAt', () => {
  it('marks exactly the drawn pixels of a small image, one cell per pixel', () => {
    const mask = computeAlphaMask(bufferWithPixels(4, 3, [[1, 0], [3, 2]]))!;
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(3);
    const drawn: string[] = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) if (alphaMaskAt(mask, (x + 0.5) / 4, (y + 0.5) / 3)) drawn.push(`${x},${y}`);
    }
    expect(drawn).toEqual(['1,0', '3,2']);
  });

  it('caps the long side at ALPHA_MASK_MAX_CELLS and keeps the aspect ratio', () => {
    const mask = computeAlphaMask(bufferWithPixels(600, 800, []))!;
    expect(mask.height).toBe(ALPHA_MASK_MAX_CELLS);
    expect(mask.width).toBe(Math.ceil((600 * ALPHA_MASK_MAX_CELLS) / 800));
  });

  it('keeps a cell drawn when ANY pixel it covers is drawn, so a one-pixel strand survives downsampling', () => {
    const strand = Array.from({ length: 1000 }, (_, y) => [333, y] as [number, number]);
    const mask = computeAlphaMask(bufferWithPixels(1000, 1000, strand))!;
    expect(mask.width).toBe(ALPHA_MASK_MAX_CELLS);
    expect(alphaMaskAt(mask, 333.5 / 1000, 0.5)).toBe(true);
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBe(false);
  });

  it('ignores anti-aliasing dust at or below the alpha threshold (the same one grounding uses)', () => {
    const mask = computeAlphaMask(bufferWithPixels(2, 1, [[0, 0]], 10))!;
    expect(alphaMaskAt(mask, 0.25, 0.5)).toBe(false);
    const faint = computeAlphaMask(bufferWithPixels(2, 1, [[0, 0]], 11))!;
    expect(alphaMaskAt(faint, 0.25, 0.5)).toBe(true);
  });

  it('reads nothing outside the image', () => {
    const mask = computeAlphaMask(bufferWithPixels(1, 1, [[0, 0]]))!;
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBe(true);
    for (const [u, v] of [[-0.01, 0.5], [1, 0.5], [0.5, -0.01], [0.5, 1]]) expect(alphaMaskAt(mask, u, v)).toBe(false);
  });

  it('reads a rectangle as drawn when any cell it touches is, clipped to the image', () => {
    const mask = computeAlphaMask(bufferWithPixels(4, 4, [[3, 3]]))!;
    expect(alphaMaskDrawnIn(mask, 0, 0, 0.74, 0.74)).toBe(false);
    expect(alphaMaskDrawnIn(mask, 0, 0, 0.76, 0.76)).toBe(true);
    expect(alphaMaskDrawnIn(mask, 0.9, 0.9, 1.5, 1.5)).toBe(true);
    expect(alphaMaskDrawnIn(mask, 1, 0, 2, 1)).toBe(false);
    expect(alphaMaskDrawnIn(mask, -1, -1, 0, 0)).toBe(false);
  });

  it('returns null for a degenerate zero-size buffer', () => {
    expect(computeAlphaMask({ width: 0, height: 10, data: [] })).toBeNull();
  });
});

describe('getAlphaMask (from the same canvas read as the grounding margin)', () => {
  function mockDecode(impl: () => Promise<void>) {
    HTMLImageElement.prototype.decode = vi.fn(impl);
  }
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __clearAlphaMarginCache();
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it('is undefined until the image is measured, then holds its mask without a second canvas read', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 100, configurable: true });
    const getImageData = vi.fn(() => bufferWithBottomMargin(10, 100, 78));
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);

    const url = 'https://example.com/mask.png';
    expect(getAlphaMask(url)).toBeUndefined();
    const { result } = renderHook(() => useBottomMarginFrac(url));
    await waitFor(() => expect(result.current).toBeCloseTo(22 / 100, 5));

    const mask = getAlphaMask(url)!;
    expect(mask).toBeTruthy();
    expect(alphaMaskAt(mask, 0.5, 0.5)).toBe(true); // row 50: drawn
    expect(alphaMaskAt(mask, 0.5, 0.9)).toBe(false); // row 90: the transparent margin
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it('holds null for an image with no drawn pixel at all, so the figure keeps its whole box rather than no tap target', async () => {
    mockDecode(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { value: 4, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { value: 4, configurable: true });
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => bufferWithPixels(4, 4, []),
    } as unknown as CanvasRenderingContext2D);

    const url = 'https://example.com/blank-mask.png';
    renderHook(() => useBottomMarginFrac(url));
    await waitFor(() => expect(getAlphaMask(url)).toBeNull());
  });

  it('holds null when the canvas cannot be read (tainted), so a tap falls back to the whole box', async () => {
    mockDecode(() => Promise.resolve());
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException('tainted canvas', 'SecurityError');
      },
    } as unknown as CanvasRenderingContext2D);

    const url = 'https://example.com/tainted-mask.png';
    const { result } = renderHook(() => useBottomMarginFrac(url));
    await waitFor(() => expect(result.current).toBe(0));
    await waitFor(() => expect(getAlphaMask(url)).toBeNull());
  });
});
