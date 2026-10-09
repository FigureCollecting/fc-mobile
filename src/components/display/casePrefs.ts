/**
 * The case's per-device choices (Ross CC14, 2026-10-09: kept on each device
 * until a contract round syncs them): which cabinets line the wall, the view,
 * what a sideways swipe does (CC4: pan the wall or move the camera, a
 * playable toggle so Ross decides hands-on) and the room's ceiling (CC9).
 * One localStorage entry; unreadable or unknown values fall back per field.
 */
import { useCallback, useState } from 'preact/hooks';
import { CEILING_DEFAULT_MM } from './cabinetProfile';
import type { CabinetProfile } from './cabinetProfile';
import { CABINET_PRESETS, DEFAULT_CABINET_PROFILE, IKEA_DETOLF, OPEN_STEEL_RACK } from './cabinetPresets';

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

/** Every preset alone, then the Detolf with Ross's rack alongside (CC16). */
export const WALL_PATTERNS: readonly WallPattern[] = [
  ...CABINET_PRESETS.map((p) => ({ id: p.id, label: p.name, profiles: [p] })),
  { id: `${IKEA_DETOLF.id}+${OPEN_STEEL_RACK.id}`, label: 'IKEA DETOLF with the open steel rack alongside', profiles: [IKEA_DETOLF, OPEN_STEEL_RACK] },
];

export function wallPatternProfiles(id: string): CabinetProfile[] {
  return [...(WALL_PATTERNS.find((p) => p.id === id)?.profiles ?? [DEFAULT_CABINET_PROFILE])];
}

export interface CasePrefs {
  readonly pattern: string;
  readonly view: CaseView;
  readonly swipe: SwipeMode;
  readonly ceilingMm: number;
}

export const DEFAULT_CASE_PREFS: CasePrefs = {
  pattern: DEFAULT_CABINET_PROFILE.id,
  view: 'wall',
  swipe: 'camera',
  ceilingMm: CEILING_DEFAULT_MM,
};

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
