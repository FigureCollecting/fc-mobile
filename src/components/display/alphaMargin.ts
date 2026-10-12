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
/** Pictures whose last read never decoded them (UNDECODED): their own picture loading reads them again. */
const undecoded = new Set<string>();
/** Pictures whose own picture loaded before any read of them landed: each reader of them carries a read again (Reader.retryUndecoded). */
const loadedUnread = new Set<string>();
/** What each view does when a picture is read again on its own load after it never decoded (alphaPictureLoaded). */
const rereadViews = new Set<(imageUrl: string, read: AlphaRead) => void>();

/**
 * How many pictures are read at once, and how many more may still be going
 * after running out of time (ALPHA_READ_TURN_MS): at most twice this in
 * flight, a read ending when it lands or is abandoned at its deadline
 * (ALPHA_READ_DEADLINE_MS). So the case never decodes all of a long list's
 * pictures together for its canvas reads (margins, mask and contact band:
 * one read per picture), on a slow or stalled network too. Of those in
 * flight, at most this many are re-reads of pictures whose read ran out of
 * time, so re-reads never hold every turn.
 */
export const ALPHA_READS_AT_ONCE = 4;
/**
 * A read still going after this long, slow or stalled, gives up its turn to
 * the next picture (while fewer than ALPHA_READS_AT_ONCE others are out of
 * time) and goes on until it lands or reaches its deadline. So up to
 * ALPHA_READS_AT_ONCE slow or stalled reads hold the rest up at most this
 * long; with more, the line moves as each read out of time lands or is
 * abandoned. Once only re-reads of stalled pictures are left in flight, a
 * new picture's first read starts within this long, however many stall.
 */
export const ALPHA_READ_TURN_MS = 1500;
/**
 * A picture's first read not done this long after it starts is abandoned,
 * and each later read of it is given twice the time of the one before, up
 * to ALPHA_READ_DEADLINE_MAX_MS. Abandoned: its src cleared and nothing of
 * it kept, so it leaves the room it holds. The browser drops its request
 * when the read alone fetches the picture; when the figure's own copy is
 * still downloading (cross-origin, HTTP cache on, as in production) that
 * download goes on and the read was waiting on it, so abandoning frees a
 * decode slot, not bandwidth. Running out of time is never a failed read:
 * the figure stays a plate until a later read lands (ALPHA_READ_BACKOFF_MS,
 * alphaPictureLoaded).
 */
export const ALPHA_READ_DEADLINE_MS = 8000;
/**
 * The most time one read is given: a picture whose fetch takes longer than
 * the first deadline, but no longer than this, is read on a later try with
 * no HTTP cache to help; a stalled one holds its room at most this long a
 * try.
 */
export const ALPHA_READ_DEADLINE_MAX_MS = 32000;
/**
 * How long a picture whose read ran out of time waits before it is queued
 * again, behind every first read waiting: this, doubling each time, up to
 * ALPHA_READ_BACKOFF_MAX_MS, with no limit on tries while a view wants the
 * picture. Its own picture loading (alphaPictureLoaded) ends the wait.
 */
export const ALPHA_READ_BACKOFF_MS = 1500;
export const ALPHA_READ_BACKOFF_MAX_MS = 15000;
/** Reads holding a turn. */
let reading = 0;
/** Reads that gave up their turn, still going: at most ALPHA_READS_AT_ONCE. */
let overdue = 0;
/**
 * Re-reads in flight, holding a turn or given it up: reads of a picture
 * whose last read ran out of time, but for one its own picture loading sent
 * at once. At most ALPHA_READS_AT_ONCE, so however many pictures stall,
 * their re-reads never hold every turn.
 */
let rereading = 0;
/** A read waiting for a turn: `go` starts it, saying whether it counts as a re-read. */
interface Waiting {
  go: (again: boolean) => void;
  /** A re-read: it starts only while fewer than ALPHA_READS_AT_ONCE re-reads are in flight. */
  again: boolean;
}
/**
 * Reads waiting for a turn: those sent at once by their picture loading,
 * then first reads, then re-reads, each in the order they came. So a new
 * picture never waits behind re-reads of stalled ones.
 */
const queued: Waiting[] = [];
/**
 * Reads out of time, holding their turns until one of the overdue reads
 * ends. Which of them then gives its turn up is not observable: whichever
 * it is, each later end frees the same room.
 */
const outOfTime: (() => void)[] = [];

/** The read at the front of the line starts, unless it is a re-read and re-reads fill their room: whether it started. */
function startNext(): boolean {
  const next = queued[0];
  if (!next || (next.again && rereading >= ALPHA_READS_AT_ONCE)) return false;
  queued.shift();
  if (next.again) rereading++;
  next.go(next.again);
  return true;
}

