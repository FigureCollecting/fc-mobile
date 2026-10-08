// Search on the device (WK-15): the user's own figures (every kind, former included), each once,
// through the n-gram index (src/local/search) over title, maker, character, series and JAN. No
// request is made, so it works offline; each query is timed as the performance measure
// SEARCH_MEASURE. Catalog-wide search is WK-17; a barcode lookup goes through Compare (online).
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchResult } from '@figurecollecting/fc-shared';
import { jan13, type LocalFigure } from '../local/figures';
import { useSnapshot, type Snapshot } from '../local/useLocal';
import { LocalSearcher, browserWorker } from '../local/search/searcher';
import type { SearchDoc } from '../local/search/ngram';

export const SEARCH_MEASURE = 'fc-local-search';
const RECENT_SEARCHES_KEY = 'fc-recent-searches';
const MAX_RECENT = 10;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Two characters make a query; one CJK character is a word on its own. */
const searchable = (q: string): boolean => [...q].length >= 2 || CJK.test(q);

interface Searchable {
  figures: Map<string, LocalFigure>;
  docs: SearchDoc[];
}

function toSearchable(s: Snapshot): Searchable {
  const figures = new Map<string, LocalFigure>();
  for (const f of s.figures) if (!figures.has(f._id)) figures.set(f._id, f);
  const docs = [...figures.values()].map((f) => ({
    id: f._id,
    fields: [f.name, f.manufacturer, f.local.character ?? '', f.local.series ?? '', f.local.gtin14s.flatMap((g) => [jan13(g), g]).join(' ')],
  }));
  return { figures, docs };
}

const toResult = (f: LocalFigure): SearchResult => ({
  id: f._id,
  name: f.name,
  manufacturer: f.manufacturer,
  scale: f.scale,
  mfcLink: '',
  ...(f.origin === undefined ? {} : { origin: f.origin }),
});

function mark(name: string): boolean {
  try {
    performance.mark(name);
    return true;
  } catch {
    return false;
  }
}

export function useSearch() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{ q: string; ids: string[] }>({ q: '', ids: [] });
  const snapshot = useSnapshot(useCallback(toSearchable, []));
  const searcher = useRef<LocalSearcher>();
  searcher.current ??= new LocalSearcher({ makeWorker: browserWorker() });

  useEffect(() => () => searcher.current?.dispose(), []);
  useEffect(() => {
    if (snapshot.data !== undefined) searcher.current!.update(snapshot.data.docs);
  }, [snapshot.data]);

  useEffect(() => {
    const q = query.trim();
    // No index yet: no answer at all, rather than a false 'nothing matches'.
    if (snapshot.data === undefined) return;
    if (!searchable(q)) {
      setAnswer({ q, ids: [] });
      return;
    }
    let live = true;
    const start = `${SEARCH_MEASURE}:start`;
    const marked = mark(start);
    void searcher.current!.search(q).then((ids) => {
      if (marked) performance.measure(SEARCH_MEASURE, start);
      if (live) setAnswer({ q, ids });
    });
    return () => {
      live = false;
    };
  }, [query, snapshot.data]);

  const figures = useMemo(
    () => answer.ids.map((id) => snapshot.data?.figures.get(id)).filter((f): f is LocalFigure => f !== undefined),
    [answer, snapshot.data],
  );
  const results = useMemo(() => figures.map(toResult), [figures]);

  const saveRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    try {
      const recent: string[] = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]');
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([trimmed, ...recent.filter((s) => s !== trimmed)].slice(0, MAX_RECENT)));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const getRecentSearches = useCallback((): string[] => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]');
    } catch {
      return [];
    }
  }, []);

  const clearRecentSearches = useCallback(() => {
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return {
    query,
    debouncedQuery: answer.q,
    updateQuery: setQuery,
    results,
    figures,
    isLoading: (snapshot.data === undefined && query.trim() !== '') || (searchable(query.trim()) && answer.q !== query.trim()),
    isError: snapshot.isError,
    refetch: snapshot.refetch,
    hasSearched: searchable(answer.q),
    saveRecentSearch,
    getRecentSearches,
    clearRecentSearches,
  };
}
