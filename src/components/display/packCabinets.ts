/**
 * Packing a collection into cabinets (CAB-PACK) and the will-it-fit check
 * (FIT-CHECK), in millimetres, from the cabinet PROFILE only: the viewport,
 * the view and the camera never change where a figure stands, and no figure
 * is ever scaled (Ross 09-26: faithful, no stretching, no padding).
 *
 * Reading order: each cabinet's top first (outside the case, CC9 clearance),
 * then its shelves top to bottom, each left to right. Figures follow the
 * order they are given in (the case's arrangement, PACK1: groups keep to
 * themselves, packCabinets); a figure that fits no compartment of its cabinet but fits the
 * top goes to the top (design v3, CC9); a figure that fits nowhere is a
 * violator, listed with its reason, never placed. Overflow opens the next
 * cabinet of the wall pattern (the profiles cycle: the Detolf with the rack
 * alongside, CC16).
 */
import type { Figure } from '@figurecollecting/fc-shared';
import { CEILING_DEFAULT_MM, FIT_EPSILON_MM, adjacencyGapMm, clearHeightsMm, liftOutShelves, sideOverhangMm, stableLayout, topClearanceMm, withShelfLayout } from './cabinetProfile';
import type { CabinetProfile } from './cabinetProfile';
import { TALL_ON_OPENED_TOPS, TALL_SHELF_REMOVAL_DEFAULT, baseDepth, type BaseDepth } from './caseInterim';
import type { FigureDisplayMeta } from './displayMeta';
import { drawnWidthMm, type PictureMargins } from './figureArt';
import { photoFitOf, type PhotoFit } from './photoFit';
import { DEPTH_WIDTH_RATIO, MAX_PLAUSIBLE_HEIGHT_MM, readListedSize, resolveDepthMm, resolveHeightMm, resolveLoneLength, resolveWidthCap } from './sizeResolution';

/** Space left between neighbours on a surface. */
export const FIGURE_GAP_MM = 10;
/** A figure with no size data and no scale: about a 1/8 standing figure, flagged as estimated. */
export const DEFAULT_FIGURE_HEIGHT_MM = 200;

/** One figure as the packer sees it: its physical size, mm. */
export interface CaseFigure {
  readonly figure: Figure;
  /** Its position in the list the screen shows (the tap's onSelect index). */
  readonly index: number;
  readonly heightMm: number;
  /** Footprint width: labelled, else the picture's width at that height; never less than a cut-out draws. */
  readonly widthMm: number;
  /** The picture's width at heightMm: what the billboard draws. */
  readonly billboardWidthMm: number;
  readonly depthMm: number;
  /** True when the height is a scale estimate or the default, not a measurement. */
  readonly heightEstimated: boolean;
  /** Where widthMm comes from (CASE-FB3b); absent = labeled. */
  readonly widthBasis?: WidthBasis;
  /** The depth is Ross's ratio of the width, not a listed one (a listed depth that was too small to be real counts as none). */
  readonly depthFromWidth?: boolean;
  /** FIT1: the photo's figure is over 15 % wider or narrower than the listed width (a listed height too, a read cut-out). */
  readonly photoFit?: PhotoFit;
  /** Stood turned on its shelf (CASE-FB3b): widthMm and depthMm are its footprint's sides the other way round. */
  readonly turned?: boolean;
}

/** A labeled width; the picture's shape (no width labeled); capped at a labeled length, or at the scale's nominal height. */
export type WidthBasis = 'labeled' | 'photo' | 'length' | 'scale';

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * One figure's size for the packer. `drawn`: the clear margins of a cut-out
 * or masked picture, once its alpha is read; the figure is then packed by
 * the wider of its label and what it draws at true scale (drawnWidthMm), or
 * by what it draws when it has no label, so it never reaches over a
 * neighbour (a real cut-out can draw far wider than its label).
 */
export function measureCaseFigure(listing: Figure, index: number, meta: FigureDisplayMeta, drawn?: PictureMargins): CaseFigure {
  // what the picture draws as wide at a height: a cut-out's clear part once read, else the whole picture
  const pictureWidth = (h: number) => (drawn ? drawnWidthMm(h, meta.aspect, drawn) : meta.aspect * h);
  // SIZE-L2: the listing as read before anything is resolved: tiny axes dropped on a figure, a W and a longer L placed by the
  // photo. `figure` below is that reading; the CaseFigure keeps the listing's own figure
  const read = readListedSize(listing, pictureWidth(1));
  const figure = read.figure;
  // SIZE-L1: with a width listed and no height, the height at which the picture is that wide (resolveHeightMm); a height dropped
  // as tiny takes the smaller of that and the scale's
  const resolved = resolveHeightMm(figure, pictureWidth(1), read.dropped.some((d) => d.axis === 'height'));
  // SIZE-L3: a lone length is the figure's longest side, placed by the photo; it is then neither a width cap nor a depth
  const lone = resolveLoneLength(figure, pictureWidth(1));
  // (a height read from a listed length, or from a listing read as centimetres, is an inference, not a measurement)
  const heightEstimated = resolved?.source !== 'labeled' || read.placed === 'standing' || read.cm.length > 0;
  let heightMm = Math.min(resolved?.heightMm ?? DEFAULT_FIGURE_HEIGHT_MM, MAX_PLAUSIBLE_HEIGHT_MM);
  const labelledWidth = figure.dimensions?.widthMm;
  const hasLabelledWidth = positive(labelledWidth);
  // CASE-FB3b: a height only an estimate gives gives way to what the labels support of the width (a labeled length, else
  // the scale's nominal height): a lying figure's wide picture at the 200 mm default was 400-700 mm. The picture is then
  // drawn no wider than the footprint it is packed by. A labeled height stands: the picture is what it is
  const cap = lone ? null : resolveWidthCap(figure);
  let capped = false;
  if (cap && heightEstimated && pictureWidth(heightMm) > cap.capMm) {
    heightMm = (heightMm * cap.capMm) / pictureWidth(heightMm);
    capped = true;
  }
  // FIT1 (Ross 10-19): a listed width wins over the photo. The cut-out's figure is scaled uniformly (no stretch: the binding
  // dimension decides) to fit inside the listed box: when it draws wider than the listing at this height, the height follows
  // the width down. It never grows to a wider listing: a narrower photo stays at its height, the label the footprint. Only
  // a read cut-out (the figure it draws, not the whole picture) says what the photo is, and only with the height listed
  // is its width a fair test of the listing (at an estimated height it is a guess against a guess).
  let photoFit: PhotoFit | undefined;
  if (drawn && hasLabelledWidth) {
    const photoWidth = pictureWidth(heightMm);
    if (positive(photoWidth)) {
      if (!heightEstimated) photoFit = photoFitOf(photoWidth, labelledWidth);
      if (photoWidth > labelledWidth) heightMm = (heightMm * labelledWidth) / photoWidth;
    }
  }
  const billboardWidthMm = meta.aspect * heightMm;
  const drawnWidth = drawn ? drawnWidthMm(heightMm, meta.aspect, drawn) : 0;
  // (a height derived from the listed width draws the picture exactly that wide: float noise must not read as a wider picture)
  const widthMm = hasLabelledWidth ? (drawnWidth > labelledWidth * (1 + 1e-9) ? drawnWidth : labelledWidth) : positive(drawnWidth) ? drawnWidth : billboardWidthMm;
  const widthBasis: WidthBasis = read.placed === 'lying' ? 'length' : hasLabelledWidth ? 'labeled' : lone ? (lone.longest === 'width' ? 'length' : 'photo') : cap && capped ? cap.basis : 'photo';
  const labelledDepth = figure.dimensions?.depthMm;
  // a capped width gives a depth in Ross's ratio of its own, not of the picture's
  const depthMm = !positive(labelledDepth) && cap && capped
    ? DEPTH_WIDTH_RATIO * widthMm
    : lone
      ? resolveDepthMm({ ...figure, dimensions: { ...figure.dimensions, depthMm: undefined } }, meta, heightMm).depthMm
      : resolveDepthMm(figure, meta, heightMm).depthMm;
  return { figure: listing, index, heightMm, widthMm, billboardWidthMm, depthMm, heightEstimated, widthBasis, ...(photoFit ? { photoFit } : {}), ...(positive(labelledDepth) ? {} : { depthFromWidth: true }) };
}

