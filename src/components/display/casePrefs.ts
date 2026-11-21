/**
 * The case's per-device choices (Ross CC14, 2026-10-09: kept on each device
 * until a contract round syncs them): which cabinets line the wall,
 * the room's ceiling (CC9),
 * the order of the pull-up tabs (IC1-R1: View, Info, Refine) and
 * the order the case stands its figures in (PACK1).
 * One localStorage entry; unreadable or unknown values fall back per field.
 * NAV-2A2 (Ross 11-04): no swipe mode any more (CC4's pan the wall or move the camera): a stored one is not read, and the
 * next write drops it. NAV-GRAD: the same for freeCamera (the Free camera is the only camera: a stored false, the old
 * View card's box unticked, turns nothing off). NAV-SCOPE (Ross 11-18): the same for view (one continuous view: no one
 * cabinet, no one shelf; a stored one opens the wall).
 * NAV-FLOAT (11-18): likewise the depth rocker's shape (NAV-ROCKER's depthRocker): the floating Z is vertical only.
 */
import { useCallback, useState } from 'preact/hooks';
import { CEILING_DEFAULT_MM, CLEARANCE_MAX_MM, DEFAULT_CLEARANCE_MM } from './cabinetProfile';
import type { CabinetProfile } from './cabinetProfile';
import { CABINET_PRESETS, DEFAULT_CABINET_PROFILE, IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from './cabinetPresets';
import { DEFAULT_CASE_ARRANGEMENT, isCaseArrangement, type CaseArrangement } from './caseArrangement';
import { DEFAULT_WALL, DEFAULT_WALL_CUSTOM, isHexColour, isWallPreset, type WallPreset } from './wallColour';

export const CASE_PREFS_KEY = 'fc-case-prefs';

export interface WallPattern {
  readonly id: string;
  readonly label: string;
  /** Cycled cabinet by cabinet along the wall. */
  readonly profiles: readonly CabinetProfile[];
}

/** Every preset alone, then the KLINGSBO with the Detolf and Ross's rack alongside (Ross 10-11, superseding CC16). */
export const WALL_PATTERNS: readonly WallPattern[] = [
  ...CABINET_PRESETS.map((p) => ({ id: p.id, label: p.name, profiles: [p] })),
  {
    id: [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK].map((p) => p.id).join('+'),
    label: 'KLINGSBO with the Detolf and the open steel rack alongside',
    profiles: [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK],
  },
];

/** The pull-up tabs (IC1-R1). NAV-FLOAT: no Reserved slot any more (it held the depth rocker, now the floating Z). */
export type CaseTab = 'view' | 'info' | 'refine';
export const CASE_TABS: readonly CaseTab[] = ['view', 'info', 'refine'];

export function wallPatternProfiles(id: string): CabinetProfile[] {
  return [...(WALL_PATTERNS.find((p) => p.id === id)?.profiles ?? [DEFAULT_CABINET_PROFILE])];
}

export interface CasePrefs {
  readonly pattern: string;
  readonly ceilingMm: number;
  /** Left to right. */
  readonly tabOrder: readonly CaseTab[];
  /**
   * MISFIT-CHIP-1: the ids of the figures that did not fit when the do-not-fit chip was dismissed. The chip stays hidden
   * until a figure NOT in this list misfits; the list is always recallable from the View card.
   */
  readonly misfitsDismissed: readonly string[];
  /** CLEAR-1 (Ross 10-18): the room every compartment keeps above a figure, mm; 1 in to begin with, 0 to 2 in. Kept with the room's ceiling. */
  readonly clearanceMm: number;
  /** SIZE-BASIS-1 (Ross 10-18): outline the figures whose height or width is an estimate (sizeBasis.ts); off until asked for. */
  readonly showEstimated: boolean;
  /** WALL-COLOUR-1 (Ross 10-20): the wall's colour: a preset (Cream by default; each with a dark-theme counterpart) or `wallCustom`. */
  readonly wall: WallPreset;
  /** The custom wall colour, #rrggbb (its light-theme colour; the dark one is mixed from it). */
  readonly wallCustom: string;
  /** PACK1 (Ross 10-26): the order the case stands its figures in, apart from the list's sort (caseArrangement.ts). */
  readonly arrange: CaseArrangement;
}

export const DEFAULT_CASE_PREFS: CasePrefs = {
  pattern: DEFAULT_CABINET_PROFILE.id,
  ceilingMm: CEILING_DEFAULT_MM,
  tabOrder: CASE_TABS,
  misfitsDismissed: [],
  clearanceMm: DEFAULT_CLEARANCE_MM,
  showEstimated: false,
  wall: DEFAULT_WALL,
  wallCustom: DEFAULT_WALL_CUSTOM,
  arrange: DEFAULT_CASE_ARRANGEMENT,
};

function isTabOrder(value: unknown): value is readonly CaseTab[] {
  return (
    Array.isArray(value) &&
    value.length === CASE_TABS.length &&
    CASE_TABS.every((tab) => value.includes(tab))
  );
}

/**
 * NAV-FLOAT: an order stored while the tabs had a Reserved slot, without it, so sides swapped then stay swapped; anything
 * else is passed on as it is, for isTabOrder to judge.
 */
function withoutReserved(value: unknown): unknown {
  return Array.isArray(value) ? value.filter((tab) => tab !== 'reserved') : value;
}

function isIdList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parse(raw: string | null): Partial<Record<keyof CasePrefs, unknown>> {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? (value as Partial<Record<keyof CasePrefs, unknown>>) : {};
  } catch {
    return {};
  }
}

export function readCasePrefs(): CasePrefs {
  let stored: Partial<Record<keyof CasePrefs, unknown>> = {};
  try {
    stored = parse(localStorage.getItem(CASE_PREFS_KEY));
  } catch {
    /* storage unavailable: defaults */
  }
  const d = DEFAULT_CASE_PREFS;
  const tabOrder = withoutReserved(stored.tabOrder);
  return {
    pattern: WALL_PATTERNS.some((p) => p.id === stored.pattern) ? (stored.pattern as string) : d.pattern,
    ceilingMm: typeof stored.ceilingMm === 'number' && Number.isFinite(stored.ceilingMm) && stored.ceilingMm > 0 ? stored.ceilingMm : d.ceilingMm,
    tabOrder: isTabOrder(tabOrder) ? [...tabOrder] : d.tabOrder,
    misfitsDismissed: isIdList(stored.misfitsDismissed) ? [...stored.misfitsDismissed] : d.misfitsDismissed,
    clearanceMm: typeof stored.clearanceMm === 'number' && stored.clearanceMm >= 0 && stored.clearanceMm <= CLEARANCE_MAX_MM ? stored.clearanceMm : d.clearanceMm,
    showEstimated: stored.showEstimated === true,
    wall: isWallPreset(stored.wall) ? stored.wall : d.wall,
    wallCustom: isHexColour(stored.wallCustom) ? stored.wallCustom : d.wallCustom,
    arrange: isCaseArrangement(stored.arrange) ? stored.arrange : d.arrange,
  };
}

export function writeCasePrefs(patch: Partial<CasePrefs>): CasePrefs {
  const next = { ...readCasePrefs(), ...patch };
  try {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: this session only */
  }
  return next;
}

export function useCasePrefs(): [CasePrefs, (patch: Partial<CasePrefs>) => void] {
  const [prefs, setPrefs] = useState(readCasePrefs);
  const update = useCallback((patch: Partial<CasePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeCasePrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
