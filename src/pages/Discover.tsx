import { useState, useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { useSearch } from '../hooks/useSearch';

export function Discover() {
  const {
    query,
    updateQuery,
    results,
    isLoading,
    hasSearched,
    saveRecentSearch,
    getRecentSearches,
    clearRecentSearches,
  } = useSearch();

  const [, setLocation] = useLocation();
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInput = useCallback(
    (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      updateQuery(value);
    },
    [updateQuery],
  );

  const handleSubmit = useCallback(
    (e: Event) => {
      e.preventDefault();
      if (query.trim()) {
        saveRecentSearch(query.trim());
        setRecentSearches(getRecentSearches());
      }
    },
    [query, saveRecentSearch, getRecentSearches],
  );

  const handleRecentClick = useCallback(
    (term: string) => {
      updateQuery(term);
      if (inputRef.current) {
        inputRef.current.value = term;
      }
    },
    [updateQuery],
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

  const showRecent = !hasSearched && recentSearches.length > 0;
  const showEmpty = hasSearched && !isLoading && results.length === 0;
  const showResults = hasSearched && results.length > 0;

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
          />
          {query && (
            <button
              class="page-discover__clear-btn"
              type="button"
              onClick={() => { updateQuery(''); if (inputRef.current) inputRef.current.value = ''; }}
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
        {/* Recent searches */}
        {showRecent && (
          <div class="page-discover__recent">
            <div class="page-discover__recent-header">
              <h2 class="page-discover__recent-title">Recent</h2>
              <button
                class="page-discover__recent-clear"
                onClick={handleClearRecent}
                type="button"
              >
                Clear
              </button>
            </div>
            <div class="page-discover__recent-list">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  class="page-discover__recent-item"
                  onClick={() => handleRecentClick(term)}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  <span>{term}</span>
                </button>
              ))}
            </div>
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
        {!hasSearched && !showRecent && (
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

        /* Recent searches */
        .page-discover__recent {
          padding: 0 var(--space-4);
        }

        .page-discover__recent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-3);
        }

        .page-discover__recent-title {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
        }

        .page-discover__recent-clear {
          font-size: var(--font-xs);
          color: var(--brand-400);
          padding: var(--space-1) var(--space-2);
        }

        .page-discover__recent-list {
          display: flex;
          flex-direction: column;
        }

        .page-discover__recent-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          color: var(--text-primary);
          text-align: left;
        }

        .page-discover__recent-item:active {
          background: var(--surface-secondary);
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