/** One display surface as the packer and the renderer see it. */
export interface SurfaceSlot {
  /** Index into profile.surfaces. */
  readonly surfaceIndex: number;
  readonly isTop: boolean;
  /** The surface's top, mm from the floor. */
  readonly topMm: number;
  /** Tallest figure it takes: the compartment's clear height, or the top's clearance. */
  readonly maxHeightMm: number;
  /** Usable width, centred on the cabinet. */
  readonly widthMm: number;
  readonly depthMm: number;
  /** z of the usable area's front edge (0 = the cabinet front, negative = back). */
  readonly frontZMm: number;
  /**
   * z of the front edge the case draws for the surface, its lip: a glass plate's own front, else the cabinet front
   * (a board, a framed floor or a beam is drawn to it, though the usable area may start behind the door).
   */
  readonly lipZMm: number;
}

/**
 * The profile's surfaces in reading order: the top (when usable), then the shelves top to bottom. A storage shelf (CLEAR-1)
 * is no place for a figure, so it is left out; the shelf view's levels (`withStorage`) keep it, as it is physically there.
 */
export function surfaceSlots(profile: CabinetProfile, ceilingMm: number = CEILING_DEFAULT_MM, withStorage: boolean = false): SurfaceSlot[] {
  const { surfaces } = profile;
  const clear = clearHeightsMm(profile);
  const slots: SurfaceSlot[] = [];
  const last = surfaces.length - 1;
  if (profile.top.usable) {
    slots.push({
      surfaceIndex: last,
      isTop: true,
      topMm: surfaces[last].topMm,
      maxHeightMm: topClearanceMm(profile, ceilingMm),
      widthMm: profile.outer.widthMm,
      depthMm: profile.outer.depthMm,
      frontZMm: 0,
      lipZMm: 0,
    });
  }
  const doorWall = profile.rack ? profile.rack.postMm : profile.materials.front === 'glassDoor' ? (profile.glassMm ?? 0) : 0;
  for (let i = last - 1; i >= 0; i--) {
    const s = surfaces[i];
    if (s.role === 'storage' && !withStorage) continue;
    const onPlate = profile.plate !== undefined && s.plate === true;
    const frontWall = s.outsideDoor ? 0 : doorWall;
    slots.push({
      surfaceIndex: i,
      isTop: false,
      topMm: s.topMm,
      maxHeightMm: clear[i],
      widthMm: onPlate ? profile.plate!.widthMm : profile.interior.widthMm,
      depthMm: onPlate ? profile.plate!.depthMm : profile.interior.depthMm,
      frontZMm: onPlate ? -profile.plate!.frontInsetMm : frontWall > 0 ? -frontWall : 0,
      lipZMm: onPlate ? -profile.plate!.frontInsetMm : 0,
    });
  }
  return slots;
}

/** 'needs-tier' (CASE-FB2b): no stock compartment takes it, one the cabinet makes by taking shelves out does. */
export type FitVerdict = 'fits' | 'needs-tier' | 'top-only' | 'too-tall' | 'too-wide' | 'too-deep';

export interface FitResult {
  readonly verdict: FitVerdict;
  /** Taller than every compartment and the top's clearance. */
  readonly tooTall: boolean;
  /** Deeper than every surface it could stand on. */
  readonly tooDeep: boolean;
}

const within = (size: number, limit: number) => size <= limit + FIT_EPSILON_MM;

const fitsSlot = (s: SurfaceSlot, item: CaseFigure) => within(item.heightMm, s.maxHeightMm) && within(item.widthMm, s.widthMm) && within(item.depthMm, s.depthMm);

/**
 * One way an instance of a profile may stand (CASE-FB2b): its stock shelves, or some of those that lift out taken
 * out; its tiers are its compartments taller than the profile's tallest stock one.
 */
interface Arrangement {
  readonly profile: CabinetProfile;
  readonly slots: SurfaceSlot[];
  readonly tiers: readonly number[];
  readonly removed: number;
  /** Where its highest tier stands (the top of the surface it stands on, mm); 0 when it has none. EYE-1: of equal removals, the highest wins. */
  readonly tierTopMm: number;
}

const arrangementCache = new WeakMap<CabinetProfile, Map<number, Arrangement[]>>();

/**
 * Every way `profile` may stand, the stock one first, then each set of lift-out shelves taken out: the fewest out first
 * and, of as many, the one whose tier stands highest first (EYE-1, Ross 10-18: a tall figure's tier is made as high as it
 * can be, closer to a standing viewpoint; it was the lowest).
 */
function arrangements(profile: CabinetProfile, ceilingMm: number): Arrangement[] {
  let byCeiling = arrangementCache.get(profile);
  if (!byCeiling) arrangementCache.set(profile, (byCeiling = new Map()));
  const cached = byCeiling.get(ceilingMm);
  if (cached) return cached;
  const out = liftOutShelves(profile);
  const stockMax = Math.max(0, ...surfaceSlots(profile, ceilingMm).filter((s) => !s.isTop).map((s) => s.maxHeightMm));
  const list: Arrangement[] = [];
  for (let mask = 0; mask < 1 << out.length; mask++) {
    const removed = out.filter((_, b) => mask & (1 << b));
    // a top and one shelf at least (withShelfLayout)
    if (profile.surfaces.length - removed.length < 2) continue;
    // CLEAR-1: and the posts braced: a rack never goes to fewer than two beams in either half
    if (!stableLayout(profile, { removed, moved: [] })) continue;
    const derived = withShelfLayout(profile, { removed, moved: [] });
    const slots = surfaceSlots(derived, ceilingMm);
    const tiers = slots.flatMap((s, k) => (!s.isTop && s.maxHeightMm > stockMax + FIT_EPSILON_MM ? [k] : []));
    list.push({ profile: derived, slots, tiers, removed: removed.length, tierTopMm: Math.max(0, ...tiers.map((k) => slots[k].topMm)) });
  }
  list.sort((a, b) => a.removed - b.removed || b.tierTopMm - a.tierTopMm);
  byCeiling.set(ceilingMm, list);
  return list;
}

/**
 * FIT-CHECK: will this figure fit this cabinet, and where? `shelfRemoval` (CASE-FB2b): one too tall for every stock
 * compartment that a compartment fits once shelves come out needs a tier.
 */
export function fitCheck(
  profile: CabinetProfile,
  item: CaseFigure,
  ceilingMm: number = CEILING_DEFAULT_MM,
  shelfRemoval: boolean = TALL_SHELF_REMOVAL_DEFAULT,
): FitResult {
  const stock = stockFit(profile, item, ceilingMm);
  if (!shelfRemoval || stock.verdict === 'fits') return stock;
  const tier = arrangements(profile, ceilingMm).some((a) => a.tiers.some((k) => fitsSlot(a.slots[k], item)));
  return tier ? { verdict: 'needs-tier', tooTall: false, tooDeep: false } : stock;
}

function stockFit(profile: CabinetProfile, item: CaseFigure, ceilingMm: number): FitResult {
  const byHeight = surfaceSlots(profile, ceilingMm).filter((s) => within(item.heightMm, s.maxHeightMm));
  if (byHeight.length === 0) return { verdict: 'too-tall', tooTall: true, tooDeep: false };
  const byWidth = byHeight.filter((s) => within(item.widthMm, s.widthMm));
  if (byWidth.length === 0) return { verdict: 'too-wide', tooTall: false, tooDeep: false };
  const byDepth = byWidth.filter((s) => within(item.depthMm, s.depthMm));
  if (byDepth.length === 0) return { verdict: 'too-deep', tooTall: false, tooDeep: true };
  return { verdict: byDepth.some((s) => !s.isTop) ? 'fits' : 'top-only', tooTall: false, tooDeep: false };
}

