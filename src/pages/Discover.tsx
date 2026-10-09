import { useState, useCallback, useRef, useMemo } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { CollectionStatus } from '@figurecollecting/fc-shared';
import type { CardText, ProductCard } from '@figurecollecting/fc-api-contract';
import { SlimHeader } from '../components/layout/SlimHeader';
import { BottomSheet } from '../components/ui/BottomSheet';
import { useSearch } from '../hooks/useSearch';
import { useCatalogSearch } from '../hooks/useCatalogSearch';
import { SyncBadge } from '../components/sync/SyncBadge';
import { useCollection } from '../hooks/useCollection';
import { useCopyActions } from '../hooks/useFigureMutations';
import { useBarcodeLookup, BarcodeFormatError } from '../hooks/useBarcodeLookup';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { requireSession } from '../local/session';
import type { LocalFigure } from '../local/figures';
import { TAB_LABEL } from '../components/collection/CollectionTabs';
import { showToast } from '../stores/toast';
import { Style } from '../styles/Style';

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

const ADD_KINDS: CollectionStatus[] = ['owned', 'ordered', 'wished'];

/** "Owned ×2 · Wished": what the user holds of a figure, every kind. */
function heldSummary(figures: LocalFigure[], headId: string): string {
  return figures
    .filter((f) => f.local.headId === headId)
    .map((f) => `${TAB_LABEL[f.local.kind]} ×${f.quantity ?? 1}`)
    .join(' · ');
}

/** A card's field as shown: absent (no value, or withheld from this caller) stays absent. */
const shown = (t: CardText | undefined): string | undefined => (t?.value ? t.value : undefined);


