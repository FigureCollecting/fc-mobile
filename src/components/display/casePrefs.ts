/**
 * The case's per-device choices (Ross CC14, 2026-10-09: kept on each device
 * until a contract round syncs them): which cabinets line the wall, the view,
 * what a sideways swipe does (CC4: pan the wall or move the camera, a
 * playable toggle so Ross decides hands-on), the room's ceiling (CC9) and
 * the order of the pull-up tabs (IC1-R1: View, Reserved | + | Info, Refine).
 * One localStorage entry; unreadable or unknown values fall back per field.
 */
import { useCallback, useState } from 'preact/hooks';
import { CEILING_DEFAULT_MM, CLEARANCE_MAX_MM, DEFAULT_CLEARANCE_MM } from './cabinetProfile';
import type { CabinetProfile } from './cabinetProfile';
import { CABINET_PRESETS, DEFAULT_CABINET_PROFILE, IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from './cabinetPresets';

export const CASE_PREFS_KEY = 'fc-case-prefs';

/** Whole cabinets (as many as fit side by side), one cabinet, one shelf. */
export type CaseView = 'wall' | 'cabinet' | 'shelf';
export const CASE_VIEWS: readonly CaseView[] = ['wall', 'cabinet', 'shelf'];

/** CC4: a sideways swipe slides the drawn wall like a photo (pan), or walks the camera along it. */
export type SwipeMode = 'pan' | 'camera';

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

/** The pull-up tabs (IC1-R1): Reserved holds an empty slot until it has a job (IC1-R3). */
export type CaseTab = 'view' | 'reserved' | 'info' | 'refine';
export const CASE_TABS: readonly CaseTab[] = ['view', 'reserved', 'info', 'refine'];

export function wallPatternProfiles(id: string): CabinetProfile[] {
  return [...(WALL_PATTERNS.find((p) => p.id === id)?.profiles ?? [DEFAULT_CABINET_PROFILE])];
}

export interface CasePrefs {
  readonly pattern: string;
  readonly view: CaseView;
  readonly swipe: SwipeMode;
  readonly ceilingMm: number;
  /** Left to right; the first two sit left of the raised +, the last two right of it. */
  readonly tabOrder: readonly CaseTab[];
  /** CLEAR-1 (Ross 10-18): the room every compartment keeps above a figure, mm; 1 in to begin with, 0 to 2 in. Kept with the room's ceiling. */
  readonly clearanceMm: number;
}

export const DEFAULT_CASE_PREFS: CasePrefs = {
  pattern: DEFAULT_CABINET_PROFILE.id,
  view: 'wall',
  swipe: 'camera',
  ceilingMm: CEILING_DEFAULT_MM,
  tabOrder: CASE_TABS,
  clearanceMm: DEFAULT_CLEARANCE_MM,
};

function isTabOrder(value: unknown): value is readonly CaseTab[] {
  return (
    Array.isArray(value) &&
    value.length === CASE_TABS.length &&
    CASE_TABS.every((tab) => value.includes(tab))
  );
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
  return {
    pattern: WALL_PATTERNS.some((p) => p.id === stored.pattern) ? (stored.pattern as string) : d.pattern,
    view: CASE_VIEWS.includes(stored.view as CaseView) ? (stored.view as CaseView) : d.view,
    swipe: stored.swipe === 'pan' || stored.swipe === 'camera' ? stored.swipe : d.swipe,
    ceilingMm: typeof stored.ceilingMm === 'number' && Number.isFinite(stored.ceilingMm) && stored.ceilingMm > 0 ? stored.ceilingMm : d.ceilingMm,
    tabOrder: isTabOrder(stored.tabOrder) ? [...stored.tabOrder] : d.tabOrder,
    clearanceMm: typeof stored.clearanceMm === 'number' && stored.clearanceMm >= 0 && stored.clearanceMm <= CLEARANCE_MAX_MM ? stored.clearanceMm : d.clearanceMm,
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