export interface PlacedFigure {
  readonly item: CaseFigure;
  /** Left edge from the slot's left edge, mm. */
  readonly xMm: number;
  /** The billboard's plane: its base's front (CASE-FB2a). */
  readonly zMm: number;
  /** Where its base stands front to back: centred in the slot's usable depth (caseInterim). */
  readonly base: BaseDepth;
  readonly heightMm: number;
  /** Deeper than this surface (it overhangs). */
  readonly tooDeep: boolean;
}

export interface PackedSurface {
  readonly surfaceIndex: number;
  readonly slot: SurfaceSlot;
  readonly items: PlacedFigure[];
}

export interface PackedCabinet {
  readonly index: number;
  readonly profile: CabinetProfile;
  /** Every slot, in reading order, empty ones included. */
  readonly surfaces: PackedSurface[];
}

export type ViolatorReason = Exclude<FitVerdict, 'fits' | 'needs-tier' | 'top-only'>;

export interface Violator {
  readonly item: CaseFigure;
  readonly reason: ViolatorReason;
}

export interface PackResult {
  readonly cabinets: PackedCabinet[];
  readonly violators: Violator[];
}

interface Building {
  /** The profile from the wall pattern, and the instance as it stands (its shelves taken out, CASE-FB2b). */
  stock: CabinetProfile;
  /** Its stock's place in the wall pattern. */
  pi: number;
  profile: CabinetProfile;
  slots: SurfaceSlot[];
  rows: CaseFigure[][];
  /** Compartments kept for tall figures: its tiers, and its top when the tall figures need it too. */
  tall: Set<number>;
}

/** How well a verdict places a figure: a shelf, a tier, the top, nowhere. */
const RANK: Record<FitVerdict, number> = { fits: 0, 'needs-tier': 1, 'top-only': 2, 'too-tall': 3, 'too-wide': 3, 'too-deep': 3 };

/** The best any cabinet of the pattern does for a figure, by RANK. */
const bestRank = (pattern: readonly CabinetProfile[], item: CaseFigure, ceilingMm: number, shelfRemoval: boolean): number =>
  Math.min(...pattern.map((p) => RANK[fitCheck(p, item, ceilingMm, shelfRemoval).verdict]));

/**
 * CASE-FB3b: a figure may stand turned on its shelf: it fits a surface where its longer footprint side fits the width
 * and its shorter the depth, or the reverse. Turned only where that places it better than it stands (a shelf over a
 * tier over a top over nowhere), its footprint's sides then swapped (widthMm along the shelf).
 */
function oriented(item: CaseFigure, pattern: readonly CabinetProfile[], ceilingMm: number, shelfRemoval: boolean): CaseFigure {
  if (item.widthMm === item.depthMm) return item;
  const turned: CaseFigure = { ...item, widthMm: item.depthMm, depthMm: item.widthMm, turned: true };
  return bestRank(pattern, turned, ceilingMm, shelfRemoval) < bestRank(pattern, item, ceilingMm, shelfRemoval) ? turned : item;
}

/** Every place a cabinet of `profile` offers, the stock shelves and (shelf removal on) each way of taking lift-out shelves out. */
function placesOf(profile: CabinetProfile, ceilingMm: number, shelfRemoval: boolean): SurfaceSlot[] {
  return shelfRemoval ? arrangements(profile, ceilingMm).flatMap((a) => a.slots) : surfaceSlots(profile, ceilingMm);
}

/**
 * CASE-FB3b: why a figure fits nowhere on the wall, and the most any place takes of what it exceeds: the first of its
 * height, width and depth that is over every place's (the real reason, tiers and tops counted), else, where each fits
 * some place but none takes them all, the dimension it overshoots most at the closest place.
 */
function violation(
  item: CaseFigure,
  pattern: readonly CabinetProfile[],
  ceilingMm: number,
  shelfRemoval: boolean,
): { reason: ViolatorReason; limitMm: number; combined: boolean } {
  const places = pattern.flatMap((p) => placesOf(p, ceilingMm, shelfRemoval));
  const most = { tall: Math.max(...places.map((x) => x.maxHeightMm)), wide: Math.max(...places.map((x) => x.widthMm)), deep: Math.max(...places.map((x) => x.depthMm)) };
  if (!within(item.heightMm, most.tall)) return { reason: 'too-tall', limitMm: most.tall, combined: false };
  if (!within(item.widthMm, most.wide)) return { reason: 'too-wide', limitMm: most.wide, combined: false };
  if (!within(item.depthMm, most.deep)) return { reason: 'too-deep', limitMm: most.deep, combined: false };
  // none over every place: the place it overshoots least, and what it overshoots there
  let best: { over: number; reason: ViolatorReason; limitMm: number } | null = null;
  for (const x of places) {
    const over = [
      { over: item.heightMm / x.maxHeightMm, reason: 'too-tall' as const, limitMm: x.maxHeightMm },
      { over: item.widthMm / x.widthMm, reason: 'too-wide' as const, limitMm: x.widthMm },
      { over: item.depthMm / x.depthMm, reason: 'too-deep' as const, limitMm: x.depthMm },
    ].reduce((a, b) => (b.over > a.over ? b : a));
    if (best === null || over.over < best.over) best = over;
  }
  return { reason: best!.reason, limitMm: best!.limitMm, combined: true };
}

const mm = (v: number): string => `${Math.round(v * 10) / 10} mm`;

/**
 * CASE-FB3b: what the "does not fit" list says of a violator: its reason, the measure that is over, where the measure
 * comes from (labeled, the picture's shape, a scale or a length that caps it), and the most any place of the pattern takes.
 */
export function describeViolator(v: Violator, pattern: readonly CabinetProfile[], ceilingMm: number = CEILING_DEFAULT_MM, shelfRemoval: boolean = TALL_SHELF_REMOVAL_DEFAULT): string {
  const { item } = v;
  const { reason, limitMm, combined } = violation(item, pattern, ceilingMm, shelfRemoval);
  // each measure fits some place but no place takes them all: the closest place says how far over
  const limit = (most: string): string => (combined ? `no place takes all of it, the closest takes ${mm(limitMm)}` : `${most} ${mm(limitMm)}`);
  if (reason === 'too-tall') {
    const how = !item.heightEstimated ? ', labeled' : item.figure.scale ? ` estimated from its ${item.figure.scale} scale` : ', the default (no size known)';
    return `too tall: ${mm(item.heightMm)}${how}; ${limit('the most any place takes is')}`;
  }
  if (reason === 'too-wide') {
    const basis = item.widthBasis ?? 'labeled';
    const how =
      basis === 'labeled' ? ', labeled' : basis === 'photo' ? " from the photo's shape, no labeled width" : basis === 'length' ? ', capped at its labeled length' : " capped at its scale's height";
    return `too wide: ${mm(item.widthMm)}${how}; ${limit('the widest place takes')}`;
  }
  const how = item.depthFromWidth ?? !positive(item.figure.dimensions?.depthMm) ? ' estimated from its width' : ', labeled';
  return `too deep: ${mm(item.depthMm)}${how}; ${limit('the deepest place takes')}`;
}

/** The packer's interim rules (caseInterim); a saved layout will set its own. */
export interface PackRules {
  /** CASE-FB2a: a figure for a top waits for a top on the wall, never opening a cabinet ahead of the shelves. */
  readonly tallOnOpenedTops: boolean;
  /**
   * CASE-FB2b: a figure too tall for every stock compartment stands in a tier a cabinet makes by taking lift-out
   * shelves out, as many as keep the tall and the shelf figures in step, so no cabinet is left with empty glass.
   */
  readonly shelfRemoval: boolean;
}

