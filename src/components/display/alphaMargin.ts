import { useEffect, useMemo, useState } from 'preact/hooks';

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

/**
 * Fraction of the image's own height that is transparent padding ABOVE the
 * figure's visible content (its first opaque row from the top): without it,
 * a figure sized by its picture's height draws short by that much (true
 * scale, Ross 09-26). 0 for a fully transparent or empty image.
 */
export function computeTopMarginFrac(buffer: AlphaBuffer): number {
  const { width, height, data } = buffer;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) return y / height;
    }
  }
  return 0;
}

/**
 * Fractions of the image's own width that are clear LEFT of the figure's
 * first opaque column and RIGHT of its last: the part of its picture's width
 * a cut-out does not draw, so the case can pack it by what it draws. Both 0
 * for a fully clear or empty image.
 */
export function computeSideMarginFracs(buffer: AlphaBuffer): { left: number; right: number } {
  const { width, height, data } = buffer;
  let x0 = width;
  let x1 = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  if (x1 < 0) return { left: 0, right: 0 };
  return { left: x0 / width, right: (width - 1 - x1) / width };
}

/** Cells on a mask's long side: about one per CSS px of the tallest figure
 *  a shelf draws (the comfortable band is 216 px), at most 8 KB a mask. */
export const ALPHA_MASK_MAX_CELLS = 256;

/**
 * Where an image is drawn, on a grid of at most ALPHA_MASK_MAX_CELLS cells a
 * side: a cell is set when ANY pixel it covers is past ALPHA_THRESHOLD, so a
 * thin strand never drops out. One bit per cell, row-major.
 */
export interface AlphaMask {
  width: number;
  height: number;
  bits: Uint8Array;
  /** How many cells are set. */
  drawn: number;
}

export function computeAlphaMask(buffer: AlphaBuffer): AlphaMask | null {
  const { width, height, data } = buffer;
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, ALPHA_MASK_MAX_CELLS / Math.max(width, height));
  const maskWidth = Math.ceil(width * scale);
  const maskHeight = Math.ceil(height * scale);
  const bits = new Uint8Array(Math.ceil((maskWidth * maskHeight) / 8));
  let drawn = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    const cellRow = Math.floor((y * maskHeight) / height) * maskWidth;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] <= ALPHA_THRESHOLD) continue;
      const cell = cellRow + Math.floor((x * maskWidth) / width);
      const bit = 1 << (cell & 7);
      if (!(bits[cell >> 3] & bit)) {
        bits[cell >> 3] |= bit;
        drawn++;
      }
    }
  }
  return { width: maskWidth, height: maskHeight, bits, drawn };
}

/**
 * Whether the image is drawn anywhere in the rectangle from (u0, v0) to
 * (u1, v1), in fractions of the image across and down (0..1; the part
 * outside the image reads as clear).
 */
export function alphaMaskDrawnIn(mask: AlphaMask, u0: number, v0: number, u1: number, v1: number): boolean {
  const x0 = Math.max(0, Math.floor(u0 * mask.width));
  const x1 = Math.min(mask.width - 1, Math.ceil(u1 * mask.width) - 1);
  const y0 = Math.max(0, Math.floor(v0 * mask.height));
  const y1 = Math.min(mask.height - 1, Math.ceil(v1 * mask.height) - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = y * mask.width + x;
      if (mask.bits[cell >> 3] & (1 << (cell & 7))) return true;
    }
  }
  return false;
}

/** A picture's clear margins around the figure: above and below as fractions of its height, left and right of its width. */
export interface AlphaMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const NO_MARGINS: AlphaMargins = { top: 0, bottom: 0, left: 0, right: 0 };
const marginCache = new Map<string, AlphaMargins>();
const pending = new Map<string, Promise<AlphaMargins>>();
/** null: measured, but no usable mask (unreadable, or nothing drawn). */
const maskCache = new Map<string, AlphaMask | null>();
/** null: measured, but no contact band (unreadable, or nothing drawn); filled by the same read as the margins. */
const contactBandCache = new Map<string, ContactBand | null>();

/**
 * How many pictures are read at once, and how many more may still be going
 * after running out of time (ALPHA_READ_TURN_MS): at most twice this in
 * flight, a read ending when it lands or is abandoned at its deadline
 * (ALPHA_READ_DEADLINE_MS). So the case never decodes all of a long list's
 * pictures together for its canvas reads (margins, mask and contact band:
 * one read per picture), even on a stalled network.
 */
export const ALPHA_READS_AT_ONCE = 4;
/**
 * A read still going after this long gives up its turn to the next picture
 * (while fewer than ALPHA_READS_AT_ONCE others are out of time) and goes on
 * until its deadline, so one stalled picture never holds the rest up.
 */
export const ALPHA_READ_TURN_MS = 1500;
/**
 * A read not done this long after it starts is abandoned: its src cleared,
 * so the browser cancels its request, and nothing of it is kept. So however
 * many pictures stall, the rest wait at most this long for room to be read.
 */
