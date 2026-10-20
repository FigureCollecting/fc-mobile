// SIZE-BASIS-1 (Ross 10-18, "makes me wonder if they got the size data or if they assumed height or scale"): what the case
// draws a figure at, and what that size rests on, for the Info card, the case's optional outline and the View card's count.
// Read off the packer's own resolution (sizeResolution.ts, as measureCaseFigure uses it), so the card never says a size is
// measured when the case guessed it:
//   height  the listing's, else the scale's nominal one (1600 mm / n), else the default
//   width   the listing's, else the picture's shape: held to the labelled length, else to the scale's height, only when the
//           height is itself an estimate (a labelled height stands: the picture is what it is)
//   depth   the listing's, else Ross's ratio of the width
// A figure is "sized from an estimate" when its height or its width is not the listing's. Its depth is not counted.
import type { Figure } from '@figurecollecting/fc-shared';
import { DEFAULT_FIGURE_HEIGHT_MM } from './packCabinets';
import { photoFitNote, type PhotoFit } from './photoFit';
import { MAX_PLAUSIBLE_HEIGHT_MM, resolveHeightMm, resolveWidthCap, type WidthCapBasis } from './sizeResolution';

export type HeightBasis = 'labeled' | 'scale' | 'default';

export interface SizeBasis {
  /** The height the case draws the figure at, in whole mm (a scraper-corrupted one read as the most any figure is). */
  heightMm: number;
  heightBasis: HeightBasis;
  widthBasis: 'labeled' | 'photo';
  /** When the width is from the photo and the height an estimate: the most it can be, and what that is the length or the scale's height of. */
  widthCapMm?: number;
  widthCapOf?: WidthCapBasis;
  depthBasis: 'labeled' | 'width';
  /** The height or the width is not the listing's. */
  estimated: boolean;
  /** FIT1: the photo is over 15 % off the listed width (the case's flag, when it has one). */
  photoFit?: PhotoFit;
  /** The Info card's line. */
  line: string;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const mm = (v: number): number => Math.round(v);

/** `photoFit`: what the case flagged of this figure's photo against its listed width (getPhotoFits), said at the end of the line. */
export function describeSize(figure: Figure, photoFit?: PhotoFit): SizeBasis {
  const d = figure.dimensions;
  const resolved = resolveHeightMm(figure);
  const heightBasis: HeightBasis = resolved === null ? 'default' : resolved.source === 'labeled' ? 'labeled' : 'scale';
  const heightMm = Math.min(resolved?.heightMm ?? DEFAULT_FIGURE_HEIGHT_MM, MAX_PLAUSIBLE_HEIGHT_MM);
  const widthBasis = positive(d?.widthMm) ? 'labeled' : 'photo';
  const depthBasis = positive(d?.depthMm) ? 'labeled' : 'width';
  const cap = heightBasis !== 'labeled' ? resolveWidthCap(figure) : null;
  const estimated = heightBasis !== 'labeled' || widthBasis !== 'labeled';

  const allListed = heightBasis === 'labeled' && widthBasis === 'labeled' && depthBasis === 'labeled' && resolved!.heightMm <= MAX_PLAUSIBLE_HEIGHT_MM;
  let line: string;
  if (allListed) {
    line = `${mm(resolved!.heightMm)} × ${mm(d!.widthMm!)} × ${mm(d!.depthMm!)} mm · measured`;
  } else {
    const height =
      heightBasis === 'labeled'
        ? resolved!.heightMm > MAX_PLAUSIBLE_HEIGHT_MM
          ? `${resolved!.heightMm} mm tall, read as ${MAX_PLAUSIBLE_HEIGHT_MM} mm`
          : `${mm(heightMm)} mm tall`
        : heightBasis === 'scale'
          ? `≈ ${mm(heightMm)} mm tall · from scale ${figure.scale.trim()}`
          : `≈ ${mm(heightMm)} mm · default, no size data`;
    const width =
      widthBasis === 'labeled'
        ? `${mm(d!.widthMm!)} mm wide`
        : cap === null
          ? 'width from the photo'
          : `width from the photo, at most ${mm(cap.capMm)} mm (${cap.basis === 'length' ? 'its length' : "its scale's height"})`;
    const depth = depthBasis === 'labeled' ? `${mm(d!.depthMm!)} mm deep` : 'depth from the width';
    line = [height, width, depth].join(' · ');
  }
  if (photoFit) line = `${line} · ${photoFitNote(photoFit)}`;
  return {
    heightMm: mm(heightMm),
    heightBasis,
    widthBasis,
    ...(widthBasis === 'photo' && cap !== null ? { widthCapMm: mm(cap.capMm), widthCapOf: cap.basis } : {}),
    depthBasis,
    estimated,
    ...(photoFit ? { photoFit } : {}),
    line,
  };
}

/** How many of these figures are sized from an estimate (describeSize). */
export function countEstimated(figures: readonly Figure[]): number {
  let n = 0;
  for (const f of figures) if (describeSize(f).estimated) n++;
  return n;
}