export const PACK_RULES: PackRules = { tallOnOpenedTops: TALL_ON_OPENED_TOPS, shelfRemoval: TALL_SHELF_REMOVAL_DEFAULT };

type Kind = 'shelf' | 'tall' | 'none';

/** CASE-FB2b: how near a layout's share of its width kept for tall figures must come to theirs to count as in step. */
const IN_STEP_SLACK = 0.06;
/**
 * How many times over the tall figures still to place are counted when a cabinet is arranged, tried in turn until
 * none is left without figures on its shelves before the wall's last (each try a whole packing: 10 to 20 ms for 1,200
 * figures in Node; most walls need the first).
 */
const LEANS = [1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];

function rowWidth(row: readonly CaseFigure[], extra: CaseFigure): number {
  return row.reduce((sum, i) => sum + i.widthMm + FIGURE_GAP_MM, 0) + extra.widthMm;
}

/**
 * PACK1 (Ross 10-26, Q2 a): `groups`, one per figure in `items`' order (caseArrangement: a series, a scale, or null for a
 * figure that stands alone). A gap is filled only with figures of the same group: each group starts where the figures
 * before it left off, and every figure of it stands there or after, in reading order (cabinet by cabinet; in each its
 * top, then its compartments top to bottom); a shelf figure takes the first place from there with room, so a later figure
 * of the group fills a gap an earlier one left, and a tall one the earliest tier, else top, from there with room, or one
 * left empty in the cabinet where its group starts (nothing stands there: no group's gap); else it waits for the next
 * cabinet, as below. A group one shelf could hold is never split across two: it starts on the room
 * left on the shelf where the figures before it ended only when all its shelf figures fit there, else on the next shelf;
 * a group wider than that shelf starts on the room left. A figure that stands alone is placed exactly as without groups.
 * Without `groups`, the figures are placed in their order by the rules below alone.
 *
 * `rules` (caseInterim): with tallOnOpenedTops, a figure only a top takes stands on the earliest top of a cabinet the
 * shelves have already opened, else waits for the next one they open, whose top it takes first; those still waiting
 * when the shelf figures are all placed open cabinets at the wall's end. With shelfRemoval (CASE-FB2b), a figure too
 * tall for every stock compartment does the same in the tiers the cabinets make by taking glass shelves out, and on
 * their tops: each cabinet the shelves open stands as the one layout of it that holds all that is left, with the
 * fewest shelves out, when one does; else as the layout whose share of room kept for tall figures comes nearest the
 * tall figures' share of what is left (of the layouts no other beats on both kinds of room), the fewest shelves out of
 * those as near, a top kept for tall figures only when needed; never with a tier no tall figure is left to fill, nor
 * without glass inside the door while shelf figures are still to come. With both off, a figure only a top takes
 * stands on the first top from the shelf cursor's cabinet on, opening cabinets ahead of the shelves.
 */
export function packCabinets(
  items: readonly CaseFigure[],
  pattern: readonly CabinetProfile[],
  ceilingMm: number = CEILING_DEFAULT_MM,
  rules: PackRules = PACK_RULES,
  groups?: readonly (string | null)[],
  options: PackOptions = {},
): PackResult {
  if (pattern.length === 0) throw new RangeError('packCabinets needs at least one cabinet profile');
  items = items.map((item) => oriented(item, pattern, ceilingMm, rules.shelfRemoval));
  const grouped = groups !== undefined && groups.some((g) => g !== null);
  const pass = (lean: number, leans: readonly number[], deviate: boolean) => {
    const packed = placeAll(items, pattern, ceilingMm, rules, lean, leans, groups, deviate);
    return { ...packed, bare: bareCabinets(packed.building, grouped) };
  };
  let best: ReturnType<typeof pass> | null = null;
  if (pattern.every((p) => p === pattern[0])) {
    // CASE-FB2b: the first lean that leaves no cabinet before the last with nothing on its shelves, else the fewest such
    for (const lean of rules.shelfRemoval ? LEANS : [1]) {
      const packed = pass(lean, LEANS, true);
      if (best === null || packed.bare < best.bare) best = packed;
      // (PACK-KIND-1: no lean would have stood a cabinet otherwise, so each later one packs the same, none with fewer bare)
      if (packed.bare === 0 || !packed.leaned) break;
    }
  } else {
    // PACK-KIND-1, a wall of more than one profile: the packing that stands in the fewest cabinets, then the fewest empty,
    // then the fewest before the last with nothing on their shelves, of three leans, each with a shelf figure first
    // taking a place another cabinet keeps for figures tall for it, and without (that place can be one a later figure,
    // tall where the shelves are, needed). Each way is tried at the leans it would be alone, so the packing is never worse
    // than either way's alone.
    const ways = options.deviate === undefined ? [true, false] : [options.deviate];
    const bestOf = new Map<boolean, ReturnType<typeof pass>>();
    const done = new Set<boolean>();
    for (const lean of rules.shelfRemoval ? MIXED_LEANS : [1]) {
      let same: ReturnType<typeof pass> | null = null;
      for (const deviate of ways) {
        if (done.has(deviate)) continue;
        // (no shelf figure took such a place: the packing without that step is the one just made)
        const packed: ReturnType<typeof pass> = !deviate && same !== null ? same : pass(lean, MIXED_LEANS, deviate);
        if (deviate && !packed.deviated) same = packed;
        if (best === null || rankOf(packed) < rankOf(best)) best = packed;
        const mine = bestOf.get(deviate);
        if (mine === undefined || rankOf(packed) < rankOf(mine)) bestOf.set(deviate, packed);
        // (this way's best with none empty and none before the last without figures on its shelves: its later leans are
        // not tried, as above; nor when no other lean would have stood a cabinet otherwise, as each later one packs the same)
        if (rankOf(bestOf.get(deviate)!) % 100_000_000 === 0 || !packed.leaned) done.add(deviate);
      }
      if (ways.every((w) => done.has(w))) break;
    }
  }
  return { cabinets: assemble(best!.building), violators: best!.violators };
}

/** PACK-KIND-1: how a packing is made, for comparisons. */
export interface PackOptions {
  /**
   * On a wall of more than one profile, whether a shelf figure where the shelves are first takes a place another cabinet
   * keeps for figures tall for it: unset, the better of the packings with and without that step; true or false, only that one.
   */
  readonly deviate?: boolean;
}

/** PACK-KIND-1: the leans a wall of more than one profile is packed with (each packing twice, with and without the step above). */
const MIXED_LEANS = [1, 1.35, 2];

/** A packing's cost: its cabinets, then those standing empty, then those before the last with nothing on their shelves. */
function rankOf(p: { building: readonly { readonly rows: readonly (readonly unknown[])[] }[]; bare: number }): number {
  const empty = p.building.filter((b) => b.rows.every((row) => row.length === 0)).length;
  return (p.building.length * 10_000 + empty) * 10_000 + p.bare;
}

/**
 * CASE-FB2b: how many cabinets before the last stand with nothing on their shelves (a tier or a top is no shelf).
 * PACK1: in a grouped packing (`grouped`) the cabinets after the last with a shelf figure hold only the tall figures
 * whose group could take no earlier place; no lean changes them (each lean was packed for nothing, 4-6x the list's
 * time), so they are the wall's end, not a bare cabinet within it.
 */
export function bareCabinets(
  building: readonly { readonly slots: readonly { readonly isTop: boolean }[]; readonly tall: ReadonlySet<number>; readonly rows: readonly (readonly unknown[])[] }[],
  grouped: boolean,
): number {
  const shelved = building.map((b) => b.rows.some((row, k) => row.length > 0 && !b.tall.has(k) && !b.slots[k].isTop));
  const end = grouped ? shelved.lastIndexOf(true) + 1 : building.length - 1;
  return shelved.slice(0, Math.max(0, end)).filter((s) => !s).length;
}