export const ALPHA_READ_DEADLINE_MS = 8000;
/**
 * How many more times an abandoned picture is read, each behind the reads
 * waiting then, before it is taken as a failed read (all 0: packed by its
 * whole picture).
 */
export const ALPHA_READ_RETRIES = 2;
/** Reads holding a turn. */
let reading = 0;
/** Reads that gave up their turn, still going: at most ALPHA_READS_AT_ONCE. */
let overdue = 0;
/** Reads waiting for a turn. */
const queued: (() => void)[] = [];
/** Reads out of time, holding their turns until one of the overdue reads ends. */
const outOfTime: (() => void)[] = [];

/** A turn ends: it goes to the next read waiting, or is free. */
function passTurn(): void {
  const next = queued.shift();
  if (next) next();
  else reading--;
}

/**
 * Run one read when a turn is free. A finished read hands its turn to the
 * next one waiting; one out of time hands it on too, while fewer than
 * ALPHA_READS_AT_ONCE others are overdue, else when one of them ends.
 */
async function inTurn<T>(read: () => Promise<T>): Promise<T> {
  if (reading < ALPHA_READS_AT_ONCE) reading++;
  else await new Promise<void>((go) => queued.push(go));
  let late = false;
  const giveUpTurn = () => {
    if (overdue >= ALPHA_READS_AT_ONCE) {
      outOfTime.push(giveUpTurn);
      return;
    }
    overdue++;
    late = true;
    passTurn();
  };
  const timer = setTimeout(giveUpTurn, ALPHA_READ_TURN_MS);
  try {
    return await read();
  } finally {
    clearTimeout(timer);
    if (late) {
      overdue--;
      outOfTime.shift()?.();
    } else {
      const waiting = outOfTime.indexOf(giveUpTurn);
      if (waiting >= 0) outOfTime.splice(waiting, 1);
      passTurn();
    }
  }
}

/** Test-only: reset module-level caches between test cases. */
export function __clearAlphaMarginCache(): void {
  marginCache.clear();
  pending.clear();
  maskCache.clear();
  contactBandCache.clear();
  reading = 0;
  overdue = 0;
  queued.length = 0;
  outOfTime.length = 0;
}

/**
 * The drawn-pixel mask of a matted figure's image, from the same canvas read
 * that measures its bottom margin (useBottomMarginFrac): undefined until that
 * measurement finishes, null when it failed or the image draws nothing —
 * callers then treat the figure's whole box as drawn.
 */
export function getAlphaMask(imageUrl: string): AlphaMask | null | undefined {
  return maskCache.get(imageUrl);
}

/** What one canvas read of a picture gives: its clear margins, its drawn-pixel mask and its contact band. */
interface AlphaRead {
  margins: AlphaMargins;
  mask: AlphaMask | null;
  band: ContactBand | null;
}

/** A read that failed: no margins, no mask, no contact band (the figure packed and grounded by its whole picture). */
const FAILED_READ: AlphaRead = { margins: NO_MARGINS, mask: null, band: null };

/** One canvas read of a picture; null when abandoned at its deadline (ALPHA_READ_DEADLINE_MS). Never throws. */
async function readAlpha(imageUrl: string): Promise<AlphaRead | null> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    const inTime = await Promise.race([
      img.decode().then(() => true),
      new Promise<false>((stop) => {
        deadline = setTimeout(() => stop(false), ALPHA_READ_DEADLINE_MS);
      }),
    ]);
    if (!inTime) {
      // abandoned: the browser cancels its request; its decode, still pending, ends in nothing
      img.src = '';
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    if (canvas.width === 0 || canvas.height === 0) return FAILED_READ;

    const ctx = canvas.getContext('2d');
    if (!ctx) return FAILED_READ;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      margins: { top: computeTopMarginFrac(imageData), bottom: computeBottomMarginFrac(imageData), ...computeSideMarginFracs(imageData) },
      mask: computeAlphaMask(imageData),
      band: computeContactBand(imageData),
    };
  } catch {
    // Tainted canvas (cross-origin image without CORS headers), decode
    // failure (broken URL), or no canvas 2D support — degrade to "no
    // correction" (today's object-fit:bottom behavior) rather than crash
    // the shelf over a single bad image.
    return FAILED_READ;
  } finally {
    clearTimeout(deadline);
  }
}

/** A picture read in turn (inTurn); one abandoned is read again behind the reads waiting, ALPHA_READ_RETRIES times, then failed. */
async function readInTurn(imageUrl: string): Promise<AlphaRead> {
  for (let tries = 0; tries <= ALPHA_READ_RETRIES; tries++) {
    const read = await inTurn(() => readAlpha(imageUrl));
    if (read) return read;
  }
  return FAILED_READ;
}

