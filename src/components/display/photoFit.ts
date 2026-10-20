import { useEffect, useState } from 'preact/hooks';

// FIT1 (Ross 10-19): when a figure's width is LISTED, the listing wins over its photo: the cut-out is scaled uniformly to fit
// inside the listed box (packCabinets measureCaseFigure). A photo whose figure, at the figure's height, is more than
// PHOTO_FIT_FLAG wider or narrower than the listed width is flagged: the case marks the figure (data-photo-fit) and its Info
// card's Size row says so (sizeBasis.ts), so Ross can check a listing that disagrees with its photo.

/** A mismatch over this share of the listed width is flagged (strictly over: exactly 15 % is not). */
export const PHOTO_FIT_FLAG = 0.15;

export interface PhotoFit {
  /** The photo's figure is wider or narrower than the listed width. */
  readonly dir: 'wider' | 'narrower';
  /** By how many whole per cent of the listed width. */
  readonly pct: number;
}

/** The flag for a photo's width against the listed one, or undefined within PHOTO_FIT_FLAG of it. */
export function photoFitOf(photoWidthMm: number, listedWidthMm: number): PhotoFit | undefined {
  const diff = (photoWidthMm - listedWidthMm) / listedWidthMm;
  if (!(Math.abs(diff) > PHOTO_FIT_FLAG)) return undefined;
  return { dir: diff > 0 ? 'wider' : 'narrower', pct: Math.round(Math.abs(diff) * 100) };
}

/** What the Info card's Size row says of it. */
export const photoFitNote = (fit: PhotoFit): string =>
  fit.dir === 'wider' ? `photo ${fit.pct} % wider than listed: drawn to the listing` : `photo ${fit.pct} % narrower than listed: drawn at the listed height`;

// The flags of the figures the case draws now, by figure id: CabinetScene sets them, the Info card reads them. A plain store with
// a hook, not a signal: importing @preact/signals installs its re-render skipping into everything that imports it, and the
// packer's import graph is no place for that.
let flags: ReadonlyMap<string, PhotoFit> = new Map();
const listeners = new Set<() => void>();

export const getPhotoFits = (): ReadonlyMap<string, PhotoFit> => flags;

export function setPhotoFits(next: ReadonlyMap<string, PhotoFit>): void {
  flags = next;
  for (const l of [...listeners]) l();
}

/** One figure's flag, kept current: the Info card re-renders when the case flags or unflags it. */
export function usePhotoFit(figureId: string): PhotoFit | undefined {
  const [, redraw] = useState(0);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return flags.get(figureId);
}
