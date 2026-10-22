import { ProductKind } from '@figurecollecting/fc-api-contract';
import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from './displayMeta';

/**
 * Nominal mm-per-scale-unit used to *estimate* physical height when no
 * labeled dimension exists but a scale fraction (e.g. "1/7") does — a rough
 * average adult-human-proportioned figure height assumption, per the
 * size-resolution tree Ross approved (figure_sizing_and_case_dimension_model).
 */
const NOMINAL_CHARACTER_HEIGHT_MM = 1600;

/**
 * No real figure exceeds roughly 2000mm (a large 1/1 life-size statue tops
 * out around ~1700mm): a resolvable heightMm above this is scraper-corrupted
 * data (notably the pre-fix Cheerio concat bug that produced values like
 * "660580570" from concatenated H/W/D strings). The case packer caps at it
 * (measureCaseFigure), so such a figure is a too-tall violator, never an
 * effectively infinite one.
 */
export const MAX_PLAUSIBLE_HEIGHT_MM = 2500;

export type HeightSource = 'labeled' | 'width-photo' | 'length' | 'scale-estimate';

export interface ResolvedHeight {
  /** Physical height in mm, resolved via the fallback tree. */
  heightMm: number;
  source: HeightSource;
}

/** Parses "1/7"-style scale strings into a numeric fraction; null if unparseable. */
function parseScaleFraction(scale: string | undefined): number | null {
  if (!scale) return null;
  const match = /^\s*1\s*\/\s*(\d+(\.\d+)?)\s*$/.exec(scale);
  if (!match) return null;
  const denom = Number(match[1]);
  return denom > 0 ? 1 / denom : null;
}

/**
 * Resolve a figure's best-guess physical height in mm. Never throws and
 * never returns a non-finite value — MFC dimension data is unreliable by
 * design (missing, mislabeled, or scraper-concatenated), so every rung of
 * this fallback tree must degrade gracefully instead of assuming a field
 * is present:
 *   1. labeled heightMm, if present and sane (finite, > 0).
 *   2. SIZE-L1 (Ross 10-20, desk (a)): a labeled widthMm and the picture's shape (`photoWidthPerMm`, the width the picture
 *      draws per mm of its height): the height at which the picture is the listed width. A MEASURED width and the photo's
 *      proportions beat a nominal character height, and a laying figure listed by its length (the spine reads an mfc L
 *      with no H and no W as the width) must not be stood up to the scale's height.
 *   3. SIZE-L3: a lone listed length (below): the height of the figure placed by the photo.
 *   4. scale fraction (e.g. "1/7") x nominal 1600mm character height.
 *   5. null — the caller falls back to a default height (packCabinets'
 *      DEFAULT_FIGURE_HEIGHT_MM, flagged as estimated), since there's no
 *      physical signal left to estimate from.
 */
export function resolveHeightMm(figure: Figure, photoWidthPerMm?: number, smallerEstimate = false): ResolvedHeight | null {
  const labeled = figure.dimensions?.heightMm;
  if (typeof labeled === 'number' && Number.isFinite(labeled) && labeled > 0) {
    return { heightMm: labeled, source: 'labeled' };
  }
  const width = figure.dimensions?.widthMm;
  // SIZE-L2: a listed height that was too small to be real (readListedSize) leaves two estimates, the photo's and the scale's;
  // Ross: "best guess erring on the smallish side", so the smaller stands
  if (smallerEstimate && isPositiveFinite(width) && isPositiveFinite(photoWidthPerMm)) {
    const fromPhoto = width / photoWidthPerMm;
    const fraction = parseScaleFraction(figure.scale);
    if (fraction && fraction * NOMINAL_CHARACTER_HEIGHT_MM < fromPhoto) return { heightMm: fraction * NOMINAL_CHARACTER_HEIGHT_MM, source: 'scale-estimate' };
    return { heightMm: fromPhoto, source: 'width-photo' };
  }
  if (isPositiveFinite(width) && isPositiveFinite(photoWidthPerMm)) {
    return { heightMm: width / photoWidthPerMm, source: 'width-photo' };
  }
  const lone = resolveLoneLength(figure, photoWidthPerMm);
  if (lone) return { heightMm: lone.heightMm, source: 'length' };
  const fraction = parseScaleFraction(figure.scale);
  if (fraction) {
    return { heightMm: fraction * NOMINAL_CHARACTER_HEIGHT_MM, source: 'scale-estimate' };
  }
  return null;
}

/** An axis of the listed size. */
export type Axis = 'height' | 'width' | 'depth';

/**
 * SIZE-L2 (Ross): on a FIGURE an axis listed under this many mm is not a measurement (MFC writes an unknown as 1): it is read as
 * missing and estimated. Goods, which really are this thin, keep theirs.
 */
export const TINY_AXIS_MM = 5;

/**
 * SIZE-L2: a picture within this share of as wide as tall is "square". Among mfc listings with a W and a longer L and no H, 5 % is
 * what gives the 5 wide / 13 square the desk counted (19 tall here against its 16).
 */
export const SQUARE_PHOTO_TOLERANCE = 0.05;

