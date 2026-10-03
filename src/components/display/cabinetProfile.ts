/**
 * Cabinet profiles: the physical description of one display cabinet, in
 * millimetres, independent of the screen, the camera and the figures.
 *
 * World (case-cabinet-design v1/v2): y = 0 is the room floor; every height
 * here is measured from it. A profile lists its display SURFACES floor-up;
 * the last one is the top, outside the case, at the outer height. Clear
 * heights are derived (never stored), so they cannot drift from the surfaces.
 *
 * Presets are data (cabinetPresets.ts). checkCabinetProfile is the registry
 * invariant: a preset added as data only is covered by it (G19).
 *
 * CC9 (Ross 2026-09-29): rooms are about 8 ft and most cabinets have about
 * 2 ft of top clearance. topClearanceMm = max(0, min(24 in, ceiling - outer
 * height)), ceiling 96 in by default (a user setting later). Inch constants
 * and inch-native presets are exact (x 25.4), never rounded to whole mm;
 * round only for display.
 */

/** 24 in: the CC9 cap on what may stand on a cabinet's top. Never 610. */
export const TOP_CLEARANCE_CAP_MM = 609.6;
/** 96 in: the CC9 default room ceiling (an 8 ft room). */
export const CEILING_DEFAULT_MM = 2438.4;
/** v1 framing rule: headroom = max(300, tallest top figure + 40), now capped by the clearance. */
export const HEADROOM_MIN_MM = 300;
export const HEADROOM_PAD_MM = 40;
/** v1 invariant tolerance: the stack and the top surface meet the outer height within 5 mm. */
export const STACK_TOLERANCE_MM = 5;
/** Goldens compare within 1e-6 mm; the same slack absorbs float drift in fit and fit-inside checks. */
export const FIT_EPSILON_MM = 1e-6;

/**
 * Inches to mm, returning the double nearest the exact decimal product
 * (24 in -> 609.6, where a bare 24 * 25.4 gives 609.5999999999999). Exact for
 * any value in 1/64 in; finer fractions round at the nanometre, inside the
 * 1e-6 mm golden tolerance.
 */
export function inchesToMm(inches: number): number {
  return Math.round(inches * 25_400_000) / 1_000_000;
}

/**
 * Where a value comes from: measured (someone's tape), cited (the maker or a
 * published source), derived (arithmetic from other values; 'verify' on
 * screen), placeholder (a stand-in until real sizes arrive; marked on screen).
 */
export type ProvenanceKind = 'measured' | 'cited' | 'derived' | 'placeholder';

export interface Provenance {
  readonly kind: ProvenanceKind;
  /** Who or what says so. Never empty. */
  readonly source: string;
}

export type CabinetFrame = 'panels' | 'open-rack';
export type WallMaterial = 'glass' | 'wood' | 'metal' | 'open';
export type BackMaterial = 'glass' | 'solid' | 'mirror' | 'open';
export type FrontMaterial = 'glassDoor' | 'open';
export type SurfaceMaterial = 'glass' | 'wood' | 'metal';
export type BaseStyle = 'none' | 'plinth' | 'legs' | 'feet' | 'casters' | 'posts';

/** One display surface: a base floor, a shelf, or the top. */
export interface CabinetSurface {
  readonly name: string;
  /** Floor to the top of this surface. */
  readonly topMm: number;
  /** The solid under that top: glass, a board, or a rack's beam. */
  readonly thicknessMm: number;
  readonly material: SurfaceMaterial;
  /** Max load on this surface; null = not published or unknown (CC9 weight, checked later). */
  readonly maxLoadKg: number | null;
  /** Provenance of topMm. */
  readonly provenance: Provenance;
}

/** CC5: 'fit shelves to figures' exists only for adjustable profiles. */
export type ShelfMode = { readonly mode: 'fixed' } | { readonly mode: 'adjustable'; readonly pinPitchMm: number };

export interface LegSpec {
  readonly sectionMm?: number;
  readonly insetXMm?: number;
  readonly insetZMm?: number;
  readonly taper?: boolean;
}

