/**
 * Packing a collection into cabinets (CAB-PACK) and the will-it-fit check
 * (FIT-CHECK), in millimetres, from the cabinet PROFILE only: the viewport,
 * the view and the camera never change where a figure stands, and no figure
 * is ever scaled (Ross 09-26: faithful, no stretching, no padding).
 *
 * Reading order: each cabinet's top first (outside the case, CC9 clearance),
 * then its shelves top to bottom, each left to right. Figures follow the
 * list order; a figure that fits no compartment of its cabinet but fits the
 * top goes to the top (design v3, CC9); a figure that fits nowhere is a
 * violator, listed with its reason, never placed. Overflow opens the next
 * cabinet of the wall pattern (the profiles cycle: the Detolf with the rack
 * alongside, CC16).
 */
import type { Figure } from '@figurecollecting/fc-shared';
import { CEILING_DEFAULT_MM, FIT_EPSILON_MM, clearHeightsMm, topClearanceMm } from './cabinetProfile';
import type { CabinetProfile } from './cabinetProfile';
import type { FigureDisplayMeta } from './displayMeta';
import { resolveDepthMm, resolveHeightMm } from './sizeResolution';

/** Space left between neighbours on a surface. */
export const FIGURE_GAP_MM = 10;
/** A figure with no size data and no scale: about a 1/8 standing figure, flagged as estimated. */
export const DEFAULT_FIGURE_HEIGHT_MM = 200;
/** Above this a height is scraper-corrupted data (sizeResolution's ceiling). */
const MAX_PLAUSIBLE_HEIGHT_MM = 2500;

/** One figure as the packer sees it: its physical size, mm. */
export interface CaseFigure {
  readonly figure: Figure;
  /** Its position in the list the screen shows (the tap's onSelect index). */
  readonly index: number;
  readonly heightMm: number;
  /** Footprint width: labelled, else the picture's width at that height. */
  readonly widthMm: number;
  /** The picture's width at heightMm: what the billboard draws. */
  readonly billboardWidthMm: number;
  readonly depthMm: number;
  /** True when the height is a scale estimate or the default, not a measurement. */
  readonly heightEstimated: boolean;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function measureCaseFigure(figure: Figure, index: number, meta: FigureDisplayMeta): CaseFigure {
  const resolved = resolveHeightMm(figure);
  const heightMm = Math.min(resolved?.heightMm ?? DEFAULT_FIGURE_HEIGHT_MM, MAX_PLAUSIBLE_HEIGHT_MM);
  const billboardWidthMm = meta.aspect * heightMm;
  const labelledWidth = figure.dimensions?.widthMm;
  return {
    figure,
    index,
    heightMm,
    widthMm: positive(labelledWidth) ? labelledWidth : billboardWidthMm,
    billboardWidthMm,
    depthMm: resolveDepthMm(figure, meta, heightMm).depthMm,
    heightEstimated: resolved?.source !== 'labeled',
  };
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
}

/** The profile's surfaces in reading order: the top (when usable), then the shelves top to bottom. */
export function surfaceSlots(profile: CabinetProfile, ceilingMm: number = CEILING_DEFAULT_MM): SurfaceSlot[] {
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
    });
  }
  const frontWall = profile.rack ? profile.rack.postMm : profile.materials.front === 'glassDoor' ? (profile.glassMm ?? 0) : 0;
  for (let i = last - 1; i >= 0; i--) {
    const s = surfaces[i];
    const onPlate = profile.plate !== undefined && s.material === 'glass';
    slots.push({
      surfaceIndex: i,
      isTop: false,
      topMm: s.topMm,
      maxHeightMm: clear[i],
      widthMm: onPlate ? profile.plate!.widthMm : profile.interior.widthMm,
      depthMm: onPlate ? profile.plate!.depthMm : profile.interior.depthMm,
      frontZMm: onPlate ? -profile.plate!.frontInsetMm : -frontWall,
    });
  }
  return slots;
}

export type FitVerdict = 'fits' | 'top-only' | 'too-tall' | 'too-wide' | 'too-deep';