/**
 * SIZE-L2 (Ross, via the lead 10-21): on a FIGURE whose EVERY listed axis is under this many mm, the listing is read as
 * centimetres (x10): Zuko and Toph Beifong are listed 6 x 3 x 4. Only with an axis of at least TINY_AXIS_MM among them: a listing
 * whose largest axis is under that (an H1, a 1 x 1 x 1) is MFC's unknown, not a cm.
 */
export const CM_READ_BELOW_MM = 20;

export interface ListedSize {
  /** The figure as the rest of the resolution reads it: tiny axes gone, a W and a longer L placed. The same object when neither applies. */
  figure: Figure;
  /** Axes listed under TINY_AXIS_MM on a FIGURE, and what was listed. */
  dropped: readonly { axis: Axis; mm: number }[];
  /** Axes read as centimetres (the listing's every axis was under CM_READ_BELOW_MM), and what was listed in mm. */
  cm: readonly { axis: Axis; mm: number }[];
  /** A listed W and a longer L with no H, placed by the photo: a tall picture is standing (L the height), a wide one lying (L the width). */
  placed?: 'standing' | 'lying';
}

const AXES: readonly Axis[] = ['height', 'width', 'depth'];
const AXIS_KEY = { height: 'heightMm', width: 'widthMm', depth: 'depthMm' } as const;

/**
 * SIZE-L2 (Ross, via the lead 10-21). What the listing says, before the height, width and depth are resolved:
 *   0. a FIGURE whose every listed axis is under CM_READ_BELOW_MM (and the largest at least TINY_AXIS_MM) is read as centimetres.
 *   1. otherwise the tiny-axis rule: on a FIGURE (a card whose kind is FIGURE; goods, media and a card that states none keep theirs) an axis
 *      under TINY_AXIS_MM is dropped, so it is estimated like a missing one.
 *   2. a listed W and a LONGER L (the spine keeps them as the width and the depth) with no listed H: the photo decides. A tall
 *      picture is a standing figure: height = L, width = W. A wide one is lying: width = L, depth = W. A square one keeps the
 *      listing. L is not taken as the width unconditionally (the spine's "larger = width"): among such listings the photos are
 *      mostly tall. An L no longer than W already reads as a footprint and keeps its reading. A height dropped as tiny was
 *      listed, so it never makes a W+L of what is beside it.
 * `photoWidthPerMm` is the picture's width per mm of its height; without it nothing is placed.
 */
export function readListedSize(figure: Figure, photoWidthPerMm?: number): ListedSize {
  const d = figure.dimensions;
  if (!d) return { figure, dropped: [], cm: [] };
  const dims: { heightMm?: number; widthMm?: number; depthMm?: number } = { ...d };
  const dropped: { axis: Axis; mm: number }[] = [];
  const cm: { axis: Axis; mm: number }[] = [];
  if ((figure as { local?: { productKind?: ProductKind } }).local?.productKind === ProductKind.FIGURE) {
    const listedAxes = AXES.filter((axis) => isPositiveFinite(d[AXIS_KEY[axis]]));
    const largest = Math.max(0, ...listedAxes.map((axis) => d[AXIS_KEY[axis]] as number));
    if (listedAxes.length > 0 && largest >= TINY_AXIS_MM && listedAxes.every((axis) => (d[AXIS_KEY[axis]] as number) < CM_READ_BELOW_MM)) {
      for (const axis of listedAxes) {
        const v = d[AXIS_KEY[axis]] as number;
        dims[AXIS_KEY[axis]] = Number((v * 10).toFixed(6));
        cm.push({ axis, mm: v });
      }
    } else {
      for (const axis of AXES) {
        const v = d[AXIS_KEY[axis]];
        if (isPositiveFinite(v) && v < TINY_AXIS_MM) {
          delete dims[AXIS_KEY[axis]];
          dropped.push({ axis, mm: v });
        }
      }
    }
  }
  let placed: ListedSize['placed'];
  let placedDims = dims;
  if (!isPositiveFinite(d.heightMm) && isPositiveFinite(dims.widthMm) && isPositiveFinite(dims.depthMm) && dims.depthMm > dims.widthMm && isPositiveFinite(photoWidthPerMm)) {
    if (photoWidthPerMm < 1 - SQUARE_PHOTO_TOLERANCE) {
      placed = 'standing';
      placedDims = { heightMm: dims.depthMm, widthMm: dims.widthMm };
    } else if (photoWidthPerMm > 1 + SQUARE_PHOTO_TOLERANCE) {
      placed = 'lying';
      placedDims = { widthMm: dims.depthMm, depthMm: dims.widthMm };
    }
  }
  if (dropped.length === 0 && cm.length === 0 && placed === undefined) return { figure, dropped, cm };
  return { figure: { ...figure, dimensions: placedDims }, dropped, cm, ...(placed ? { placed } : {}) };
}

/** A lone length placed on the figure: which way it lies, and the figure's height and width that follow from it. */
export interface LoneLength {
  /** The side the listed length is: a lying figure's width, a standing figure's height. */
  longest: 'height' | 'width';
  lengthMm: number;
  heightMm: number;
  widthMm: number;
}

