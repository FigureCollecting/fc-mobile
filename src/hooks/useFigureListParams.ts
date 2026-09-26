/**
 * Collection list state in URL search params — same names and pipe-separated
 * list encoding as fc-frontend's useFigureListState (status, sort, order,
 * mfr, dist, scale, origin, cat), so links stay meaningful across web and
 * mobile. Mobile adds: layout (case|rows), density, motif, tag, type.
 *
 * Resolution order for view prefs (layout/density/motif): URL > localStorage
 * > default. Category=Prepainted and type=Figures are PRESELECTED defaults,
 * shown as removable chips; removing one writes the explicit sentinel 'all'
 * so the cleared state survives in the URL.
 */
import { useCallback, useMemo } from 'preact/hooks';
import { useSearchParams } from 'wouter';
import { DEFAULT_DENSITY, isDensity } from '../components/display/density';
import type { Density } from '../components/display/density';
import type { CaseMotif } from '../components/display/CaseShelf';

export type LayoutMode = 'case' | 'rows';

export interface ListFilters {
  status: string[];
  mfr: string[];
  dist: string[];
  scale: string[];
  origin: string[];
  cat: string[];
  type: string[];
  tag: string[];
}

export interface SortState {
  sort: string;
  order: 'asc' | 'desc';
}

const LS_LAYOUT = 'fc-list-layout';
const LS_DENSITY = 'fc-list-density';
const LS_MOTIF = 'fc-list-motif';

const VALID_LAYOUTS: LayoutMode[] = ['case', 'rows'];
const VALID_MOTIFS: CaseMotif[] = ['detolf-dark', 'glass-clear', 'bookcase-wood'];

export const DEFAULT_CAT = ['Prepainted'];
export const DEFAULT_TYPE = ['Figures'];

/** Sentinel meaning "user explicitly cleared this defaulted facet". */
const CLEARED = 'all';

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable */
  }
}

function parseList(params: URLSearchParams, key: string): string[] {
  const value = params.get(key);
  if (!value) return [];
  // Pipe delimiter — commas appear inside values (e.g. "Kanojo, Okarishimasu")
  return value.split('|').filter(Boolean);
}

function parseDefaultedList(params: URLSearchParams, key: string, fallback: string[]): string[] {
  const value = params.get(key);
  if (value === null) return fallback;
  if (value === CLEARED) return [];
  return value.split('|').filter(Boolean);
}

export function useFigureListParams() {
  const [params, setParams] = useSearchParams();

  const layout = useMemo((): LayoutMode => {
    const p = params.get('layout') as LayoutMode;
    if (VALID_LAYOUTS.includes(p)) return p;
    const stored = lsGet(LS_LAYOUT) as LayoutMode;
    return VALID_LAYOUTS.includes(stored) ? stored : 'case';
  }, [params]);

  const density = useMemo((): Density => {
    const p = params.get('density');
    if (isDensity(p)) return p;
    const stored = lsGet(LS_DENSITY);
    return isDensity(stored) ? stored : DEFAULT_DENSITY;
  }, [params]);

  const motif = useMemo((): CaseMotif => {
    const p = params.get('motif') as CaseMotif;
    if (VALID_MOTIFS.includes(p)) return p;
    const stored = lsGet(LS_MOTIF) as CaseMotif;
    return VALID_MOTIFS.includes(stored) ? stored : 'detolf-dark';
  }, [params]);

  const filters = useMemo(
    (): ListFilters => ({
      status: parseList(params, 'status'),
      mfr: parseList(params, 'mfr'),
      dist: parseList(params, 'dist'),
      scale: parseList(params, 'scale'),
      origin: parseList(params, 'origin'),
      cat: parseDefaultedList(params, 'cat', DEFAULT_CAT),
      type: parseDefaultedList(params, 'type', DEFAULT_TYPE),
      tag: parseList(params, 'tag'),
    }),
    [params],
  );

  const sortState = useMemo((): SortState => {
    const sort = params.get('sort') ?? 'activity';
    const order = params.get('order') === 'desc' ? 'desc' : 'asc';
    return { sort, order };
  }, [params]);

  // Nameplate overlay toggle. Absent (or anything but '1') means off — no
  // localStorage persistence, the URL is the only source of truth.
  const labels = useMemo((): boolean => params.get('labels') === '1', [params]);

  const update = useCallback(
    (updates: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setLayout = useCallback(
    (next: LayoutMode) => {
      lsSet(LS_LAYOUT, next);
      update({ layout: next });
    },
    [update],
  );

  const setDensity = useCallback(
    (next: Density) => {
      lsSet(LS_DENSITY, next);
      update({ density: next });
    },
    [update],
  );

  const setMotif = useCallback(
    (next: CaseMotif) => {
      lsSet(LS_MOTIF, next);
      update({ motif: next });
    },
    [update],
  );

  const setFilters = useCallback(
    (next: ListFilters) => {
      const list = (arr: string[]): string | null => (arr.length > 0 ? arr.join('|') : null);
      const defaulted = (arr: string[], fallback: string[]): string | null => {
        if (arr.length === 0) return CLEARED;
        if (arr.length === fallback.length && arr.every((v, i) => v === fallback[i])) return null;
        return arr.join('|');
      };
      update({
        status: list(next.status),
        mfr: list(next.mfr),
        dist: list(next.dist),
        scale: list(next.scale),
        origin: list(next.origin),
        cat: defaulted(next.cat, DEFAULT_CAT),
        type: defaulted(next.type, DEFAULT_TYPE),
        tag: list(next.tag),
      });
    },
    [update],
  );

  const setSort = useCallback(
    (sort: string, order: 'asc' | 'desc') => {
      update({
        sort: sort === 'activity' ? null : sort,
        order: order === 'asc' ? null : order,
      });
    },
    [update],
  );

  const setLabels = useCallback(
    (next: boolean) => {
      update({ labels: next ? '1' : null });
    },
    [update],
  );

  const clearFilters = useCallback(() => {
    update({
      status: null,
      mfr: null,
      dist: null,
      scale: null,
      origin: null,
      cat: null,
      type: null,
      tag: null,
    });
  }, [update]);

  return {
    layout,
    density,
    motif,
    filters,
    sort: sortState.sort,
    order: sortState.order,
    labels,
    setLayout,
    setDensity,
    setMotif,
    setFilters,
    setSort,
    setLabels,
    clearFilters,
  };
}
