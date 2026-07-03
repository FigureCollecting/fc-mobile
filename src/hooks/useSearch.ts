import { useState, useRef, useCallback } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import { searchFigures } from '@figurecollecting/fc-shared';
import type { SearchResult } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

const DEBOUNCE_MS = 300;
const RECENT_SEARCHES_KEY = 'fc-recent-searches';
const MAX_RECENT = 10;

export function useSearch() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback((value: string) => {
    setQuery(value);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, DEBOUNCE_MS);
  }, []);

  const searchResult = useQuery<SearchResult[]>({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchFigures(api, debouncedQuery),
    enabled: isAuthenticated && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const saveRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      const recent: string[] = stored ? JSON.parse(stored) : [];
      const filtered = recent.filter((s) => s !== trimmed);
      filtered.unshift(trimmed);
      localStorage.setItem(
        RECENT_SEARCHES_KEY,
        JSON.stringify(filtered.slice(0, MAX_RECENT)),
      );
    } catch {
      // localStorage unavailable
    }
  }, []);

  const getRecentSearches = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      return stored ? JSON.parse(stored) : [];
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
    debouncedQuery,
    updateQuery,
    results: searchResult.data ?? [],
    isLoading: searchResult.isLoading,
    isError: searchResult.isError,
    refetch: searchResult.refetch,
    hasSearched: debouncedQuery.length >= 2,
    saveRecentSearch,
    getRecentSearches,
    clearRecentSearches,
  };
}
