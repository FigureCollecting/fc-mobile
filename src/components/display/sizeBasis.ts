// SIZE-BASIS-1 (Ross 10-18, "makes me wonder if they got the size data or if they assumed height or scale"): what the case
// draws a figure at, and what that size rests on, for the Info card, the case's optional outline and the View card's count.
// Read off the packer's own resolution (sizeResolution.ts, as measureCaseFigure uses it), so the card never says a size is
// measured when the case guessed it:
//   height  the listing's, else (a width listed) the height at which the photo is that wide, else the scale's nominal one
//           (1600 mm / n), else the default
//   (SIZE-L3: a lone listed length, no height and no width, is the figure's longest side: the height when the picture is tall,
//   the width when it is wide, the other side from the picture's shape; the scale is ignored)
//   width   the listing's, else the picture's shape: held to the labelled length, else to the scale's height, only when the
//           height is itself an estimate (a labelled height stands: the picture is what it is)
//   depth   the listing's, else Ross's ratio of the width
// A figure is "sized from an estimate" when its height or its width is not the listing's. Its depth is not counted.
import type { Figure } from '@figurecollecting/fc-shared';
import { DEFAULT_FIGURE_HEIGHT_MM } from './packCabinets';
import { photoFitNote, type PhotoFit } from './photoFit';
import { MAX_PLAUSIBLE_HEIGHT_MM, resolveHeightMm, resolveLoneLength, resolveWidthCap, type WidthCapBasis } from './sizeResolution';

export type HeightBasis = 'labeled' | 'length' | 'photo' | 'scale' | 'default';

export interface SizeBasis {
  /** The height the case draws the figure at, in whole mm (a scraper-corrupted one read as the most any figure is). */
  heightMm: number;
  heightBasis: HeightBasis;
  widthBasis: 'labeled' | 'length' | 'photo';
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

/**
 * `photoFit`: what the case flagged of this figure's photo against its listed width (getPhotoFits), said at the end of the line.
 * `aspect`: the picture's width over its height, when the caller has it; a listed width with no listed height is then said with the
 * height it gives, else without a number (the basis is the same).
 */
export function describeSize(figure: Figure, photoFit?: PhotoFit, aspect?: number): SizeBasis {
  const d = figure.dimensions;
  const widthListed = positive(d?.widthMm);
  const resolved = resolveHeightMm(figure, aspect);
  // SIZE-L1: a listed width and no listed height rests on the photo, with or without the picture's shape in hand
  const photoBasis = widthListed && !positive(d?.heightMm);
  // SIZE-L3: a lone length is the longest side; which one the picture says, or, without its shape, not guessed
  const lone = resolveLoneLength(figure, aspect);
  const loneUnplaced = !lone && !widthListed && !positive(d?.heightMm) && positive(d?.depthMm);
  const heightBasis: HeightBasis = lone
    ? (lone.longest === 'height' ? 'length' : 'photo')
    : loneUnplaced || photoBasis ? 'photo' : resolved === null ? 'default' : resolved.source === 'labeled' ? 'labeled' : 'scale';
  const heightMm = Math.min(lone?.heightMm ?? resolved?.heightMm ?? DEFAULT_FIGURE_HEIGHT_MM, MAX_PLAUSIBLE_HEIGHT_MM);
  const widthBasis: SizeBasis['widthBasis'] = positive(d?.widthMm) ? 'labeled' : lone?.longest === 'width' ? 'length' : 'photo';
  const depthBasis = positive(d?.depthMm) && !lone && !loneUnplaced ? 'labeled' : 'width';
  const cap = heightBasis !== 'labeled' && !lone && !loneUnplaced ? resolveWidthCap(figure) : null;
  const estimated = heightBasis !== 'labeled' || widthBasis !== 'labeled';

  const allListed = heightBasis === 'labeled' && widthBasis === 'labeled' && depthBasis === 'labeled' && resolved!.heightMm <= MAX_PLAUSIBLE_HEIGHT_MM;
  let line: string;
  if (allListed) {
    line = `${mm(resolved!.heightMm)} × ${mm(d!.widthMm!)} × ${mm(d!.depthMm!)} mm · measured`;
  } else {
    const height =
      loneUnplaced
        ? 'size from the listed length and the photo'
        : lone?.longest === 'height'
          ? `${mm(heightMm)} mm tall · from the listed length`
          : lone?.longest === 'width'
            ? `≈ ${mm(heightMm)} mm tall · from the photo`
            : heightBasis === 'labeled'
        ? resolved!.heightMm > MAX_PLAUSIBLE_HEIGHT_MM
          ? `${resolved!.heightMm} mm tall, read as ${MAX_PLAUSIBLE_HEIGHT_MM} mm`
          : `${mm(heightMm)} mm tall`
        : heightBasis === 'photo'
          ? resolved?.source === 'width-photo'
            ? `≈ ${mm(heightMm)} mm tall · from the listed width and the photo`
            : 'height from the listed width and the photo'
          : heightBasis === 'scale'
            ? `≈ ${mm(heightMm)} mm tall · from scale ${figure.scale.trim()}`
            : `≈ ${mm(heightMm)} mm · default, no size data`;
    const width =
      widthBasis === 'labeled'
        ? `${mm(d!.widthMm!)} mm wide`
        : widthBasis === 'length'
          ? `${mm(lone!.widthMm)} mm wide (the listed length)`
        : loneUnplaced
          ? null
        : cap === null
          ? 'width from the photo'
          : `width from the photo, at most ${mm(cap.capMm)} mm (${cap.basis === 'length' ? 'its length' : "its scale's height"})`;
    const depth = depthBasis === 'labeled' ? `${mm(d!.depthMm!)} mm deep` : 'depth from the width';
    line = [height, width, depth].filter((part): part is string => part !== null).join(' · ');
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