/** A turn ends: it goes to the next read that may start, or is free. */
function passTurn(): void {
  if (!startNext()) reading--;
}

/** A read joins the line, a re-read ends or a load sends one at once: the read at the front starts if a turn is free. */
function startOnFreeTurn(): void {
  if (reading < ALPHA_READS_AT_ONCE && startNext()) reading++;
}

/**
 * How many mounted hooks show each picture, read or not: a read of it starts
 * only while one does (the life of its view).
 */
const wantedBy = new Map<string, number>();

/** A hook wants `imageUrl` read until it calls what this returns. */
function want(imageUrl: string): () => void {
  wantedBy.set(imageUrl, (wantedBy.get(imageUrl) ?? 0) + 1);
  return () => {
    const left = wantedBy.get(imageUrl)! - 1;
    if (left > 0) wantedBy.set(imageUrl, left);
    else wantedBy.delete(imageUrl);
  };
}

/** A picture being read until a read of it lands. */
interface Reader {
  /** How many of its reads ran out of time. */
  timedOut: number;
  /** Its own picture loaded while a read of it was in flight: if that read runs out of time, the next goes at once. */
  loaded: boolean;
  /** Set while it waits (out its backoff, or in line): sends it to the front of the line at once. */
  hurry?: () => void;
  /**
   * Its own picture has loaded, so it decodes: the next read that never
   * decodes it, whenever it runs, failed to fetch it and goes again at once.
   * One load, one read again.
   */
  retryUndecoded: boolean;
}
const readers = new Map<string, Reader>();

/**
 * Run one read when a turn is free (`first`: sent at once by its picture
 * loading, at the front of the line; else a first read goes ahead of the
 * re-reads waiting, a re-read behind them all). A finished read hands its
 * turn to the next one that may start; one out of time hands it on too,
 * while fewer than ALPHA_READS_AT_ONCE others are overdue, else when one of
 * them ends.
 */
