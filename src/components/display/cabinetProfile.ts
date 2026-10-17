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
 * 2 ft of top clearance. CASE-FB3b (Ross TALL1, 2026-10-15, "3a"): the room
 * decides, no 24 in cap: topClearanceMm = max(0, ceiling - outer height - 2 in
 * of hand room), ceiling 96 in by default (a user setting). Inch constants
 * and inch-native presets are exact (x 25.4), never rounded to whole mm;
 * round only for display.
 */

/** 24 in: the most headroom the camera frames above a cabinet's top (framingHeadroomMm); once CC9's cap on what may stand there. Never 610. */
export const TOP_CLEARANCE_CAP_MM = 609.6;
/** 2 in: the room kept between a figure on a cabinet's top and the ceiling (TALL1 3a). */
export const TOP_HAND_ROOM_MM = 50.8;
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
  /** This surface is the profile's shelf plate (smaller than the interior, set back from the front). */
  readonly plate?: boolean;
  /** An open shelf outside the doors (the KLINGSBO's shelf below its glass case): nothing in front of it. */
  readonly outsideDoor?: boolean;
  /** CASE-FB2b: the shelf lifts out (glass on clip supports or a ladder): an instance may stand without it. */
  readonly liftsOut?: boolean;
}

/** CC5: 'fit shelves to figures' exists only for adjustable profiles. */
/** `topMoves` (CASE-FB2b): the top is a shelf like the rest and moves by the pitch too (a boltless rack's top beam). */
export type ShelfMode = { readonly mode: 'fixed' } | { readonly mode: 'adjustable'; readonly pinPitchMm: number; readonly topMoves?: boolean };

export interface LegSpec {
  readonly sectionMm?: number;
  readonly insetXMm?: number;
  readonly insetZMm?: number;
  readonly taper?: boolean;
  /** The legs splay out below the body: the footprint (CabinetProfile.footprint) is wider than the body. */
  readonly splay?: boolean;
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
  readonly footprint?: Provenance;
  readonly glass?: Provenance;
  readonly plate?: Provenance;
  readonly rack?: Provenance;
  readonly loads?: Provenance;
}

/** Where a profile's sizes come from: the exact page, image or document, and the snapshot (or fetch) date. */
export interface ProfileSource {
  readonly url: string;
  /** YYYY-MM-DD: the Wayback snapshot's date, or the day a live document was fetched. */
  readonly date: string;
  /** What this source says, in short. */
  readonly facts: string;
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
  /**
   * Where the legs meet the floor when they reach beyond the body (splayed
   * legs): centred on the body's width, reaching frontOverhangMm in front of
   * its front. Absent = the cabinet stands within its own body outline.
   */
  readonly footprint?: { readonly widthMm: number; readonly depthMm: number; readonly frontOverhangMm: number };
  /** No longer sold: the screen never offers a buy link for it. */
  readonly discontinued: boolean;
  /** Where to buy it, while it is sold. */
  readonly buyUrl?: string;
  /** Every published source the sizes were taken from (empty for a cabinet measured by its owner). */
  readonly sources: readonly ProfileSource[];
  readonly provenance: ProfileProvenance;
  /** CASE-FB2b: this instance's own shelves (withShelfLayout), when they are not the profile's stock ones. */
  readonly layout?: ShelfLayout;
}

/**
 * CASE-FB2b (Ross TALL1 10-15, option 1): one cabinet instance's own shelves, by their index in the profile's
 * surfaces: those taken out (they lift out) and those moved to another pin position (an adjustable profile). Derived
 * by the packer in this unit, never saved (saved layouts come later).
 */
export interface ShelfLayout {
  readonly removed: readonly number[];
  readonly moved: readonly { readonly index: number; readonly topMm: number }[];
}

/** Every shelf where the profile has it. */
export const STOCK_LAYOUT: ShelfLayout = { removed: [], moved: [] };

/** The shelves an instance may stand without: those that lift out (the KLINGSBO's and the Detolf's glass, every rack beam), by index. */
export function liftOutShelves(profile: CabinetProfile): number[] {
  return profile.surfaces.flatMap((s, i) => (s.liftsOut === true ? [i] : []));
}

/** The shelves that move by the pin pitch: every one on an adjustable profile, but its top unless it says it moves; none on a fixed one. */
export function movableShelves(profile: CabinetProfile): number[] {
  if (profile.shelves.mode !== 'adjustable') return [];
  return profile.surfaces.slice(0, profile.shelves.topMoves === true ? undefined : -1).map((_, i) => i);
}