/** A picture's clear margins, read once in turn (readInTurn) and cached by URL with its mask and contact band; known in the cache when this resolves. */
function measureAlphaMargins(imageUrl: string): Promise<AlphaMargins> {
  const cached = marginCache.get(imageUrl);
  if (cached !== undefined) return Promise.resolve(cached);
  const inFlight = pending.get(imageUrl);
  if (inFlight) return inFlight;

  const promise = readInTurn(imageUrl).then(({ margins, mask, band }) => {
    marginCache.set(imageUrl, margins);
    maskCache.set(imageUrl, mask && mask.drawn > 0 ? mask : null);
    contactBandCache.set(imageUrl, band);
    pending.delete(imageUrl);
    return margins;
  });
  pending.set(imageUrl, promise);
  return promise;
}

/**
 * Bottom-margin fraction for a figure's image, measured from its real alpha
 * channel and cached by URL (so scrolling/re-rendering the same figure
 * never re-measures it). Returns 0 — no correction, i.e. today's grounding
 * behavior — until the async measurement resolves or if it fails; never
 * throws into the render tree.
 */
export function useBottomMarginFrac(imageUrl: string | undefined): number {
  const [frac, setFrac] = useState(() => (imageUrl ? (marginCache.get(imageUrl)?.bottom ?? 0) : 0));

  useEffect(() => {
    if (!imageUrl) {
      setFrac(0);
      return;
    }
    const cached = marginCache.get(imageUrl);
    if (cached !== undefined) {
      setFrac(cached.bottom);
      return;
    }
    let cancelled = false;
    measureAlphaMargins(imageUrl).then((measured) => {
      if (!cancelled) setFrac(measured.bottom);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return frac;
}

/** The margins of every picture in `urls` the cache knows; one not read yet is left out. */
function knownMargins(urls: readonly string[]): Map<string, AlphaMargins> {
  const out = new Map<string, AlphaMargins>();
  for (const url of urls) {
    const margins = marginCache.get(url);
    if (margins !== undefined) out.set(url, margins);
  }
  return out;
}

/** Reads that land within this long of the first one not yet answered are answered together: one relayout, not one per picture. */
export const ALPHA_LANDING_BATCH_MS = 100;

/**
 * The clear margins of each picture in `urls` (the case's whole list: it
 * packs every figure by what it draws) known so far, each read once and
 * cached by URL across lists. A picture is in the answer as soon as it is
 * read (a failed read is known too: all 0), so a slow or stalled one holds
 * back only its own figure: it gives up its turn (ALPHA_READ_TURN_MS) and
 * is abandoned at its deadline (ALPHA_READ_DEADLINE_MS), so the others
 * are read meanwhile (when more than ALPHA_READS_AT_ONCE stall together,
 * the next wait at most that deadline), and it is read again later
 * (ALPHA_READ_RETRIES), unknown till then; reads landing together are one answer
 * (ALPHA_LANDING_BATCH_MS), and the last picture of the list answers at
 * once. A list whose pictures are cached is known at once, and a new list
 * keeps every picture it shares with the old.
 */
export function useAlphaMarginsOf(urls: readonly string[]): ReadonlyMap<string, AlphaMargins> {
  const key = urls.join('\n');
  const [answered, setAnswered] = useState(0);
  // `key` stands for `urls` (a new array on every render of the same list)
  const known = useMemo(() => knownMargins(urls), [key, answered]);

  useEffect(() => {
    // what this render did not know: a read landing between the render and this effect is answered too
    const unread = urls.filter((url) => !known.has(url));
    if (unread.length === 0) return;
    let current = true;
    let batch: ReturnType<typeof setTimeout> | undefined;
    let left = unread.length;
    const answer = () => {
      clearTimeout(batch);
      batch = undefined;
      setAnswered((n) => n + 1);
    };
    for (const url of unread) {
      void measureAlphaMargins(url).then(() => {
        if (!current) return;
        left--;
        if (left === 0) answer();
        else batch ??= setTimeout(answer, ALPHA_LANDING_BATCH_MS);
      });
    }
    return () => {
      current = false;
      clearTimeout(batch);
    };
  }, [key]);

  return known;
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

/** Test-only: reset the contact bands known (the reads that fill them are reset by __clearAlphaMarginCache, which clears these too). */
export function __clearContactBandCache(): void {
  contactBandCache.clear();
}

/**
 * A picture's contact band, from the same read in turn as its margins
 * (measureAlphaMargins): one decode per picture, in the case's read queue;
 * null when that read failed or the picture draws nothing.
 */
async function measureContactBand(imageUrl: string): Promise<ContactBand | null> {
  await measureAlphaMargins(imageUrl);
  return contactBandCache.get(imageUrl) ?? null;
}

/**
 * Measured contact-band center/width for a figure's image, cached by URL
 * and read with its margins (measureContactBand: one read per picture, in turn).
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