async function inTurn<T>(read: () => Promise<T>, reader: Reader, first: boolean): Promise<T> {
  const again = await new Promise<boolean>((go) => {
    const waiting: Waiting = { go, again: reader.timedOut > 0 && !first };
    if (first) queued.unshift(waiting);
    else if (waiting.again) queued.push(waiting);
    else {
      const rereads = queued.findIndex((w) => w.again);
      queued.splice(rereads < 0 ? queued.length : rereads, 0, waiting);
    }
    reader.hurry = () => {
      // sent at once by its picture loading (a cache hit then): no longer held back as a re-read
      waiting.again = false;
      const at = queued.indexOf(waiting);
      if (at > 0) queued.unshift(...queued.splice(at, 1));
      startOnFreeTurn();
    };
    startOnFreeTurn();
  });
  reader.hurry = undefined;
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
    if (again) rereading--;
    if (late) {
      overdue--;
      outOfTime.shift()?.();
      startOnFreeTurn();
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
  rereading = 0;
  queued.length = 0;
  outOfTime.length = 0;
  wantedBy.clear();
  readers.clear();
  undecoded.clear();
  loadedUnread.clear();
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
/**
 * A failed read whose picture never decoded: a broken picture, or one the
 * read failed to fetch (a network or HTTP error, or no CORS answer), which
 * decode() cannot tell apart. Its own picture loading reads it again
 * (alphaPictureLoaded): a broken picture never loads.
 */
const UNDECODED: AlphaRead = { ...FAILED_READ };

/**
 * One canvas read of a picture, given `deadlineMs`; null when abandoned at
 * that deadline, UNDECODED when the picture never decoded, a failed read
 * for any other error. Never throws.
 */
async function readAlpha(imageUrl: string, deadlineMs: number): Promise<AlphaRead | null> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    const inTime = await Promise.race([
      img.decode().then(
        () => true,
        () => undefined,
      ),
      new Promise<false>((stop) => {
        deadline = setTimeout(() => stop(false), deadlineMs);
      }),
    ]);
    if (inTime === undefined) return UNDECODED;
    if (!inTime) {
      // abandoned: dropped with nothing kept (its request too, unless the figure's own picture is fetching it)
      img.src = '';
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    // no 2D canvas (null) or a picture of no size (getImageData throws): a failed read, in the catch
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      margins: { top: computeTopMarginFrac(imageData), bottom: computeBottomMarginFrac(imageData), ...computeSideMarginFracs(imageData) },
      mask: computeAlphaMask(imageData),
      band: computeContactBand(imageData),
    };
  } catch {
    // Any other error, never a timeout: no canvas 2D support, no size or a
    // tainted canvas — degrade to "no correction" (packed and grounded by
    // its whole picture) rather than crash the shelf over one bad image.
    return FAILED_READ;
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * A picture read in turn (inTurn) until a read lands; undefined when no
 * view wants it any more as its turn comes. A read that runs out of time is
 * never a failed read: the picture waits its backoff (ALPHA_READ_BACKOFF_MS)
 * and is queued again behind every first read, the next read given twice
 * the time (ALPHA_READ_DEADLINE_MS); its own picture loading
 * (alphaPictureLoaded) sends it to the front at once instead. Once it has
 * loaded, a read that never decodes the picture (the one its load sends, one
 * in flight as it loads, or any later) failed to fetch it: it is read again
 * at once (`first`: from the start), once per load.
 */
async function readInTurn(imageUrl: string, first = false): Promise<AlphaRead | undefined> {
  // `first`: sent by its own picture loading, whose read again it carries, as does a load before any read landed
  const reader: Reader = { timedOut: 0, loaded: false, retryUndecoded: first || loadedUnread.has(imageUrl) };
  readers.set(imageUrl, reader);
  for (;;) {
    const deadlineMs = Math.min(ALPHA_READ_DEADLINE_MS * 2 ** reader.timedOut, ALPHA_READ_DEADLINE_MAX_MS);
    const read = await inTurn(async () => (wantedBy.has(imageUrl) ? readAlpha(imageUrl, deadlineMs) : undefined), reader, first);
    if (read === UNDECODED && reader.retryUndecoded) {
      reader.retryUndecoded = false;
      reader.loaded = false;
      first = true;
      continue;
    }
    if (read !== null) {
      readers.delete(imageUrl);
      return read;
    }
    reader.timedOut++;
    first = reader.loaded;
    reader.loaded = false;
    if (!first) {
      const backoffMs = Math.min(ALPHA_READ_BACKOFF_MS * 2 ** (reader.timedOut - 1), ALPHA_READ_BACKOFF_MAX_MS);
      // its wait in line (inTurn) replaces this hurry at once, and clears it as its read starts
      first = await new Promise<boolean>((go) => {
        const wait = setTimeout(() => go(false), backoffMs);
        reader.hurry = () => {
          clearTimeout(wait);
          go(true);
        };
      });
    }
  }
}

/**
 * The figure's own picture of `imageUrl` has loaded, so a read of it now is
 * a cache hit: one that ran out of time is read again at once, at the front
 * of the line, and one waiting in line moves to its front. A read in flight
 * goes on; if it runs out of time, the next starts at once. The next read
 * that never decodes the picture, whenever it runs, failed to fetch it: it
 * is read again at once, once per load. A picture whose last read never
 * decoded it (the read failed to fetch it) is read again, at the front of
 * the line, and the views showing it learn what that read gives. One not
 * read yet: its first read, if it never decodes the picture, goes again at
 * once. Any other (read already): nothing.
 */
export function alphaPictureLoaded(imageUrl: string): void {
  const reader = readers.get(imageUrl);
  if (reader) {
    reader.retryUndecoded = true;
    if (reader.hurry) reader.hurry();
    else reader.loaded = true;
  } else if (undecoded.has(imageUrl)) {
    void readInTurn(imageUrl, true).then((read) => {
      // its views gone before its turn: nothing kept, its next load reads it again
      if (!read) return;
      keep(imageUrl, read);
      for (const tell of rereadViews) tell(imageUrl, read);
    });
  } else if (!marginCache.has(imageUrl)) loadedUnread.add(imageUrl);
}

/** What a read of a picture gives, kept by its URL. */
function keep(imageUrl: string, read: AlphaRead): void {
  marginCache.set(imageUrl, read.margins);
  maskCache.set(imageUrl, read.mask && read.mask.drawn > 0 ? read.mask : null);
  contactBandCache.set(imageUrl, read.band);
  loadedUnread.delete(imageUrl);
  if (read === UNDECODED) undecoded.add(imageUrl);
  else undecoded.delete(imageUrl);
}

/** While mounted, `tell` hears of each picture read again on its own load after it never decoded (alphaPictureLoaded). */
function useRereads(tell: (imageUrl: string, read: AlphaRead) => void, key: string | undefined): void {
  useEffect(() => {
    rereadViews.add(tell);
    return () => {
      rereadViews.delete(tell);
    };
  }, [key]);
}

/**
 * A picture's clear margins, read once in turn (readInTurn) and cached by
 * URL with its mask and contact band; known in the cache when this
 * resolves. Never resolves when its view is gone before it is read: the
 * next view to want it reads it afresh.
 */
function measureAlphaMargins(imageUrl: string): Promise<AlphaMargins> {
  const cached = marginCache.get(imageUrl);
  if (cached !== undefined) return Promise.resolve(cached);
  const inFlight = pending.get(imageUrl);
  if (inFlight) return inFlight;

  const promise = readInTurn(imageUrl).then((read) => {
    pending.delete(imageUrl);
    if (!read) return new Promise<AlphaMargins>(() => {});
    keep(imageUrl, read);
    return read.margins;
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
  useRereads((url, read) => {
    if (url === imageUrl) setFrac(read.margins.bottom);
  }, imageUrl);

  useEffect(() => {
    if (!imageUrl) {
      setFrac(0);
      return;
    }
    // wanted while shown, read or not: its own load may read it again (alphaPictureLoaded)
    const unwant = want(imageUrl);
    const cached = marginCache.get(imageUrl);
    if (cached !== undefined) {
      setFrac(cached.bottom);
      return unwant;
    }
    let cancelled = false;
    measureAlphaMargins(imageUrl).then((measured) => {
      if (!cancelled) setFrac(measured.bottom);
    });
    return () => {
      cancelled = true;
      unwant();
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
 * read. A failed read is known too, all 0: no 2D canvas, no size or a
 * tainted canvas, or a picture that never decoded, broken or failing to
 * fetch (a network or HTTP error during the read, or no CORS answer);
 * decode() cannot tell those apart, so one whose own picture then loads
 * (alphaPictureLoaded: a cut-out's) is read again and answered anew. A slow
 * or stalled one keeps only its own figure unknown, a plate, and is never a
 * failed read for running out of time: it gives up its turn after
 * ALPHA_READ_TURN_MS and is abandoned at its deadline
 * (ALPHA_READ_DEADLINE_MS, longer each try), then read again after a backoff
 * (ALPHA_READ_BACKOFF_MS) for as long as this list is shown, and at once
 * when its own picture loads (alphaPictureLoaded). So a picture that arrives
 * is read, however slow the link: by the first try to find it in the HTTP
 * cache (a cut-out's at once, as its own picture loads), or to be given the
 * time its fetch takes (ALPHA_READ_DEADLINE_MAX_MS at most). The others are
 * read meanwhile: slow or stalled reads delay them at most
 * ALPHA_READ_TURN_MS while no more than ALPHA_READS_AT_ONCE are out of time
 * together; more move through the room 2 x ALPHA_READS_AT_ONCE at a time,
 * each until it lands or reaches its deadline. A new picture never waits
 * behind re-reads: first reads go ahead of them in line, and re-reads hold
 * at most ALPHA_READS_AT_ONCE of the room. Reads landing together are one
 * answer (ALPHA_LANDING_BATCH_MS), and the last picture of the list answers
 * at once. A list whose pictures are cached is known at once, and a new list
 * keeps every picture it shares with the old.
 */
export function useAlphaMarginsOf(urls: readonly string[]): ReadonlyMap<string, AlphaMargins> {
  const key = urls.join('\n');
  const [answered, setAnswered] = useState(0);
  // `key` stands for `urls` (a new array on every render of the same list)
  const known = useMemo(() => knownMargins(urls), [key, answered]);
  useRereads((url) => {
    if (urls.includes(url)) setAnswered((n) => n + 1);
  }, key);

  useEffect(() => {
    // every picture of the list wanted while it is shown, read or not: its own load may read it again (alphaPictureLoaded)
    const unwant = urls.map(want);
    const unwantAll = () => {
      for (const done of unwant) done();
    };
    // what this render did not know: a read landing between the render and this effect is answered too
    const unread = urls.filter((url) => !known.has(url));
    if (unread.length === 0) return unwantAll;
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
      unwantAll();
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
  useRereads((url, read) => {
    if (url === imageUrl) setBand(read.band);
  }, imageUrl);

  useEffect(() => {
    if (!imageUrl) {
      setBand(null);
      return;
    }
    // wanted while shown, read or not: its own load may read it again (alphaPictureLoaded)
    const unwant = want(imageUrl);
    const cached = contactBandCache.get(imageUrl);
    if (cached !== undefined) {
      setBand(cached);
      return unwant;
    }
    let cancelled = false;
    measureContactBand(imageUrl).then((measured) => {
      if (!cancelled) setBand(measured);
    });
    return () => {
      cancelled = true;
      unwant();
    };
  }, [imageUrl]);

  return band;
}
