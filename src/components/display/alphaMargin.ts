import { useEffect, useState } from 'preact/hooks';

/**
 * Minimal shape of ImageData needed here — decoupled from the DOM lib's
 * ImageData constructor so pure-function unit tests can build synthetic
 * fixtures directly, without a real canvas.
 */
export interface AlphaBuffer {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, top-to-bottom (matches
   *  CanvasRenderingContext2D#getImageData). */
  data: Uint8ClampedArray | number[];
}

/** Ignore near-transparent anti-aliasing dust — only real content counts. */
const ALPHA_THRESHOLD = 10;

/**
 * Fraction of the image's own height that's transparent padding BELOW the
 * figure's actual visible content (last opaque row from the bottom). This
 * is the gap that makes a figure "float" above the shelf line when grounded
 * by the image's own bottom edge instead of its visible feet — every matted
 * PNG carries a different amount of it, so it has to be measured per image,
 * not assumed.
 */
export function computeBottomMarginFrac(buffer: AlphaBuffer): number {
  const { width, height, data } = buffer;
  if (width <= 0 || height <= 0) return 0;

  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) {
        return (height - 1 - y) / height;
      }
    }
  }
  // Fully transparent image (shouldn't happen for a real matte) — nothing
  // to correct for; ground at the image's own bottom edge as before.
  return 0;
}

const marginCache = new Map<string, number>();
const pending = new Map<string, Promise<number>>();

/** Test-only: reset module-level caches between test cases. */
export function __clearAlphaMarginCache(): void {
  marginCache.clear();
  pending.clear();
}

async function measureBottomMarginFrac(imageUrl: string): Promise<number> {
  const cached = marginCache.get(imageUrl);
  if (cached !== undefined) return cached;
  const inFlight = pending.get(imageUrl);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      if (canvas.width === 0 || canvas.height === 0) return 0;

      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return computeBottomMarginFrac(imageData);
    } catch {
      // Tainted canvas (cross-origin image without CORS headers), decode
      // failure (broken URL), or no canvas 2D support — degrade to "no
      // correction" (today's object-fit:bottom behavior) rather than crash
      // the shelf over a single bad image.
      return 0;
    } finally {
      pending.delete(imageUrl);
    }
  })();

  pending.set(imageUrl, promise);
  const result = await promise;
  marginCache.set(imageUrl, result);
  return result;
}

/**
 * Bottom-margin fraction for a figure's image, measured from its real alpha
 * channel and cached by URL (so scrolling/re-rendering the same figure
 * never re-measures it). Returns 0 — no correction, i.e. today's grounding
 * behavior — until the async measurement resolves or if it fails; never
 * throws into the render tree.
 */
export function useBottomMarginFrac(imageUrl: string | undefined): number {
  const [frac, setFrac] = useState(() => (imageUrl ? (marginCache.get(imageUrl) ?? 0) : 0));

  useEffect(() => {
    if (!imageUrl) {
      setFrac(0);
      return;
    }
    const cached = marginCache.get(imageUrl);
    if (cached !== undefined) {
      setFrac(cached);
      return;
    }
    let cancelled = false;
    measureBottomMarginFrac(imageUrl).then((measured) => {
      if (!cancelled) setFrac(measured);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return frac;
}