/**
 * The profile as one instance stands with `layout`: the shelves taken out gone, the moved ones at their new tops, the
 * layout kept on it; the stock layout is the profile itself. Throws (RangeError) on what the furniture cannot do: a
 * shelf that does not lift out or move, one named twice, a move off the pin pitch or onto or past a neighbour.
 */
export function withShelfLayout(profile: CabinetProfile, layout: ShelfLayout): CabinetProfile {
  if (layout.removed.length === 0 && layout.moved.length === 0) return profile;
  const named = [...layout.removed, ...layout.moved.map((m) => m.index)];
  if (new Set(named).size !== named.length) throw new RangeError(`a shelf is named twice in ${JSON.stringify(layout)}`);
  const out = new Set(liftOutShelves(profile));
  for (const i of layout.removed) if (!out.has(i)) throw new RangeError(`${profile.id}: surface ${i} does not lift out`);
  const movable = new Set(movableShelves(profile));
  const surfaces = profile.surfaces.map((s) => ({ ...s }));
  for (const { index, topMm } of layout.moved) {
    if (!movable.has(index) || profile.shelves.mode !== 'adjustable') throw new RangeError(`${profile.id}: surface ${index} does not move`);
    const pins = (topMm - surfaces[index].topMm) / profile.shelves.pinPitchMm;
    if (Math.abs(pins - Math.round(pins)) > FIT_EPSILON_MM) throw new RangeError(`${profile.id}: ${topMm} mm is off the ${profile.shelves.pinPitchMm} mm pitch`);
    if (topMm > profile.outer.heightMm + FIT_EPSILON_MM) throw new RangeError(`${profile.id}: ${topMm} mm is above the cabinet's ${profile.outer.heightMm} mm`);
    surfaces[index] = { ...surfaces[index], topMm };
  }
  const kept = surfaces.filter((_, i) => !layout.removed.includes(i));
  // something to stand on and something to stand under: a top and one shelf at least
  if (kept.length < 2) throw new RangeError(`${profile.id}: ${JSON.stringify(layout.removed)} leaves no shelf`);
  // each surface clear of the one below it; the lowest one on the floor at most
  for (let i = 0; i < kept.length; i++) {
    const underside = kept[i].topMm - kept[i].thicknessMm;
    if (i === 0 ? underside < -FIT_EPSILON_MM : !(underside > kept[i - 1].topMm)) throw new RangeError(`${profile.id}: ${kept[i].name} meets the surface below it`);
  }
  return { ...profile, surfaces: kept, layout };
}

