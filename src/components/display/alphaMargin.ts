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

/**
 * Horizontal contact-band measurement — a SIBLING to computeBottomMarginFrac
 * (same alpha-scan pipeline, independent hook/cache) rather than an
 * extension of it, so the existing vertical-grounding path/tests stay
 * untouched (Ross: "extend that hook (or add a sibling)").
 *
 * meta.footprintCenterX is hand-set per figure (mostly 0.5, image-centered)
 * — wrong whenever a figure's actual base is off-center (Ross: Ryuko's ice
 * base contacts the LEFT half of her image, so a 0.5-centered shadow lands
 * under empty space to her right). This measures the REAL horizontal
 * centroid of the opaque pixels in the figure's own bottom CONTACT BAND —
 * not just the single last-opaque-row (too thin/noisy — a boot tip or a
 * stray hair strand could skew it), a short band of rows just above it —
 * so it scales to every real (not hand-tuned) figure.
 */
const CONTACT_BAND_FRAC = 0.08; // bottom 8% of the image's own height

export interface ContactBand {
  /** Fractional horizontal center (0..1) of the opaque pixels in the
   *  bottom contact band — replaces meta.footprintCenterX. */
  centerXFrac: number;
  /** Fractional width (0..1) of that same band — replaces
   *  meta.footprintWidth. */
  widthFrac: number;
}

export function computeContactBand(buffer: AlphaBuffer): ContactBand | null {
  const { width, height, data } = buffer;
  if (width <= 0 || height <= 0) return null;

  // Same scan as computeBottomMarginFrac: find the last opaque row from
  // the bottom (the figure's own contact row).
  let contactRow = -1;
  for (let y = height - 1; y >= 0 && contactRow < 0; y--) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) {
        contactRow = y;
        break;
      }
    }
  }
  if (contactRow < 0) return null; // fully transparent — nothing to measure

  const bandHeight = Math.max(1, Math.round(height * CONTACT_BAND_FRAC));
  const bandTop = Math.max(0, contactRow - bandHeight + 1);

  let minX = width;
  let maxX = -1;
  for (let y = bandTop; y <= contactRow; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) return null; // shouldn't happen — contactRow found opaque content

  return {
    centerXFrac: (minX + maxX) / 2 / width,
    widthFrac: (maxX - minX) / width,
  };
}

const contactBandCache = new Map<string, ContactBand | null>();
const contactBandPending = new Map<string, Promise<ContactBand | null>>();

/** Test-only: reset module-level caches between test cases. */
export function __clearContactBandCache(): void {
  contactBandCache.clear();
  contactBandPending.clear();
}

async function measureContactBand(imageUrl: string): Promise<ContactBand | null> {
  const cached = contactBandCache.get(imageUrl);
  if (cached !== undefined) return cached;
  const inFlight = contactBandPending.get(imageUrl);
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
      if (canvas.width === 0 || canvas.height === 0) return null;

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return computeContactBand(imageData);
    } catch {
      // Tainted canvas / decode failure / no canvas 2D support — degrade to
      // null (caller falls back to the hand-set meta fields), never crash
      // the shelf over a single bad image.
      return null;
    } finally {
      contactBandPending.delete(imageUrl);
    }
  })();

  contactBandPending.set(imageUrl, promise);
  const result = await promise;
  contactBandCache.set(imageUrl, result);
  return result;
}

/**
 * Measured contact-band center/width for a figure's image, cached by URL.
 * Returns null — "not yet measured, or measurement failed" — until the
 * async measurement resolves; callers fall back to the hand-set
 * meta.footprintCenterX/footprintWidth in that case (the SAME
 * already-existing fallback behavior, just with a real measurement
 * available once it resolves).
 */
export function useContactBand(imageUrl: string | undefined): ContactBand | null {
  const [band, setBand] = useState<ContactBand | null>(() => (imageUrl ? (contactBandCache.get(imageUrl) ?? null) : null));

  useEffect(() => {
    if (!imageUrl) {
      setBand(null);
      return;
    }
    const cached = contactBandCache.get(imageUrl);
    if (cached !== undefined) {
      setBand(cached);
      return;
    }
    let cancelled = false;
    measureContactBand(imageUrl).then((measured) => {
      if (!cancelled) setBand(measured);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return band;
}