export interface ProfileProvenance {
  readonly outer: Provenance;
  readonly interior: Provenance;
  readonly panels: Provenance;
  /** Surface thicknesses (glass, boards, beams). */
  readonly boards: Provenance;
  /** Fixed or adjustable, and the pin pitch. */
  readonly shelves: Provenance;
  readonly base: Provenance;
  readonly glass?: Provenance;
  readonly plate?: Provenance;
  readonly rack?: Provenance;
  readonly loads?: Provenance;
}

export interface CabinetProfile {
  /** Stable key: the registry key and, later, the stored user choice. */
  readonly id: string;
  readonly name: string;
  readonly maker?: string;
  /** 1 = most preferred; the chooser lists presets in this order. */
  readonly preferenceRank: number;
  readonly frame: CabinetFrame;
  /** heightMm = floor to the top surface, legs included. */
  readonly outer: { readonly widthMm: number; readonly depthMm: number; readonly heightMm: number };
  /** Usable inside width and depth (what figures pack against). */
  readonly interior: { readonly widthMm: number; readonly depthMm: number };
  /** Side and back wall thickness, whatever the material; 0 when open. */
  readonly panels: { readonly sideMm: number; readonly backMm: number };
  readonly materials: { readonly sides: WallMaterial; readonly back: BackMaterial; readonly front: FrontMaterial };
  /** Pane thickness of glass walls and doors; null when there are none. */
  readonly glassMm: number | null;
  /** Floor-up; the last is the top (outside the case). */
  readonly surfaces: readonly CabinetSurface[];
  readonly shelves: ShelfMode;
  /** A shelf plate smaller than the interior (e.g. the Detolf's glass), set back from the front. */
  readonly plate?: { readonly widthMm: number; readonly depthMm: number; readonly frontInsetMm: number };
  readonly top: { readonly usable: boolean; readonly lipMm?: number };
  readonly base: { readonly style: BaseStyle; readonly heightMm: number; readonly leg?: LegSpec };
  /** Open-rack frames: corner posts (they are the legs) and the front beam under each level. */
  readonly rack?: { readonly postMm: number; readonly beamMm: number };
  readonly provenance: ProfileProvenance;
}

