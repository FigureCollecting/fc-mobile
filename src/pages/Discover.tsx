import { useState, useCallback, useRef, useMemo } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { ErrorState } from '../components/ui/ErrorState';
import { LastSyncedBadge } from '../components/ui/LastSyncedBadge';
import { useSearch } from '../hooks/useSearch';
import { useCollection } from '../hooks/useCollection';
import { useCollectionBreakdown } from '../hooks/useAnalytics';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/** Highlight matching text within a string */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark class="suggestion-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface SuggestionGroup {
  label: string;
  items: { id: string; text: string; type: 'recent' | 'manufacturer' | 'collection' }[];
}

export function Discover() {
  const {
    query,
    updateQuery,
    results,
    isLoading,
    isError,
    refetch,
    hasSearched,
    saveRecentSearch,
    getRecentSearches,
    clearRecentSearches,
  } = useSearch();

  const [, setLocation] = useLocation();
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();

  // Fetch manufacturer breakdown for suggestions
  const { data: manufacturers } = useCollectionBreakdown('manufacturer');

  // Fetch user's cached collection for local matching
  const { data: collectionData, dataUpdatedAt: collectionUpdatedAt } = useCollection({ limit: 100 });
  const collectionFigures = collectionData?.data ?? [];

  // Build suggestions based on current query
  const suggestions = useMemo((): SuggestionGroup[] => {
    const groups: SuggestionGroup[] = [];
    const q = query.toLowerCase().trim();

    // Recent searches (always show if no query, or filter by query)
    const recents = recentSearches
      .filter((s) => !q || s.toLowerCase().includes(q))
      .slice(0, 3)
      .map((s) => ({ id: `recent-${s}`, text: s, type: 'recent' as const }));

    if (recents.length > 0) {
      groups.push({ label: 'Recent', items: recents });
    }

    // Popular manufacturers
    if (manufacturers && manufacturers.length > 0) {
      const mfrs = manufacturers
        .filter((m) => !q || m._id.toLowerCase().includes(q))
        .slice(0, 4)
        .map((m) => ({ id: `mfr-${m._id}`, text: m._id, type: 'manufacturer' as const }));

      if (mfrs.length > 0) {
        groups.push({ label: 'Manufacturers', items: mfrs });
      }
    }

    // Your collection matches (only if typing)
    if (q.length >= 1 && collectionFigures.length > 0) {
      const matches = collectionFigures
        .filter((f) => f.name.toLowerCase().includes(q) || (f.origin && f.origin.toLowerCase().includes(q)))
        .slice(0, 4)
        .map((f) => ({ id: `col-${f._id}`, text: f.name, type: 'collection' as const }));

      if (matches.length > 0) {
        groups.push({ label: 'Your Collection', items: matches });
      }
    }

    return groups;
  }, [query, recentSearches, manufacturers, collectionFigures]);

  const handleInput = useCallback(
    (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      updateQuery(value);
      setShowSuggestions(value.length > 0 || recentSearches.length > 0);
    },
    [updateQuery, recentSearches],
  );

  const handleFocus = useCallback(() => {
    setShowSuggestions(true);
  }, []);

  const handleSubmit = useCallback(
    (e: Event) => {
      e.preventDefault();
      if (query.trim()) {
        saveRecentSearch(query.trim());
        setRecentSearches(getRecentSearches());
        setShowSuggestions(false);
      }
    },
    [query, saveRecentSearch, getRecentSearches],
  );

  const handleSuggestionClick = useCallback(
    (text: string, type: string) => {
      if (type === 'collection') {
        // Find the figure and navigate
        const fig = collectionFigures.find((f) => f.name === text);
        if (fig) {
          setLocation(`/figure/${fig._id}`);
          return;
        }
      }
      updateQuery(text);
      if (inputRef.current) {
        inputRef.current.value = text;
      }
      saveRecentSearch(text);
      setRecentSearches(getRecentSearches());
      setShowSuggestions(false);
    },
    [updateQuery, saveRecentSearch, getRecentSearches, collectionFigures, setLocation],
  );

  const handleClearRecent = useCallback(() => {
    clearRecentSearches();
    setRecentSearches([]);
  }, [clearRecentSearches]);

  const handleResultClick = useCallback(
    (id: string) => {
      if (query.trim()) {
        saveRecentSearch(query.trim());
      }
      setLocation(`/figure/${id}`);
    },
    [query, saveRecentSearch, setLocation],
  );

  const showEmpty = hasSearched && !isLoading && !isError && results.length === 0;
  const showResults = hasSearched && results.length > 0;
  const showSearchError = hasSearched && !isLoading && isError && results.length === 0;
  const hasSuggestions = showSuggestions && suggestions.length > 0 && !showResults && !isLoading && !showSearchError;

  return (
    <div class="page-discover">
      <Header title="Discover" />

      {/* Search bar */}
      <form class="page-discover__search" onSubmit={handleSubmit}>
        <div class="page-discover__search-input">
          <svg class="page-discover__search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search figures, series, manufacturers..."
            class="page-discover__input"
            value={query}
            onInput={handleInput}
            onFocus={handleFocus}
          />
          {query && (
            <button
              class="page-discover__clear-btn"
              type="button"
              onClick={() => { updateQuery(''); if (inputRef.current) inputRef.current.value = ''; setShowSuggestions(false); }}
              aria-label="Clear search"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6" />
                <path d="M9 9l6 6" />
              </svg>
            </button>
          )}
        </div>
      </form>

      <div class="page-discover__content">
        {/* When offline and we're showing cached suggestions/collection, hint at staleness. */}
        {!online.value && collectionFigures.length > 0 && (
          <LastSyncedBadge timestamp={collectionUpdatedAt} />
        )}

        {/* Search failed */}
        {showSearchError && (
          !online.value ? (
            <ErrorState
              title="You're offline"
              message="Search needs a connection. We'll retry when you're back online."
            />
          ) : (
            <ErrorState
              title="Search failed"
              message="Something went wrong. Try again?"
              onRetry={() => refetch()}
            />
          )
        )}

        {/* Smart suggestions dropdown */}
        {hasSuggestions && (
          <div class="discover-suggestions">
            {suggestions.map((group) => (
              <div key={group.label} class="discover-suggestions__group">
                <div class="discover-suggestions__header">
                  <span class="discover-suggestions__label">{group.label}</span>
                  {group.label === 'Recent' && (
                    <button class="discover-suggestions__clear" type="button" onClick={handleClearRecent}>
                      Clear
                    </button>
                  )}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    class="discover-suggestions__item"
                    type="button"
                    onClick={() => handleSuggestionClick(item.text, item.type)}
                  >
                    <span class="discover-suggestions__icon">
                      {item.type === 'recent' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 6v6l4 2" />
                        </svg>
                      )}
                      {item.type === 'manufacturer' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      )}
                      {item.type === 'collection' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <rect x="14" y="3" width="7" height="7" rx="1" />
                          <rect x="3" y="14" width="7" height="7" rx="1" />
                          <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                      )}
                    </span>
                    <span class="discover-suggestions__text">
                      <HighlightMatch text={item.text} query={query} />
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <CollectionGrid>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </CollectionGrid>
        )}

        {/* Results */}
        {showResults && (
          <div class="page-discover__results">
            <p class="page-discover__results-count">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </p>
            <CollectionGrid>
              {results.map((result) => (
                <button
                  key={result.id}
                  class="figure-card"
                  onClick={() => handleResultClick(result.id)}
                  type="button"
                >
                  <div class="figure-card__image-wrapper">
                    {result.imageUrl ? (
                      <img
                        class="figure-card__image"
                        src={result.imageUrl}
                        alt={result.name}
                        loading="lazy"
                      />
                    ) : (
                      <div class="figure-card__placeholder">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="M21 15l-5-5L5 21" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div class="figure-card__info">
                    <span class="figure-card__name">{result.name}</span>
                    {result.origin && <span class="figure-card__series">{result.origin}</span>}
                  </div>
                </button>
              ))}
            </CollectionGrid>
          </div>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div class="page-discover__empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <p>No results found</p>
            <p class="page-discover__empty-hint">Try a different search term</p>
          </div>
        )}

        {/* Default state */}
        {!hasSearched && !hasSuggestions && (
          <div class="page-discover__default">
            <p class="page-discover__placeholder">Browse the catalog to discover new figures</p>
          </div>
        )}
      </div>

      <style>{`
        .page-discover__search {
          padding: 0 var(--space-4) var(--space-4);
        }

        .page-discover__search-input {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          background: var(--surface-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 0 var(--space-4);
          min-height: var(--touch-min);
          transition: border-color var(--transition-fast);
        }

        .page-discover__search-input:focus-within {
          border-color: var(--brand-500);
        }

        .page-discover__search-icon {
          flex-shrink: 0;
        }

        .page-discover__input {
          flex: 1;
          background: none;
          border: none;
          padding: var(--space-3) 0;
          color: var(--text-primary);
          font-size: var(--font-sm);
        }

        .page-discover__input::placeholder {
          color: var(--text-tertiary);
        }

        .page-discover__input:focus {
          outline: none;
          border: none;
        }

        .page-discover__clear-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
        }

        .page-discover__content {
          padding-bottom: var(--space-4);
        }

        /* Smart suggestions */
        .discover-suggestions {
          padding: 0 var(--space-4);
          animation: suggestions-in 200ms ease both;
        }

        @keyframes suggestions-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .discover-suggestions__group {
          margin-bottom: var(--space-3);
        }

        .discover-suggestions__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-1);
        }

        .discover-suggestions__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .discover-suggestions__clear {
          font-size: var(--font-xs);
          color: var(--brand-400);
          padding: var(--space-1) var(--space-2);
        }

        .discover-suggestions__item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          min-height: 40px;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          text-align: left;
          transition: background var(--transition-fast);
        }

        .discover-suggestions__item:active {
          background: var(--surface-secondary);
        }

        .discover-suggestions__icon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          color: var(--text-tertiary);
        }

        .discover-suggestions__text {
          font-size: var(--font-sm);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .suggestion-highlight {
          background: rgba(9, 103, 210, 0.2);
          color: var(--brand-400);
          border-radius: 2px;
          padding: 0 1px;
        }

        /* Results */
        .page-discover__results-count {
          padding: 0 var(--space-4);
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          margin-bottom: var(--space-1);
        }

        /* Empty state */
        .page-discover__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-12) var(--space-4);
          color: var(--text-secondary);
          font-size: var(--font-sm);
        }

        .page-discover__empty-hint {
          color: var(--text-tertiary);
          font-size: var(--font-xs);
        }

        /* Default */
        .page-discover__default {
          padding: var(--space-8) var(--space-4);
        }

        .page-discover__placeholder {
          text-align: center;
          color: var(--text-secondary);
          font-size: var(--font-sm);
        }
      `}</style>
    </div>
  );
}