/** Add one copy of a figure to a tab: a local write, offline too. */
function AddSheet({ open, name, onAdd, onClose }: { open: boolean; name: string; onAdd: (kind: CollectionStatus) => void; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="add-sheet">
        <h2 class="add-sheet__title">{`Add ${name}`}</h2>
        {ADD_KINDS.map((kind) => (
          <button key={kind} type="button" class="add-sheet__kind" onClick={() => onAdd(kind)}>
            {`Add to ${TAB_LABEL[kind]}`}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

export function Discover() {
  const { query, updateQuery, figures: hits, isLoading, hasSearched, saveRecentSearch, getRecentSearches, clearRecentSearches } = useSearch();
  const [, setLocation] = useLocation();
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [adding, setAdding] = useState<{ headId: string; name: string } | null>(null);
  const [barcode, setBarcode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();
  const actions = useCopyActions();
  const lookup = useBarcodeLookup();
  const catalog = useCatalogSearch(query);

  // The whole collection, every kind, for suggestions and what each hit or barcode result holds.
  const { data: collectionData } = useCollection();
  const { data: formerData } = useCollection({ status: 'former' });
  const held = useMemo(() => [...(collectionData?.data ?? []), ...(formerData?.data ?? [])], [collectionData, formerData]);

  const suggestions = useMemo((): SuggestionGroup[] => {
    const groups: SuggestionGroup[] = [];
    const q = query.toLowerCase().trim();
    const recents = recentSearches
      .filter((s) => !q || s.toLowerCase().includes(q))
      .slice(0, 3)
      .map((s) => ({ id: `recent-${s}`, text: s, type: 'recent' as const }));
    if (recents.length > 0) groups.push({ label: 'Recent', items: recents });
    const makers = new Map<string, number>();
    for (const f of held) if (f.manufacturer) makers.set(f.manufacturer, (makers.get(f.manufacturer) ?? 0) + 1);
    const mfrs = [...makers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([m]) => m)
      .filter((m) => !q || m.toLowerCase().includes(q))
      .slice(0, 4)
      .map((m) => ({ id: `mfr-${m}`, text: m, type: 'manufacturer' as const }));
    if (mfrs.length > 0) groups.push({ label: 'Manufacturers', items: mfrs });
    return groups;
  }, [query, recentSearches, held]);

  const handleInput = useCallback(
    (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      updateQuery(value);
      setShowSuggestions(value.length > 0 || recentSearches.length > 0);
    },
    [updateQuery, recentSearches],
  );

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
    (text: string) => {
      updateQuery(text);
      if (inputRef.current) inputRef.current.value = text;
      saveRecentSearch(text);
      setRecentSearches(getRecentSearches());
      setShowSuggestions(false);
    },
    [updateQuery, saveRecentSearch, getRecentSearches],
  );

  const openFigure = useCallback(
    (f: LocalFigure) => {
      if (query.trim()) saveRecentSearch(query.trim());
      setLocation(`/figure/${f.local.headId}`);
    },
    [query, saveRecentSearch, setLocation],
  );

  const addCopy = useCallback(
    (headId: string, kind: CollectionStatus, card?: ProductCard) => {
      setAdding(null);
      const added = card === undefined ? actions.addToCollection(headId, kind) : requireSession().engine.write(async (store) => {
        // Keep the card the lookup fetched, so the new copy shows its facts offline at once.
        await store.putProducts([card]);
        return store.createCopy(card.headId, kind);
      });
      void added.then(
        () => showToast(`Added to ${TAB_LABEL[kind]}`, 'success'),
        (err: unknown) => showToast(`Could not add: ${(err as Error).message}`, 'error'),
      );
    },
    [actions],
  );

  // The catalog's hits below the local ones, without a figure the local hits already list: any head
  // a local hit answers for, so a merged-away head and its survivor both count. A search card's
  // requested_as is always empty (a search request names no refs), so only its head_id is read.
  const catalogHits = useMemo(() => {
    if (catalog.view.kind !== 'hits') return [];
    const listed = new Set(hits.flatMap((f) => f.local.heads));
    return catalog.view.hits.filter((c) => !listed.has(c.headId));
  }, [catalog.view, hits]);

  const showResults = hasSearched && hits.length > 0;
  const showEmpty = hasSearched && !isLoading && hits.length === 0;
  const hasSuggestions = showSuggestions && suggestions.length > 0 && !showResults;
  const lookupError = lookup.error === null ? null : lookup.error instanceof BarcodeFormatError ? lookup.error.message : `Lookup failed: ${lookup.error.message}`;

  return (
    <div class="page-discover">
      <SlimHeader context={<span>{showResults ? `Search (${hits.length})` : 'Search'}</span>} />

      <form class="page-discover__search" onSubmit={handleSubmit}>
        <div class="page-discover__search-input">
          <svg class="page-discover__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search your figures..."
            class="page-discover__input"
            value={query}
            onInput={handleInput}
            onFocus={() => setShowSuggestions(true)}
          />
          {query && (
            <button
              class="page-discover__clear-btn"
              type="button"
              onClick={() => {
                updateQuery('');
                if (inputRef.current) inputRef.current.value = '';
                setShowSuggestions(false);
              }}
              aria-label="Clear search"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6" />
                <path d="M9 9l6 6" />
              </svg>
            </button>
          )}
        </div>
      </form>

      <div class="page-discover__content">
        {hasSuggestions && (
          <div class="discover-suggestions">
            {suggestions.map((group) => (
              <div key={group.label} class="discover-suggestions__group">
                <div class="discover-suggestions__header">
                  <span class="discover-suggestions__label">{group.label}</span>
                  {group.label === 'Recent' && (
                    <button
                      class="discover-suggestions__clear"
                      type="button"
                      onClick={() => {
                        clearRecentSearches();
                        setRecentSearches([]);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {group.items.map((item) => (
                  <button key={item.id} class="discover-suggestions__item" type="button" onClick={() => handleSuggestionClick(item.text)}>
                    <span class="discover-suggestions__text">
                      <HighlightMatch text={item.text} query={query} />
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {showResults && (
          <ul class="discover-results" aria-label="Search results">
            {hits.map((f) => (
              <li key={f._id} class="discover-results__item">
                <button type="button" class="discover-results__open" aria-label={f.name} onClick={() => openFigure(f)}>
                  <span class="discover-results__name">{f.name}</span>
                  <span class="discover-results__meta">{[f.manufacturer, heldSummary(held, f.local.headId)].filter(Boolean).join(' · ')}</span>
                </button>
                <SyncBadge sync={f.local.sync} asOf={f.local.asOf} id={`search-sync-${f._id}`} />
                <button type="button" class="discover-results__add" onClick={() => setAdding({ headId: f.local.headId, name: f.name })}>
                  Add to collection
                </button>
              </li>
            ))}
          </ul>
        )}

        {showEmpty && (
          <div class="page-discover__empty">
            <p>No figure in your collection matches.</p>
          </div>
        )}

        {catalog.view.kind !== 'hidden' && (
          <section class="catalog" aria-label="In the catalog">
            <h2 class="catalog__title">In the catalog</h2>
            {catalog.view.kind === 'searching' && (
              <p class="catalog__note" role="status" aria-label="Searching the catalog">
                Searching the catalog…
              </p>
            )}
            {catalog.view.kind === 'failed' && (
              <p class="catalog__note">
                Catalog search failed.{' '}
                <button type="button" class="catalog__retry" onClick={catalog.retry}>
                  Try again
                </button>
              </p>
            )}
            {catalog.view.kind === 'hits' && catalogHits.length === 0 && !catalog.view.more && <p class="catalog__note">Nothing else in the catalog matches.</p>}
            {catalogHits.length > 0 && (
              <ul class="discover-results" aria-label="Catalog results">
                {catalogHits.map((card) => {
                  const meta = [shown(card.manufacturer), shown(card.scale), shown(card.releaseYm)].filter(Boolean).join(' · ');
                  const holding = heldSummary(held, card.headId);
                  return (
                    <li key={card.headId} class="discover-results__item">
                      <div class="discover-results__open">
                        <span class="discover-results__name">{shown(card.title) ?? 'Untitled figure'}</span>
                        {meta !== '' && <span class="discover-results__meta">{meta}</span>}
                        {holding !== '' && <span class="discover-results__held">{`In your collection: ${holding}`}</span>}
                      </div>
                      <button type="button" class="discover-results__add" onClick={() => addCopy(card.headId, 'owned', card)}>
                        Add to Owned
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {catalog.view.kind === 'hits' && catalog.view.moreFailed && <p class="catalog__note">Could not load more.</p>}
            {catalog.view.kind === 'hits' && catalog.view.more && (
              <button type="button" class="catalog__more" disabled={catalog.view.loadingMore} onClick={catalog.more}>
                More results
              </button>
            )}
          </section>
        )}

        {!hasSearched && !hasSuggestions && (
          <div class="page-discover__default">
            <p class="page-discover__placeholder">Search your collection by name, maker, character, series or JAN.</p>
          </div>
        )}

        <section class="barcode" aria-label="Barcode lookup">
          <form
            class="barcode__form"
            onSubmit={(e) => {
              e.preventDefault();
              lookup.mutate(barcode);
            }}
          >
            <label class="barcode__label" for="barcode-input">
              Barcode
            </label>
            <div class="barcode__row">
              <input
                id="barcode-input"
                class="barcode__input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="JAN, EAN or UPC"
                value={barcode}
                onInput={(e) => setBarcode((e.target as HTMLInputElement).value)}
              />
              <button type="submit" class="barcode__go" disabled={!online.value || lookup.isPending}>
                Look up
              </button>
            </div>
            {!online.value && <p class="barcode__note">Barcode lookup needs a connection.</p>}
            {lookupError !== null && <p class="barcode__note">{lookupError}</p>}
          </form>
          {lookup.data !== undefined && lookup.data.cards.length === 0 && <p class="barcode__note">No figure carries this barcode.</p>}
          {lookup.data !== undefined && lookup.data.cards.length > 0 && (
            <div class="barcode__result" role="region" aria-label="Barcode result">
              {lookup.data.cards.map((card) => {
                const holding = heldSummary(held, card.headId);
                return (
                  <div key={card.headId} class="barcode__card">
                    <span class="discover-results__name">{card.title?.value || 'Untitled figure'}</span>
                    {card.manufacturer?.value && <span class="discover-results__meta">{card.manufacturer.value}</span>}
                    {holding !== '' && <span class="discover-results__meta">{`In your collection: ${holding}`}</span>}
                    <div class="barcode__adds">
                      {ADD_KINDS.map((kind) => (
                        <button key={kind} type="button" class="add-sheet__kind" onClick={() => addCopy(card.headId, kind, card)}>
                          {`Add to ${TAB_LABEL[kind]}`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <AddSheet
        open={adding !== null}
        name={adding?.name ?? ''}
        onAdd={(kind) => adding !== null && addCopy(adding.headId, kind)}
        onClose={() => setAdding(null)}
      />

      <Style css={`
        .discover-results {
          list-style: none;
          margin: 0;
          padding: 0 var(--space-page);
        }
        .discover-results__item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .discover-results__open {
          flex: 1;
          min-width: 0;
          min-height: 44px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
        }
        .discover-results__name {
          font-weight: 600;
          color: var(--text-primary);
        }
        .discover-results__meta {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }
        .discover-results__held {
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }
        .catalog {
          margin-top: var(--space-3);
        }
        .catalog__title {
          padding: 0 var(--space-page);
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .catalog__note {
          padding: var(--space-2) var(--space-page);
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
        .catalog__retry {
          color: var(--brand-400);
        }
        .catalog__more {
          display: block;
          margin: var(--space-2) auto 0;
        }
        .catalog__more:disabled {
          opacity: 0.5;
        }
        .discover-results__add,
        .catalog__more,
        .add-sheet__kind,
        .barcode__go {
          min-height: 40px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-secondary);
          font-size: var(--font-sm);
          white-space: nowrap;
        }
        .add-sheet {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-page);
        }
        .add-sheet__title {
          font-size: var(--font-lg);
          font-weight: 700;
        }
        .barcode {
          margin: var(--space-4) var(--space-page);
          padding-top: var(--space-3);
          border-top: 1px solid var(--border-subtle);
        }
        .barcode__label {
          display: block;
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          margin-bottom: var(--space-1);
        }
        .barcode__row {
          display: flex;
          gap: var(--space-2);
        }
        .barcode__input {
          flex: 1;
          min-height: 44px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-default);
          background: var(--surface-secondary);
          color: var(--text-primary);
          font-size: var(--font-input);
        }
        .barcode__go:disabled {
          opacity: 0.5;
        }
        .barcode__note {
          margin-top: var(--space-2);
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
        .barcode__card {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          margin-top: var(--space-3);
        }
        .barcode__adds {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .page-discover__search {
          padding: 0 var(--space-page) var(--space-2);
        }

        .page-discover__search-input {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          background: var(--surface-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 0 var(--space-3);
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
          padding: var(--space-2) 0;
          color: var(--text-primary);
          font-size: var(--font-input);
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
          width: 28px;
          height: 28px;
          flex-shrink: 0;
        }

        .page-discover__content {
          padding-bottom: var(--space-3);
        }

        /* Smart suggestions */
        .discover-suggestions {
          padding: 0 var(--space-page);
          animation: suggestions-in 200ms ease both;
        }

        @keyframes suggestions-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .discover-suggestions__group {
          margin-bottom: var(--space-2);
        }

        .discover-suggestions__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-1);
        }

        .discover-suggestions__label {
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .discover-suggestions__clear {
          font-size: var(--font-2xs);
          color: var(--brand-400);
          padding: var(--space-1) var(--space-2);
        }

        .discover-suggestions__item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          min-height: 36px;
          padding: var(--space-1) var(--space-2);
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

        /* Results — flush edge-to-edge like Collection's Display B */
        .page-discover__results {
          padding: 0 0 var(--space-2);
        }

        /* Loading skeleton */
        .discover-skeleton {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 var(--space-page);
        }

        .discover-skeleton__row {
          display: flex;
          gap: 2px;
          height: 96px;
        }

        .discover-skeleton__tile {
          height: 100%;
          border-radius: var(--radius-sm);
          background: var(--surface-tertiary);
          animation: discover-skeleton-pulse 1.5s ease-in-out infinite;
        }

        @keyframes discover-skeleton-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }

        /* Empty state */
        .page-discover__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-8) var(--space-page);
          color: var(--text-secondary);
          font-size: var(--font-sm);
        }

        .page-discover__empty-hint {
          color: var(--text-tertiary);
          font-size: var(--font-xs);
        }

        /* Default */
        .page-discover__default {
          padding: var(--space-6) var(--space-page);
        }

        .page-discover__placeholder {
          text-align: center;
          color: var(--text-secondary);
          font-size: var(--font-sm);
        }
      `} />
    </div>
  );
}