/** The structural part the CC9 rules read; any profile (or a bare height) satisfies it. */
export interface HasOuterHeight {
  readonly outer: { readonly heightMm: number };
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number of mm, got ${value}`);
}

/** CC9 before the floor: min(24 in, ceiling - outer height). Negative = taller than the room. */
export function topClearanceRawMm(profile: HasOuterHeight, ceilingMm: number = CEILING_DEFAULT_MM): number {
  requireFinite(ceilingMm, 'ceilingMm');
  return Math.min(TOP_CLEARANCE_CAP_MM, ceilingMm - profile.outer.heightMm);
}

/** CC9: max(0, min(24 in, ceiling - outer height)): how tall a figure may stand on the top. */
export function topClearanceMm(profile: HasOuterHeight, ceilingMm: number = CEILING_DEFAULT_MM): number {
  return Math.max(0, topClearanceRawMm(profile, ceilingMm));
}

/**
 * G17: may a figure this tall stand on the top? One over the clearance is a
 * violator; one of exactly the clearance fits (within 1e-6 mm). A top that is
 * not usable, or has no clearance (a cabinet as tall as the room or taller),
 * takes nothing; a figure height of zero or less, or NaN, never fits.
 */
export function fitsOnTop(profile: CabinetProfile, figureHeightMm: number, ceilingMm: number = CEILING_DEFAULT_MM): boolean {
  if (!profile.top.usable || !(figureHeightMm > 0)) return false;
  const clearanceMm = topClearanceMm(profile, ceilingMm);
  return clearanceMm > 0 && figureHeightMm <= clearanceMm + FIT_EPSILON_MM;
}

/**
 * CC9 framing headroom above the top: min(clearance, max(300, tallest top
 * figure + 40)), from the UNFILTERED collection; null = nothing on the top.
 */
export function framingHeadroomMm(
  profile: HasOuterHeight,
  tallestTopFigureMm: number | null,
  ceilingMm: number = CEILING_DEFAULT_MM,
): number {
  let wanted = HEADROOM_MIN_MM;
  if (tallestTopFigureMm !== null) {
    requireFinite(tallestTopFigureMm, 'tallestTopFigureMm');
    wanted = Math.max(HEADROOM_MIN_MM, tallestTopFigureMm + HEADROOM_PAD_MM);
  }
  return Math.min(topClearanceMm(profile, ceilingMm), wanted);
}

/** Clear height of each compartment, bottom to top: the next surface's underside minus this surface's top. */
export function clearHeightsMm(profile: CabinetProfile): number[] {
  const { surfaces } = profile;
  const clear: number[] = [];
  for (let i = 0; i + 1 < surfaces.length; i++) {
    clear.push(surfaces[i + 1].topMm - surfaces[i + 1].thicknessMm - surfaces[i].topMm);
  }
  return clear;
}

/**
 * The v1 stack: base + every board + every clear height. Meets the outer
 * height within 5 mm when consistent. The clear heights are derived from the
 * surfaces, so this sum equals base + the bottom board + (top surface's top -
 * first surface's top): no interior shelf, and no board but the bottom one,
 * appears in it.
 */
export function stackSumMm(profile: CabinetProfile): number {
  const boards = profile.surfaces.reduce((sum, s) => sum + s.thicknessMm, 0);
  const clear = clearHeightsMm(profile).reduce((sum, c) => sum + c, 0);
  return profile.base.heightMm + boards + clear;
}

/** The registry invariant checks, in the order they run. */
export type ProfileCheck = 'dimensions' | 'ascending' | 'gap' | 'top-height' | 'stack-sum' | 'clearance' | 'interior';

const isPositive = (v: number) => Number.isFinite(v) && v > 0;
const isNonNegative = (v: number) => Number.isFinite(v) && v >= 0;

function dimensionsOk(p: CabinetProfile): boolean {
  const positive = [
    p.outer.widthMm,
    p.outer.depthMm,
    p.outer.heightMm,
    p.interior.widthMm,
    p.interior.depthMm,
    ...p.surfaces.flatMap((s) => [s.topMm, s.thicknessMm]),
  ];
  if (p.glassMm !== null) positive.push(p.glassMm);
  if (p.shelves.mode === 'adjustable') positive.push(p.shelves.pinPitchMm);
  if (p.rack) positive.push(p.rack.postMm, p.rack.beamMm);
  if (p.plate) positive.push(p.plate.widthMm, p.plate.depthMm);
  const nonNegative = [p.panels.sideMm, p.panels.backMm, p.base.heightMm];
  for (const s of p.surfaces) if (s.maxLoadKg !== null) nonNegative.push(s.maxLoadKg);
  if (p.plate) nonNegative.push(p.plate.frontInsetMm);
  const optional = [p.top.lipMm, p.base.leg?.sectionMm, p.base.leg?.insetXMm, p.base.leg?.insetZMm];
  for (const v of optional) if (v !== undefined) nonNegative.push(v);
  return (
    Number.isInteger(p.preferenceRank) &&
    p.preferenceRank >= 1 &&
    positive.every(isPositive) &&
    nonNegative.every(isNonNegative)
  );
}

function ascendingOk(p: CabinetProfile): boolean {
  if (p.surfaces.length === 0) return false;
  return p.surfaces.every((s, i) => i === 0 || s.topMm > p.surfaces[i - 1].topMm);
}

function interiorOk(p: CabinetProfile): boolean {
  const wall = Math.max(p.panels.sideMm, p.rack?.postMm ?? 0);
  const fitsWidth = p.interior.widthMm <= p.outer.widthMm - 2 * wall + FIT_EPSILON_MM;
  const fitsDepth = p.interior.depthMm <= p.outer.depthMm - p.panels.backMm + FIT_EPSILON_MM;
  const plate = p.plate;
  const plateFits =
    !plate ||
    (plate.widthMm <= p.interior.widthMm + FIT_EPSILON_MM &&
      plate.frontInsetMm + plate.depthMm <= p.interior.depthMm + FIT_EPSILON_MM);
  return fitsWidth && fitsDepth && plateFits;
}

/**
 * G19 registry invariant. Returns the names of the checks the profile FAILS
 * (empty = valid). Each check is written so a NaN fails it.
 * - dimensions: sizes finite and positive (panels, base, loads, insets >= 0), rank a whole number >= 1
 * - ascending: at least one surface, tops strictly ascending
 * - gap: each surface sits at least its own board above the one below (clear >= 0)
 * - top-height: the top surface is the outer height (within 5 mm)
 * - stack-sum: base + boards + clear heights = outer height (within 5 mm). With
 *   clear heights derived (stackSumMm), and given top-height, this pins base +
 *   bottom board to the first surface's top; no interior shelf or board can fail it
 * - clearance: the cabinet fits the room: raw ceiling - height >= 0 (the floored value never fails)
 * - interior: the interior fits inside the walls (or rack posts) and the shelf plate inside the interior
 */
export function checkCabinetProfile(profile: CabinetProfile, ceilingMm: number = CEILING_DEFAULT_MM): ProfileCheck[] {
  const { surfaces, outer } = profile;
  const top = surfaces[surfaces.length - 1];
  const results: [ProfileCheck, boolean][] = [
    ['dimensions', dimensionsOk(profile)],
    ['ascending', ascendingOk(profile)],
    ['gap', clearHeightsMm(profile).every((c) => c >= 0)],
    ['top-height', top !== undefined && Math.abs(top.topMm - outer.heightMm) <= STACK_TOLERANCE_MM],
    ['stack-sum', Math.abs(stackSumMm(profile) - outer.heightMm) <= STACK_TOLERANCE_MM],
    ['clearance', topClearanceRawMm(profile, ceilingMm) >= 0],
    ['interior', interiorOk(profile)],
  ];
  return results.filter(([, ok]) => !ok).map(([name]) => name);
}

export type RegistryIssue = 'duplicate-id' | 'duplicate-rank' | 'missing-default';

/** Registry-level invariant: unique ids, unique preference ranks, and the default present. */
export function checkCabinetRegistry(presets: readonly CabinetProfile[], defaultId: string): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  if (new Set(presets.map((p) => p.id)).size !== presets.length) issues.push('duplicate-id');
  if (new Set(presets.map((p) => p.preferenceRank)).size !== presets.length) issues.push('duplicate-rank');
  if (!presets.some((p) => p.id === defaultId)) issues.push('missing-default');
  return issues;
}

export interface UnverifiedField {
  /** A provenance group ('interior', 'boards', ...) or 'surface:<name>'. */
  readonly field: string;
  readonly kind: 'derived' | 'placeholder';
  readonly source: string;
}

/**
 * What the screen must mark: derived values ('verify') and placeholders,
 * provenance groups first, then surfaces floor-up. Measured and cited values
 * are not listed.
 */
export function unverifiedFields(profile: CabinetProfile): UnverifiedField[] {
  const entries: [string, Provenance | undefined][] = [
    ...(Object.entries(profile.provenance) as [string, Provenance | undefined][]),
    ...profile.surfaces.map((s): [string, Provenance] => [`surface:${s.name}`, s.provenance]),
  ];
  const flagged: UnverifiedField[] = [];
  for (const [field, provenance] of entries) {
    if (provenance?.kind === 'derived' || provenance?.kind === 'placeholder') {
      flagged.push({ field, kind: provenance.kind, source: provenance.source });
    }
  }
  return flagged;
}

/**
 * Thin adapter for CaseShelf's fixed mode until CAB-RENDER-1 moves it onto
 * caseCamera (remove it then). Today every shelf band is drawn at one height,
 * so fixed mode needs ONE compartment height as its mm -> px anchor: the
 * smallest interior clear height, so a figure that fits the band fits every
 * compartment. null when the profile has no compartments, or when the
 * smallest is zero, negative or NaN (no mm -> px scale can be anchored on it);
 * CaseShelf then uses its dynamic default.
 */
export function fixedModeCompartmentMm(profile: CabinetProfile): number | null {
  const smallest = Math.min(...clearHeightsMm(profile));
  return Number.isFinite(smallest) && smallest > 0 ? smallest : null;
}