/**
 * SIZE-L3 (desk SIZE-L3): an mfc "L" with no H and no W arrives as the depth (the spine keeps MFC's W/L/H reading) and is the
 * figure's LONGEST extent: the width of a figure lying down, the height of one standing. The picture says which: a wide one
 * (at least as wide as it is tall, `photoWidthPerMm` >= 1) is a figure lying, so the length is the width and the height
 * follows from the picture's proportions; a tall one is standing, so the length is the height and the width follows. The
 * scale's nominal height is ignored either way. null with a listed height or width (the length is then a depth), with no
 * length, or with no picture shape to place it by.
 */
export function resolveLoneLength(figure: Figure, photoWidthPerMm?: number): LoneLength | null {
  const d = figure.dimensions;
  if (isPositiveFinite(d?.heightMm) || isPositiveFinite(d?.widthMm)) return null;
  const length = d?.depthMm;
  if (!isPositiveFinite(length) || !isPositiveFinite(photoWidthPerMm)) return null;
  return photoWidthPerMm >= 1
    ? { longest: 'width', lengthMm: length, widthMm: length, heightMm: length / photoWidthPerMm }
    : { longest: 'height', lengthMm: length, heightMm: length, widthMm: length * photoWidthPerMm };
}

export type WidthCapBasis = 'length' | 'scale';

/**
 * CASE-FB3b: the widest a figure's footprint can be when its width is not labeled, from what is: its labeled length L
 * (MFC's "L" lands in depth: the long side of the footprint), else the scale's nominal character height (1600 mm / n),
 * a figure being no longer than it is tall as a character at that scale. null when a width is labeled (never capped) or
 * nothing is (a picture's shape and the default height are all there is).
 */
export function resolveWidthCap(figure: Figure): { capMm: number; basis: WidthCapBasis } | null {
  if (isPositiveFinite(figure.dimensions?.widthMm)) return null;
  const length = figure.dimensions?.depthMm;
  if (isPositiveFinite(length)) return { capMm: length, basis: 'length' };
  const fraction = parseScaleFraction(figure.scale);
  return fraction ? { capMm: fraction * NOMINAL_CHARACTER_HEIGHT_MM, basis: 'scale' } : null;
}

/** Typical depth-to-width ratio for a figure's footprint — Ross's estimate
 *  for a "normal" figure stance, used when a real depth measurement isn't
 *  available (figure_sizing_and_case_dimension_model). */
export const DEPTH_WIDTH_RATIO = 0.65;

/** Absolute last-resort width (mm) if literally nothing — no labeled width,
 *  no resolvable height to derive one from — is available. Should be
 *  unreachable for any real Figure/FigureDisplayMeta pair (aspect always
 *  exists), kept only so resolveDepthMm is total and never returns 0. */
const FALLBACK_WIDTH_MM = 120;

export type DepthSource = 'labeled' | 'width-ratio' | 'square-fallback';

export interface ResolvedDepth {
  /** Footprint depth in mm, resolved via the fallback tree. */
  depthMm: number;
  source: DepthSource;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve a figure's best-guess footprint depth in mm — how far back it
 * occupies on a shelf, not its height. Same fault-tolerance requirement as
 * resolveHeightMm (MFC dimension data is unreliable by design): every rung
 * degrades gracefully instead of assuming a field is present, and the
 * function is total — it always returns a positive, finite depthMm.
 *   1. labeled depthMm (MFC "L"/"D"), if present and sane.
 *   2. ~0.65x a resolvable widthMm — labeled widthMm if present, else
 *      width derived from the figure's own pixel aspect x its resolved
 *      render height (the same resolved height measureCaseFigure already
 *      computed for this figure — passed in rather than re-derived here,
 *      so height and depth share one resolution pass).
 *   3. square-footprint fallback (depth = the resolved width, uncorrected)
 *      when the 0.65 ratio can't be applied to a trustworthy width — e.g.
 *      no resolvedHeightMm was available to derive one from AND no width
 *      is labeled either. Falls back to FALLBACK_WIDTH_MM in the
 *      (practically unreachable) case that even that's unavailable.
 */
export function resolveDepthMm(
  figure: Figure,
  meta: FigureDisplayMeta,
  resolvedHeightMm: number | null,
): ResolvedDepth {
  const labeledDepth = figure.dimensions?.depthMm;
  if (isPositiveFinite(labeledDepth)) {
    return { depthMm: labeledDepth, source: 'labeled' };
  }

  const labeledWidth = figure.dimensions?.widthMm;
  const derivedWidth = isPositiveFinite(resolvedHeightMm) ? meta.aspect * resolvedHeightMm : null;
  const widthMm = isPositiveFinite(labeledWidth) ? labeledWidth : derivedWidth;

  if (isPositiveFinite(widthMm)) {
    return { depthMm: widthMm * DEPTH_WIDTH_RATIO, source: 'width-ratio' };
  }
  return { depthMm: FALLBACK_WIDTH_MM, source: 'square-fallback' };
}