/** The structural part the CC9 rules read; any profile (or a bare height) satisfies it. */
export interface HasOuterHeight {
  readonly outer: { readonly heightMm: number };
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number of mm, got ${value}`);
}

/** The room above a cabinet before the floor: ceiling - outer height - 2 in. Negative = no room for a hand. */
export function topClearanceRawMm(profile: HasOuterHeight, ceilingMm: number = CEILING_DEFAULT_MM): number {
  requireFinite(ceilingMm, 'ceilingMm');
  return ceilingMm - profile.outer.heightMm - TOP_HAND_ROOM_MM;
}

/**
 * TALL1 3a: max(0, ceiling - outer height - 2 in): how tall a figure may stand
 * on the top. A non-finite ceiling or outer height throws (RangeError); the
 * raw value above does not check the height, so G19 can name it instead.
 */
export function topClearanceMm(profile: HasOuterHeight, ceilingMm: number = CEILING_DEFAULT_MM): number {
  requireFinite(profile.outer.heightMm, 'outer.heightMm');
  return Math.max(0, topClearanceRawMm(profile, ceilingMm));
}

/**
 * G17: may a figure this tall stand on the top? One over the clearance is a
 * violator; one of exactly the clearance fits (within 1e-6 mm). A top that is
 * not usable, or has no clearance (a cabinet as tall as the room or taller),
 * takes nothing; a figure height of zero or less, or NaN, never fits. A
 * non-finite ceiling or outer height throws, as in topClearanceMm.
 */
export function fitsOnTop(profile: CabinetProfile, figureHeightMm: number, ceilingMm: number = CEILING_DEFAULT_MM): boolean {
  if (!profile.top.usable || !(figureHeightMm > 0)) return false;
  const clearanceMm = topClearanceMm(profile, ceilingMm);
  return clearanceMm > 0 && figureHeightMm <= clearanceMm + FIT_EPSILON_MM;
}

/**
 * CC9 framing headroom above the top: min(24 in, clearance, max(300, tallest
 * top figure + 40)), from the UNFILTERED collection; null = nothing on the
 * top. top.usable is not read: a top that takes nothing is framed like an
 * empty one. The 24 in cap is the framing's (the room's clearance may be more:
 * the wall camera, measured at up to 24 in of headroom, stays as it was); a
 * figure standing higher is cropped at the frame's top until the camera lifts.
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
  return Math.min(TOP_CLEARANCE_CAP_MM, topClearanceMm(profile, ceilingMm), wanted);
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
export type ProfileCheck = 'dimensions' | 'ascending' | 'gap' | 'top-height' | 'stack-sum' | 'clearance' | 'interior' | 'footprint';

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
  const post = p.rack?.postMm ?? 0;
  const wall = Math.max(p.panels.sideMm, post);
  const fitsWidth = p.interior.widthMm <= p.outer.widthMm - 2 * wall + FIT_EPSILON_MM;
  // depth: a front post (no front panel), then the back panel or back post, whichever is deeper
  const fitsDepth = p.interior.depthMm <= p.outer.depthMm - post - Math.max(p.panels.backMm, post) + FIT_EPSILON_MM;
  const plate = p.plate;
  const plateFits =
    !plate ||
    (plate.widthMm <= p.interior.widthMm + FIT_EPSILON_MM &&
      plate.frontInsetMm + plate.depthMm <= p.interior.depthMm + FIT_EPSILON_MM);
  return fitsWidth && fitsDepth && plateFits;
}

function footprintOk(p: CabinetProfile): boolean {
  const f = p.footprint;
  if (!f) return true;
  return (
    f.widthMm >= p.outer.widthMm &&
    f.depthMm >= p.outer.depthMm &&
    f.frontOverhangMm >= 0 &&
    f.frontOverhangMm <= f.depthMm - p.outer.depthMm
  );
}

/**
 * G19 registry invariant. Returns the names of the checks the profile FAILS
 * (empty = valid). Each check is written so a NaN in the profile fails it; a
 * non-finite ceiling is a caller error and throws (RangeError).
 * - dimensions: sizes finite and positive (panels, base, loads, insets >= 0), rank a whole number >= 1
 * - ascending: at least one surface, tops strictly ascending
 * - gap: each surface sits at least its own board above the one below (clear >= 0)
 * - top-height: the top surface is the outer height (within 5 mm)
 * - stack-sum: base + boards + clear heights = outer height (within 5 mm). With
 *   clear heights derived (stackSumMm), and given top-height, this only checks
 *   base + bottom board against the first surface's top (within the tolerances);
 *   no interior shelf or board can fail it
 * - clearance: the cabinet fits the room: raw ceiling - height >= 0 (the floored value never fails)
 * - interior: the interior fits inside the walls (or rack posts, front and back too) and the shelf plate inside the interior
 * - footprint: splayed legs reach at least the body's width and depth, and their front overhang lies within the extra depth
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
    // the cabinet stands in the room (the 2 in of hand room above it is a figure's, not the cabinet's)
    ['clearance', topClearanceRawMm(profile, ceilingMm) + TOP_HAND_ROOM_MM >= 0],
    ['interior', interiorOk(profile)],
    ['footprint', footprintOk(profile)],
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

/** How far a cabinet's feet reach beyond its body on each side (half the extra footprint width); 0 without a footprint. */
export function sideOverhangMm(profile: CabinetProfile): number {
  const f = profile.footprint;
  return f ? (f.widthMm - profile.outer.widthMm) / 2 : 0;
}

/**
 * The closest two cabinets can stand side by side, body to body: the left
 * one's feet plus the right one's (Ross 2026-10-11: splayed legs keep two
 * KLINGSBOs from touching; Detolf owners butt theirs together, gap 0).
 */
export function adjacencyGapMm(left: CabinetProfile, right: CabinetProfile): number {
  return sideOverhangMm(left) + sideOverhangMm(right);
}

/** The cabinet's buy link, or null: never one for a discontinued cabinet (Ross 2026-10-11), nor when none is known. */
export function buyLink(profile: CabinetProfile): string | null {
  return !profile.discontinued && profile.buyUrl ? profile.buyUrl : null;
}