/**
 * One packing of `items` (packCabinets), the tall figures still to place counted `lean` times over; with `deviate`, a
 * shelf figure where the shelves are first takes a place another cabinet keeps for figures tall for it (`deviated`: one did).
 */
function placeAll(
  items: readonly CaseFigure[],
  pattern: readonly CabinetProfile[],
  ceilingMm: number,
  rules: PackRules,
  lean: number,
  leans: readonly number[],
  groups: readonly (string | null)[] | undefined,
  deviate: boolean,
): { building: Building[]; violators: Violator[]; deviated: boolean; leaned: boolean } {
  const building: Building[] = [];
  const violators: Violator[] = [];
  let deviated = false;
  // whether the lean could change how a cabinet stands (else every lean packs the same)
  let leaned = false;
  // PACK1: the figure being placed is of a group, which starts at `mark` (cabinet, place in its reading order)
  let grouped = false;
  let mark = { cab: 0, k: 0 };
  /** Whether place `k` of cabinet `c` is at or after the mark: the only places the group's figures may take. */
  const fromMark = (c: number, k: number) => !grouped || c > mark.cab || (c === mark.cab && k >= mark.k);
  /** A tall figure's places: from the mark on, and a tier or top left empty in the mark's cabinet (no group's gap). */
  const tallFrom = (c: number, k: number) => fromMark(c, k) || (c === mark.cab && building[c].rows[k].length === 0);
  // PACK-KIND-1: a wall of more than one profile
  const mixed = pattern.some((p) => p !== pattern[0]);
  // (PACK-KIND-1: and as deep as the figure on a wall of more than one profile, where a figure goes to whichever cabinet
  // holds it; a wall of one profile packs as it did)
  const fitsIn = (b: Building, k: number, item: CaseFigure) =>
    within(item.heightMm, b.slots[k].maxHeightMm) && within(rowWidth(b.rows[k], item), b.slots[k].widthMm) && (!mixed || within(item.depthMm, b.slots[k].depthMm));
  const topOf = (b: Building) => b.slots.findIndex((s) => s.isTop);
  const span = (item: CaseFigure) => item.widthMm + FIGURE_GAP_MM;

  // each figure's kind in each profile of the pattern, and what the figures from each place on still want (width)
  const kinds = pattern.map((p) =>
    items.map((item): Kind => {
      const v = fitCheck(p, item, ceilingMm, rules.shelfRemoval).verdict;
      return v === 'fits' ? 'shelf' : v === 'needs-tier' || v === 'top-only' ? 'tall' : 'none';
    }),
  );
  const ahead = kinds.map((ks) => {
    const tall = new Array<number>(items.length + 1).fill(0);
    const shelf = new Array<number>(items.length + 1).fill(0);
    // the narrowest and the shortest tall figure from each place on
    const narrow = new Array<number>(items.length + 1).fill(Infinity);
    const short = new Array<number>(items.length + 1).fill(Infinity);

    for (let i = items.length - 1; i >= 0; i--) {
      const isTall = ks[i] === 'tall';
      tall[i] = tall[i + 1] + (isTall ? span(items[i]) : 0);
      shelf[i] = shelf[i + 1] + (ks[i] === 'shelf' ? span(items[i]) : 0);
      narrow[i] = Math.min(narrow[i + 1], isTall ? items[i].widthMm : Infinity);
      short[i] = Math.min(short[i + 1], isTall ? items[i].heightMm : Infinity);
    }
    return { tall, shelf, narrow, short };
  });

  // PACK-KIND-1: a figure is judged by the cabinet it lands in: its kind in that cabinet's profile
  /** Whether place `k` of cabinet `b` may take figure `i`: a place kept for tall figures only one tall for that cabinet. */
  const mayTake = (b: Building, k: number, i: number) => !b.tall.has(k) || kinds[b.pi][i] === 'tall';

  // the tall figures no place on the wall has room for yet (their places in the list), in list order
  const waiting: number[] = [];
  /** The waiting figures of kind `kind` in profile `pi`. */
  const waitingOf = (pi: number, kind: Kind) => waiting.filter((j) => kinds[pi][j] === kind).map((j) => items[j]);
  /** A tall figure's tier in a cabinet with room for it (PACK1: one of its places `allowed`), else -1. */
  const tierFor = (b: Building, item: CaseFigure, allowed: (k: number) => boolean = () => true): number => {
    const t = topOf(b);
    for (const k of b.tall) if (k !== t && allowed(k) && fitsIn(b, k, item)) return k;
    return -1;
  };
  const topFor = (b: Building, item: CaseFigure, allowed: (k: number) => boolean = () => true): number => {
    const t = topOf(b);
    return t >= 0 && allowed(t) && fitsIn(b, t, item) ? t : -1;
  };
  /**
   * What each cabinet's tiers and top have left: the most width any one has, and the tallest. Rows only grow, so a
   * value once read stays an upper bound; tallPlace passes by a cabinet no figure as wide or as tall could stand in.
   */
  const roomBound: { widthMm: number; heightMm: number }[] = [];
  const tallRoomOf = (b: Building) => {
    let widthMm = 0;
    let heightMm = 0;
    const t = topOf(b);
    for (const k of t >= 0 ? [...b.tall, t] : b.tall) {
      widthMm = Math.max(widthMm, b.slots[k].widthMm - b.rows[k].reduce((x, it) => x + span(it), 0));
      heightMm = Math.max(heightMm, b.slots[k].maxHeightMm);
    }
    return { widthMm, heightMm };
  };
  /**
   * A tall figure's place on the wall: the earliest tier with room for it, else the earliest top (PACK1: from its group's
   * mark on). A tier or top kept for tall figures takes only one tall for its own cabinet (PACK-KIND-1); with `tallThere`,
   * figure `i` is a shelf figure where the shelves are and takes only a place in a cabinet it is tall for.
   */
  const tallPlace = (item: CaseFigure, i: number, tallThere = false): [Building, number] | null => {
    for (const place of [tierFor, topFor]) {
      // (PACK1: no place before the mark's cabinet is a group's)
      for (let c = grouped ? mark.cab : 0; c < building.length; c++) {
        const b = building[c];
        const tall = kinds[b.pi][i] === 'tall';
        if (tallThere && !tall) continue;
        const bound = roomBound[c];
        // (the bound's 1e-3 mm slack: never a figure passed by that the rows' own sums would let in)
        if (bound !== undefined && (item.widthMm > bound.widthMm + 1e-3 || !within(item.heightMm, bound.heightMm))) continue;
        const k = place(b, item, (j) => tallFrom(c, j) && (tall || (!tallThere && !b.tall.has(j))));
        if (k >= 0) return [b, k];
        if (place === tierFor) roomBound[c] = tallRoomOf(b);
      }
    }
    return null;
  };
  /**
   * Where a waiting figure stands in a cabinet just opened: tall for it, a tier, else its top; a shelf figure for it, the
   * first place not kept for tall figures, in reading order (its top first when not kept), with room, that leaves the
   * figure `opener`, a shelf figure there that opened it, a place (PACK-KIND-1: the waiting never crowd it out).
   */
  const waitingPlace = (b: Building, j: number, opener: number): number => {
    const kind = kinds[b.pi][j];
    const item = items[j];
    if (kind === 'none') return -1;
    if (kind === 'tall') {
      const tier = tierFor(b, item);
      return tier >= 0 ? tier : topFor(b, item);
    }
    const reserve = opener < items.length && kinds[b.pi][opener] === 'shelf';
    for (let k = 0; k < b.slots.length; k++) {
      if (b.tall.has(k) || !fitsIn(b, k, item)) continue;
      if (!reserve) return k;
      b.rows[k].push(item);
      const room = b.slots.some((_, x) => !b.tall.has(x) && fitsIn(b, x, items[opener]));
      b.rows[k].pop();
      if (room) return k;
    }
    return -1;
  };
  // PACK-KIND-1: on a wall of more than one profile, a figure tall for profile `pi` that no other profile can hold at all
  const only = kinds.map((ks, pi) => ks.map((k, j) => mixed && k === 'tall' && kinds.every((qs, q) => pattern[q] === pattern[pi] || qs[j] === 'none')));
  const onlyFor = (pi: number, j: number) => only[pi][j];
  /** The waiting figures in the order a cabinet of profile `pi` takes them: those only it can hold first, then the rest. */
  const waitingFor = (pi: number) => (mixed ? [...waiting.filter((j) => onlyFor(pi, j)), ...waiting.filter((j) => !onlyFor(pi, j))] : [...waiting]);
  // a cabinet the shelves open (for figure `at`) gives its places to the waiting tall figures first, each in turn that fits
  const giveTall = (b: Building, at: number) => {
    // (no place left as wide as the narrowest waiting figure: none of the rest fits, so none is tried; 1e-3 mm slack)
    let narrowest = Infinity;
    for (const j of waiting) narrowest = Math.min(narrowest, items[j].widthMm);
    const roomy = () => b.slots.some((s, k) => s.widthMm - b.rows[k].reduce((x, it) => x + span(it), 0) + 1e-3 >= narrowest);
    for (const j of waitingFor(b.pi)) {
      const k = waitingPlace(b, j, at);
      if (k >= 0) {
        b.rows[k].push(items[j]);
        waiting.splice(waiting.indexOf(j), 1);
        if (!roomy()) break;
      }
    }
  };
  /** The room left on the wall where the tall figures are kept: what they still want past it is what a new cabinet must take. */
  // (only room a tall figure still to come could stand in: as tall as the shortest of them, as wide as the narrowest)
  const keptRoom = (pi: number, at: number) => {
    const tallWaiting = waitingOf(pi, 'tall');
    const narrow = Math.min(ahead[pi].narrow[at], ...tallWaiting.map((i) => i.widthMm));
    const short = Math.min(ahead[pi].short[at], ...tallWaiting.map((i) => i.heightMm));
    // (PACK1: room behind the group's mark is no room for it, nor for the groups after it)
    return building.reduce(
      (w, b, c) =>
        w +
        [...b.tall].reduce((r, k) => {
          const room = b.slots[k].widthMm - b.rows[k].reduce((x, i) => x + span(i), 0);
          return r + (room >= narrow && b.slots[k].maxHeightMm >= short && tallFrom(c, k) ? room : 0);
        }, 0),
      0,
    );
  };

  /** Whether one cabinet of `stock` standing as `a` takes every figure still to place: the waiting tall ones, then those from `at` on. */
  const holdsRest = (stock: CabinetProfile, pi: number, a: Arrangement, keepTop: boolean, at: number): boolean => {
    const tall = new Set(a.tiers);
    if (keepTop) tall.add(a.slots.findIndex((x) => x.isTop));
    const b: Building = { stock, pi, profile: a.profile, slots: a.slots, rows: a.slots.map(() => []), tall };
    const tallIn = (item: CaseFigure) => {
      const tier = tierFor(b, item);
      const k = tier >= 0 ? tier : topFor(b, item);
      if (k < 0) return false;
      b.rows[k].push(item);
      return true;
    };
    const waitIn = (j: number) => {
      const k = waitingPlace(b, j, at);
      if (k >= 0) b.rows[k].push(items[j]);
      return k >= 0;
    };
    if (!waitingFor(pi).every(waitIn)) return false;
    let cursor = 0;
    for (let i = at; i < items.length; i++) {
      const kind = kinds[pi][i];
      if (kind === 'tall') {
        if (!tallIn(items[i])) return false;
      } else if (kind === 'shelf') {
        while (cursor < b.slots.length && (b.tall.has(cursor) || !fitsIn(b, cursor, items[i]))) cursor++;
        if (cursor === b.slots.length) return false;
        b.rows[cursor].push(items[i]);
      } else if (kinds.some((ks) => ks[i] !== 'none')) return false;
    }
    return true;
  };

  /** How a cabinet of `stock` opened with the figures from `at` still to place stands (CASE-FB2b). */
  const arrange = (stock: CabinetProfile, at: number): { a: Arrangement; keepTop: boolean } => {
    const all = arrangements(stock, ceilingMm);
    const pi = pattern.indexOf(stock);
    // PACK-KIND-1: of the waiting figures, only those tall for this profile want a tier or its top; its shelves hold the rest
    const tallWaiting = waitingOf(pi, 'tall');
    const widthOf = (list: readonly CaseFigure[]) => list.reduce((w, i) => w + span(i), 0);
    // past the last figure, the waiting ones fit nowhere on the wall: no room kept there counts for them
    const tallW = Math.max(0, widthOf(tallWaiting) + ahead[pi].tall[at] - (at >= items.length ? 0 : keptRoom(pi, at)));
    if (!rules.shelfRemoval || tallW === 0) return { a: all[0], keepTop: false };
    const shelfW = ahead[pi].shelf[at] + widthOf(waitingOf(pi, 'shelf'));
    // PACK-KIND-1: a waiting figure only this profile can hold has a place made for it here (else it opens cabinets at
    // the wall's end, the others of the pattern standing empty between)
    const onlyHere = waiting.find((j) => onlyFor(pi, j));
    // the next tall figure: a tier must fit it, or there is no use in one
    let next = onlyHere !== undefined ? items[onlyHere] : tallWaiting[0];
    for (let i = at; next === undefined && i < items.length; i++) if (kinds[pi][i] === 'tall') next = items[i];
    // a shelf figure opens this cabinet: one of its shelves (no top, no tier) must take it, so no cabinet is opened
    // for its glass to stand empty; past the last one, the first waiting figure must find a place
    const opener = at < items.length && kinds[pi][at] === 'shelf' ? items[at] : null;
    const atEnd = at >= items.length;
    const shortest = Math.min(ahead[pi].short[at], ...tallWaiting.map((i) => i.heightMm));
    const narrowest = Math.min(ahead[pi].narrow[at], ...tallWaiting.map((i) => i.widthMm));
    const scored: { a: Arrangement; keepTop: boolean; tallCap: number; glassCap: number }[] = [];
    for (const a of all) {
      const tierW = a.tiers.map((k) => a.slots[k].widthMm);
      const tierFits = a.tiers.some((k) => fitsSlot(a.slots[k], next!));
      if (a.tiers.length > 0 && !tierFits) continue;
      // never a tier no tall figure is left to fill
      if (tierW.length > 1 && tierW.reduce((x, y) => x + y, 0) - Math.min(...tierW) >= tallW) continue;
      const topSlot = a.slots.find((x) => x.isTop);
      const top = topSlot?.widthMm ?? 0;
      if ((atEnd || onlyHere !== undefined) && !tierFits && !(topSlot && fitsSlot(topSlot, next!))) continue;
      const glass = a.slots.reduce((w, x, k) => w + (x.isTop || a.tiers.includes(k) ? 0 : x.widthMm), 0);
      // never so many shelves out that, while shelf figures are still to come, no glass inside the door is left for them
      if (shelfW > 0 && !a.slots.some((x, k) => !x.isTop && !a.tiers.includes(k) && !a.profile.surfaces[x.surfaceIndex].outsideDoor)) continue;
      // a top is kept for tall figures only when one still to place could stand on it
      const keepable = top > 0 && within(shortest, topSlot!.maxHeightMm) && within(narrowest, top);
      for (const keepTop of keepable ? [false, true] : [false]) {
        if (opener && !a.slots.some((x, k) => !x.isTop && !a.tiers.includes(k) && fitsSlot(x, opener))) continue;
        scored.push({ a, keepTop, tallCap: tierW.reduce((x, y) => x + y, 0) + (keepTop ? top : 0), glassCap: glass + (keepTop ? 0 : top) });
      }
    }
    if (scored.length === 0) return { a: all[0], keepTop: false };
    // this cabinet can hold all that is left: the fewest shelves out that still do, no top kept unless needed
    if (Math.max(...scored.map((x) => x.tallCap + x.glassCap)) >= tallW + shelfW) {
      const order = [...scored].sort((x, y) => x.a.removed - y.a.removed || Number(x.keepTop) - Number(y.keepTop));
      const holds = order.find((x) => holdsRest(stock, pi, x.a, x.keepTop, at));
      if (holds) return holds;
    }
    // only the layouts no other beats on both: as much kept for tall figures and as much shelf (a taller tier than the
    // next tall figure needs, at the cost of a shelf, is no use to it)
    const fair = scored.filter((x) => !scored.some((y) => y !== x && y.tallCap >= x.tallCap && y.glassCap >= x.glassCap && (y.tallCap > x.tallCap || y.glassCap > x.glassCap)));
    const pick = (l: number) => {
      // the tall figures' share of what is still to place (counted `l` times over: a tall figure fills its place less
      // fully than a shelf figure its shelf), against each layout's share of its width kept for them
      const r = (l * tallW) / (l * tallW + shelfW);
      const off = (x: (typeof scored)[number]) => Math.abs(x.tallCap / (x.tallCap + x.glassCap) - r);
      const best = Math.min(...fair.map(off));
      // of the layouts as near: the fewest shelves out, then no top kept unless needed, then the highest tier (their order, EYE-1)
      const near = fair.filter((x) => off(x) <= best + IN_STEP_SLACK);
      near.sort((x, y) => x.a.removed - y.a.removed || Number(x.keepTop) - Number(y.keepTop));
      return near[0];
    };
    const chosen = pick(lean);
    // (PACK-KIND-1: whether another lean to be tried would stand this cabinet otherwise)
    leaned ||= leans.some((l) => l !== lean && pick(l) !== chosen);
    return chosen;
  };

  const open = (c: number, at: number): Building => {
    while (building.length <= c) {
      const pi = building.length % pattern.length;
      const stock = pattern[pi];
      const { a, keepTop } = arrange(stock, at);
      const tall = new Set(a.tiers);
      if (keepTop && a.slots.some((x) => x.isTop)) tall.add(a.slots.findIndex((x) => x.isTop));
      const b: Building = { stock, pi, profile: a.profile, slots: a.slots, rows: a.slots.map(() => []), tall };
      building.push(b);
      if (rules.tallOnOpenedTops || rules.shelfRemoval) giveTall(b, at);
    }
    return building[c];
  };

  let cab = 0;
  let k = 0;
  /**
   * PACK1: where group `g`, starting at figure `i`, starts: on the room left on the shelf cursor's place when all its
   * shelf figures fit there, or when they would not fit one such shelf anyway; else on the next place.
   */
  const startOf = (i: number, g: string) => {
    const b = building[cab];
    if (b === undefined || k >= b.slots.length || b.rows[k].length === 0) return { cab, k };
    const kind = kinds[pattern.indexOf(b.stock)];
    const slot = b.slots[k];
    let widthMm = 0;
    let fits = !b.tall.has(k);
    for (let j = i; j < items.length && groups![j] === g; j++) {
      if (kind[j] !== 'shelf') continue;
      widthMm += span(items[j]);
      fits &&= within(items[j].heightMm, slot.maxHeightMm);
    }
    // (each span counts the gap after its figure: the last one needs none)
    const left = slot.widthMm - b.rows[k].reduce((x, it) => x + span(it), 0) + FIGURE_GAP_MM;
    return (fits && within(widthMm, left)) || !within(widthMm, slot.widthMm + FIGURE_GAP_MM) ? { cab, k } : { cab, k: k + 1 };
  };
  for (const [i, item] of items.entries()) {
    if (groups !== undefined) {
      const g = groups[i] ?? null;
      grouped = g !== null;
      if (g !== null && (i === 0 || g !== groups[i - 1])) mark = startOf(i, g);
    }
    if (kinds.every((ks) => ks[i] === 'none')) {
      violators.push({ item, reason: violation(item, pattern, ceilingMm, rules.shelfRemoval).reason });
      continue;
    }
    const here = open(cab, i);
    const kindHere = kinds[pattern.indexOf(here.stock)][i];
    const tallHere = kindHere === 'tall';
    // tall here, or (with the new rules) on no shelf here but tall in another cabinet of the pattern: the tall places,
    // never the shelf cursor, which passes them by
    if ((tallHere || (kindHere === 'none' && kinds.some((ks) => ks[i] === 'tall'))) && (rules.tallOnOpenedTops || rules.shelfRemoval)) {
      // tall for the cursor's cabinet: the earliest place on the wall with room, else wait for the next cabinet
      const place = tallPlace(item, i);
      if (place) place[0].rows[place[1]].push(item);
      else waiting.push(i);
      continue;
    }
    // PACK-KIND-1: a shelf figure here that another cabinet of the pattern calls tall takes the earliest tier or top
    // that cabinet keeps for it with room first, so no place kept for it stands empty behind the shelf cursor
    if (deviate && kinds.some((ks) => ks[i] === 'tall') && (rules.tallOnOpenedTops || rules.shelfRemoval)) {
      const place = tallPlace(item, i, true);
      if (place) {
        place[0].rows[place[1]].push(item);
        deviated = true;
        continue;
      }
    }
    if (tallHere) {
      // (off) the first top from here on with room
      let c = cab;
      for (;;) {
        const b = open(c, i);
        const t = topOf(b);
        if (t >= 0 && fitsIn(b, t, item)) {
          b.rows[t].push(item);
          break;
        }
        c++;
      }
      continue;
    }
    if (grouped) {
      // PACK1: the first place from the group's mark with room: a gap the group left, else from the cursor on
      for (let c = mark.cab, j = mark.k; ; j++) {
        const b = open(c, i);
        if (j >= b.slots.length) {
          c++;
          j = -1;
          continue;
        }
        if (mayTake(b, j, i) && fitsIn(b, j, item)) {
          b.rows[j].push(item);
          if (c > cab || (c === cab && j > k)) [cab, k] = [c, j];
          break;
        }
      }
      continue;
    }
    for (;;) {
      const b = open(cab, i);
      if (k >= b.slots.length) {
        cab++;
        k = 0;
        continue;
      }
      // the shelf figures pass by what is kept for the tall ones (PACK-KIND-1: unless tall for this cabinet)
      if (mayTake(b, k, i) && fitsIn(b, k, item)) {
        b.rows[k].push(item);
        break;
      }
      k++;
    }
  }
  // the shelf figures all placed: the tall figures still waiting open cabinets at the wall's end
  while (waiting.length > 0) open(building.length, items.length);
  const isEmpty = (b: Building) => b.rows.every((row) => row.length === 0);
  /** A cabinet as it was bought: its stock shelves, nothing kept for tall figures. */
  const restock = (b: Building) => {
    const a = arrangements(b.stock, ceilingMm)[0];
    Object.assign(b, { profile: a.profile, slots: a.slots, rows: a.slots.map(() => []), tall: new Set<number>() });
  };
  if (mixed) {
    // PACK-KIND-1: a cabinet the wall stands only to reach a later one (for the figures only that one holds) takes a
    // figure from before it: the last one on a place not kept for tall figures (the shelf figures keep their order), else
    // one from a tier, its cabinet then standing with as few shelves out as hold the rest; never one that empties its own
    // cabinet, nor one that leaves a top or tier it is tall for empty behind it
    const at = new Map(items.map((item, j) => [item, j] as const));
    const count = (b: Building) => b.rows.reduce((n, row) => n + row.length, 0);
    // PACK1: each figure's series as the arrangement orders them: where its group starts (one of no group, where it is)
    const starts = new Map<string, number>();
    const series = items.map((_, j) => {
      const g = groups?.[j] ?? null;
      if (g !== null && !starts.has(g)) starts.set(g, j);
      return g === null ? j : starts.get(g)!;
    });
    /** Whether a shelf figure everywhere, `j`, would pass a figure of a later series standing from cabinet `c` to before `e`. */
    const passesLater = (c: number, e: number, j: number) =>
      groups !== undefined &&
      kinds.every((ks) => ks[j] === 'shelf') &&
      building.slice(c, e).some((x) => x.rows.some((row) => row.some((it) => series[at.get(it)!] > series[j])));
    /**
     * Stands `b`, whose figures all stand where it keeps room for tall ones (so all are tall for it), again in the
     * arrangement with the fewest shelves out, fewer than now, that holds them: each in a tier, else on its top.
     */
    const relayout = (b: Building) => {
      const figs = b.rows.flat();
      for (const a of arrangements(b.stock, ceilingMm)) {
        if (a.removed >= (b.profile.layout?.removed.length ?? 0)) return;
        const trial: Building = { stock: b.stock, pi: b.pi, profile: a.profile, slots: a.slots, rows: a.slots.map(() => []), tall: new Set(a.tiers) };
        const placed = figs.every((f) => {
          const tier = tierFor(trial, f);
          const t = tier >= 0 ? tier : topFor(trial, f);
          if (t >= 0) {
            trial.rows[t].push(f);
            trial.tall.add(t);
          }
          return t >= 0;
        });
        if (placed) {
          Object.assign(b, trial);
          return;
        }
      }
    };
    /** Whether figure `j` would leave a top or tier it is tall for, and fits, empty in a cabinet from `c` to before `e`. */
    const leavesBehind = (c: number, e: number, j: number) =>
      building
        .slice(c, e)
        .some((x) => kinds[x.pi][j] === 'tall' && x.slots.some((s, q) => (s.isTop || x.tall.has(q)) && x.rows[q].length === 0 && fitsIn(x, q, items[j])));
    /**
     * Moves the figure last in row `k` of cabinet `c` to empty cabinet `e`, if it may go, and returns how to put it back
     * (else changes nothing): `emptying`, even the only figure of its cabinet.
     */
    const move = (c: number, k: number, e: number, emptying = false): (() => void) | null => {
      const src = building[c];
      const b = building[e];
      if (!emptying && count(src) < 2) return null;
      const j = at.get(src.rows[k][src.rows[k].length - 1])!;
      if (passesLater(c, e, j)) return null;
      const place = kinds[b.pi][j] === 'shelf' ? b.slots.findIndex((_, x) => fitsIn(b, x, items[j])) : kinds[b.pi][j] === 'tall' ? topFor(b, items[j]) : -1;
      if (place < 0) return null;
      const was = { profile: src.profile, slots: src.slots, rows: src.rows.map((row) => [...row]), tall: new Set(src.tall) };
      src.rows[k].pop();
      if (src.tall.has(k)) relayout(src);
      if (leavesBehind(c, e, j)) {
        Object.assign(src, was);
        return null;
      }
      b.rows[place].push(items[j]);
      return () => {
        b.rows[place].pop();
        Object.assign(src, was);
      };
    };
    /**
     * Fills empty cabinet `e` with the last figure before it on a place not kept for tall figures (the shelf figures keep
     * their order); when that is its cabinet's only figure, that cabinet is filled the same way in turn, each figure
     * stepping one cabinet on, else nothing moves.
     */
    const fillFrom = (e: number): boolean => {
      let c = e - 1;
      let k = -1;
      for (; c >= 0 && k < 0; c--) k = building[c].rows.findLastIndex((row, x) => row.length > 0 && !building[c].tall.has(x));
      if (k < 0) return false;
      if (count(building[++c]) >= 2) return move(c, k, e) !== null;
      const undo = move(c, k, e, true);
      if (undo === null) return false;
      restock(building[c]);
      if (fillFrom(c)) return true;
      undo();
      return false;
    };
    let last = building.length - 1;
    while (last > 0 && isEmpty(building[last])) last--;
    for (let e = 1; e < last; e++) {
      if (!isEmpty(building[e])) continue;
      restock(building[e]);
      if (fillFrom(e)) continue;
      // else one from a tier, the latest first, of a cabinet with no figure on a place not kept for tall ones (standing it
      // with fewer shelves out moves no shelf figure, so no series starts anywhere else)
      search: for (let c = e - 1; c >= 0; c--) {
        const src = building[c];
        if (src.rows.some((row, x) => row.length > 0 && !src.tall.has(x))) continue;
        for (let k = src.slots.length - 1; k >= 0; k--) {
          if (src.tall.has(k) && !src.slots[k].isTop && src.rows[k].length > 0 && move(c, k, e) !== null) break search;
        }
      }
    }
  }
  // CASE-FB2b: a cabinet left empty stands with its stock shelves
  for (const b of building) if (isEmpty(b) && (b.profile.layout?.removed.length ?? 0) > 0) restock(b);
  return { building, violators, deviated, leaned };
}