export interface FitResult {
  readonly verdict: FitVerdict;
  /** Taller than every compartment and the top's clearance. */
  readonly tooTall: boolean;
  /** Deeper than every surface it could stand on. */
  readonly tooDeep: boolean;
}

const within = (size: number, limit: number) => size <= limit + FIT_EPSILON_MM;

/** FIT-CHECK: will this figure fit this cabinet, and where? */
export function fitCheck(profile: CabinetProfile, item: CaseFigure, ceilingMm: number = CEILING_DEFAULT_MM): FitResult {
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
  /** The billboard's plane: the middle of the slot's depth. */
  readonly zMm: number;
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

export type ViolatorReason = Exclude<FitVerdict, 'fits' | 'top-only'>;

export interface Violator {
  readonly item: CaseFigure;
  readonly reason: ViolatorReason;
}

export interface PackResult {
  readonly cabinets: PackedCabinet[];
  readonly violators: Violator[];
}

interface Building {
  profile: CabinetProfile;
  slots: SurfaceSlot[];
  rows: CaseFigure[][];
}

function rowWidth(row: readonly CaseFigure[], extra: CaseFigure): number {
  return row.reduce((sum, i) => sum + i.widthMm + FIGURE_GAP_MM, 0) + extra.widthMm;
}

export function packCabinets(
  items: readonly CaseFigure[],
  pattern: readonly CabinetProfile[],
  ceilingMm: number = CEILING_DEFAULT_MM,
): PackResult {
  if (pattern.length === 0) throw new RangeError('packCabinets needs at least one cabinet profile');
  const building: Building[] = [];
  const violators: Violator[] = [];
  const open = (c: number): Building => {
    while (building.length <= c) {
      const profile = pattern[building.length % pattern.length];
      const slots = surfaceSlots(profile, ceilingMm);
      building.push({ profile, slots, rows: slots.map(() => []) });
    }
    return building[c];
  };
  const fitsIn = (b: Building, k: number, item: CaseFigure) =>
    within(item.heightMm, b.slots[k].maxHeightMm) && within(rowWidth(b.rows[k], item), b.slots[k].widthMm);

  let cab = 0;
  let k = 0;
  for (const item of items) {
    const checks = pattern.map((p) => fitCheck(p, item, ceilingMm));
    const usable = checks.filter((c) => c.verdict === 'fits' || c.verdict === 'top-only');
    if (usable.length === 0) {
      violators.push({ item, reason: checks[0].verdict as ViolatorReason });
      continue;
    }
    // Top-only for the cursor's cabinet: the first top from here on with room.
    const here = open(cab);
    const topOnlyHere = fitCheck(here.profile, item, ceilingMm).verdict === 'top-only';
    if (topOnlyHere) {
      let c = cab;
      for (;;) {
        const b = open(c);
        const t = b.slots.findIndex((s) => s.isTop);
        if (t >= 0 && fitsIn(b, t, item)) {
          b.rows[t].push(item);
          break;
        }
        c++;
      }
      continue;
    }
    for (;;) {
      const b = open(cab);
      if (k >= b.slots.length) {
        cab++;
        k = 0;
        continue;
      }
      if (fitsIn(b, k, item)) {
        b.rows[k].push(item);
        break;
      }
      k++;
    }
  }

  const cabinets: PackedCabinet[] = building.map((b, index) => ({
    index,
    profile: b.profile,
    surfaces: b.slots.map((slot, j) => {
      const row = b.rows[j];
      const total = row.reduce((sum, i) => sum + i.widthMm, 0) + FIGURE_GAP_MM * Math.max(0, row.length - 1);
      let x = (slot.widthMm - total) / 2;
      const zMm = slot.frontZMm - slot.depthMm / 2;
      const placed = row.map((item) => {
        const p: PlacedFigure = { item, xMm: x, zMm, heightMm: item.heightMm, tooDeep: !within(item.depthMm, slot.depthMm) };
        x += item.widthMm + FIGURE_GAP_MM;
        return p;
      });
      return { surfaceIndex: slot.surfaceIndex, slot, items: placed };
    }),
  }));
  return { cabinets, violators };
}
