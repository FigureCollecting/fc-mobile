/**
 * Collection list state in URL search params — same names and pipe-separated
 * list encoding as fc-frontend's useFigureListState (status, sort, order,
 * mfr, dist, scale, origin, cat), so links stay meaningful across web and
 * mobile. Mobile adds: layout (case|rows), density, tag, type. The case's
 * own look (cabinets, view, swipe) is kept per device in casePrefs.
 *
 * `status` is the holdings chosen in Refine (SHEETS-FB1: Owned, Ordered,
 * Wished, No longer owned; several at once), defaulted like cat/type: Owned
 * unless the caller says otherwise (the fixtures: none, every holding). An
 * old `tab=` link (the tab row it replaces) opens on that holding.
 *
 * Resolution order for view prefs (layout/density): URL > localStorage
 * > default. Category=Prepainted and type=Figures are PRESELECTED defaults,
 * shown as removable chips; removing one writes the explicit sentinel 'all'
 * so the cleared state survives in the URL.
 */
import { useCallback, useMemo } from 'preact/hooks';
import { useSearchParams } from 'wouter';
import { DEFAULT_DENSITY, isDensity } from '../components/display/density';
import type { Density } from '../components/display/density';

export type LayoutMode = 'case' | 'rows';
/** The collection's tabs over the default collections (GR 2026-09-26). */
export type CollectionTab = 'owned' | 'ordered' | 'wished' | 'former';
export const COLLECTION_TABS: readonly CollectionTab[] = ['owned', 'ordered', 'wished', 'former'];

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

const VALID_LAYOUTS: LayoutMode[] = ['case', 'rows'];

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

export interface ListParamOptions {
  /** Labels (nameplates) when the URL says nothing: on where there are no images to show. */
  labelsDefault?: boolean;
  /** The holdings shown when the URL names none: Owned unless given. */
  holdingsDefault?: readonly CollectionTab[];
}

const DEFAULT_HOLDINGS: readonly CollectionTab[] = ['owned'];

const isHolding = (value: string): value is CollectionTab => (COLLECTION_TABS as readonly string[]).includes(value);

/** The holdings the URL names: status= (values it does not know left out; none known, the default), else an old tab=. */
function parseHoldings(params: URLSearchParams, fallback: readonly CollectionTab[]): string[] {
  const value = params.get('status');
  if (value === CLEARED) return [];
  if (value !== null) {
    const named = value.split('|').filter(isHolding);
    if (named.length > 0) return named;
  }
  const tab = params.get('tab');
  return value === null && tab !== null && isHolding(tab) ? [tab] : [...fallback];
}

export function useFigureListParams(options: ListParamOptions = {}) {
  const labelsDefault = options.labelsDefault ?? false;
  const holdingsDefault = options.holdingsDefault ?? DEFAULT_HOLDINGS;
  const holdingsKey = holdingsDefault.join('|');
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

  const filters = useMemo(
    (): ListFilters => ({
      status: parseHoldings(params, holdingsDefault),
      mfr: parseList(params, 'mfr'),
      dist: parseList(params, 'dist'),
      scale: parseList(params, 'scale'),
      origin: parseList(params, 'origin'),
      cat: parseDefaultedList(params, 'cat', DEFAULT_CAT),
      type: parseDefaultedList(params, 'type', DEFAULT_TYPE),
      tag: parseList(params, 'tag'),
    }),
    // holdingsDefault by value: callers pass a fresh array each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, holdingsKey],
  );

  /** Every filter at its default: what Clear goes back to, and what counts as nothing filtered. */
  const defaults = useMemo(
    (): ListFilters => ({ status: [...holdingsDefault], mfr: [], dist: [], scale: [], origin: [], cat: [...DEFAULT_CAT], type: [...DEFAULT_TYPE], tag: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdingsKey],
  );

  const sortState = useMemo((): SortState => {
    const sort = params.get('sort') ?? 'activity';
    const order = params.get('order') === 'desc' ? 'desc' : 'asc';
    return { sort, order };
  }, [params]);

  // Nameplate overlay toggle. Absent (or anything but '1') means off — no
  // localStorage persistence, the URL is the only source of truth.
  const labels = useMemo((): boolean => {
    const value = params.get('labels');
    if (value === null) return labelsDefault;
    return value === '1';
  }, [params, labelsDefault]);

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

  const setFilters = useCallback(
    (next: ListFilters) => {
      const list = (arr: string[]): string | null => (arr.length > 0 ? arr.join('|') : null);
      const defaulted = (arr: string[], fallback: string[]): string | null => {
        if (arr.length === fallback.length && arr.every((v, i) => v === fallback[i])) return null;
        if (arr.length === 0) return CLEARED;
        return arr.join('|');
      };
      update({
        status: defaulted(next.status, [...holdingsDefault]),
        // the holdings are status= now; an old tab= link is spent once they change
        tab: null,
        mfr: list(next.mfr),
        dist: list(next.dist),
        scale: list(next.scale),
        origin: list(next.origin),
        cat: defaulted(next.cat, DEFAULT_CAT),
        type: defaulted(next.type, DEFAULT_TYPE),
        tag: list(next.tag),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, holdingsKey],
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
      update({ labels: next === labelsDefault ? null : next ? '1' : '0' });
    },
    [update, labelsDefault],
  );

  const clearFilters = useCallback(() => {
    update({
      tab: null,
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
    filters,
    sort: sortState.sort,
    order: sortState.order,
    labels,
    defaults,
    setLayout,
    setDensity,
    setFilters,
    setSort,
    setLabels,
    clearFilters,
  };
}