/** The packed cabinets, each row centred on its surface, each figure centred in its depth (CASE-FB2a). */
function assemble(building: Building[]): PackedCabinet[] {
  return building.map((b, index) => ({
    index,
    profile: b.profile,
    surfaces: b.slots.map((slot, j) => {
      const row = b.rows[j];
      const total = row.reduce((sum, i) => sum + i.widthMm, 0) + FIGURE_GAP_MM * Math.max(0, row.length - 1);
      let x = (slot.widthMm - total) / 2;
      const placed = row.map((item) => {
        const base = baseDepth(slot, item.depthMm);
        const p: PlacedFigure = { item, xMm: x, zMm: base.frontMm, base, heightMm: item.heightMm, tooDeep: !within(item.depthMm, slot.depthMm) };
        x += item.widthMm + FIGURE_GAP_MM;
        return p;
      });
      return { surfaceIndex: slot.surfaceIndex, slot, items: placed };
    }),
  }));
}

/** One cabinet's place along the wall, mm: x = 0 is the first cabinet's left side. */
export interface WallSlot {
  readonly profile: CabinetProfile;
  readonly leftMm: number;
  readonly rightMm: number;
  readonly centerMm: number;
  /** Body to body from the cabinet on its left (its adjacency gap); 0 for the first. */
  readonly gapBeforeMm: number;
}

export interface WallLayout {
  readonly cabinets: WallSlot[];
  /** The wall's extent including the first and last cabinets' feet. */
  readonly leftMm: number;
  readonly rightMm: number;
}

/**
 * Cabinets side by side, left to right, each as close to its neighbour as
 * their legs allow (adjacencyGapMm: two KLINGSBOs never touch, Detolfs butt
 * together). Positions are in the real world, never fitted to a screen.
 */
export function wallLayout(profiles: readonly CabinetProfile[]): WallLayout {
  const cabinets: WallSlot[] = [];
  let x = 0;
  profiles.forEach((profile, i) => {
    const gapBeforeMm = i === 0 ? 0 : adjacencyGapMm(profiles[i - 1], profile);
    const leftMm = x + gapBeforeMm;
    const rightMm = leftMm + profile.outer.widthMm;
    cabinets.push({ profile, leftMm, rightMm, centerMm: leftMm + profile.outer.widthMm / 2, gapBeforeMm });
    x = rightMm;
  });
  if (cabinets.length === 0) return { cabinets, leftMm: 0, rightMm: 0 };
  const first = cabinets[0];
  const lastSlot = cabinets[cabinets.length - 1];
  return {
    cabinets,
    leftMm: first.leftMm - sideOverhangMm(first.profile),
    rightMm: lastSlot.rightMm + sideOverhangMm(lastSlot.profile),
  };
}
