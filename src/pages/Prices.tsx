import { useState, useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { ErrorState } from '../components/ui/ErrorState';
import { WatchlistItem } from '../components/prices/WatchlistItem';
import { TrendIndicator } from '../components/prices/TrendIndicator';
import { useWatchlist, useRemoveFromWatchlist } from '../hooks/usePrices';
import { useAuthStore } from '../stores/auth';

function SettingsButton() {
  return (
    <button class="prices-settings-btn" type="button" aria-label="Price settings">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>

      <style>{`
        .prices-settings-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast);
        }

        .prices-settings-btn:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }
      `}</style>
    </button>
  );
}

export function Prices() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading, isError, refetch } = useWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const [, setLocation] = useLocation();
  const [fabExpanded] = useState(false);

  // Only trust server data. An empty/absent payload means "show empty/error",
  // never "pretend there's data".
  const items = data?.items ?? [];
  const summary = data?.summary ?? { totalItems: 0, avgTrend: 'stable' as const, avgTrendPercent: 0 };

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleRemoveItem = useCallback((figureId: string) => {
    removeFromWatchlist.mutate(figureId);
  }, [removeFromWatchlist]);

  const handleFabClick = useCallback(() => {
    setLocation('/');
  }, [setLocation]);

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div class="page-prices">
        <Header title="Price Tracker" />
        <div class="page-prices__empty-state">
          <div class="page-prices__empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 16l4-8 4 4 5-6" />
            </svg>
          </div>
          <p class="page-prices__empty-text">Sign in to track prices</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Loading
  if (isLoading && !data) {
    return (
      <div class="page-prices">
        <Header title="Price Tracker" action={<SettingsButton />} />
        <div class="page-prices__loading">
          <div class="page-prices__skeleton-summary" />
          <div class="page-prices__skeleton-item" />
          <div class="page-prices__skeleton-item" />
          <div class="page-prices__skeleton-item" />
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Real error — show the user, don't fabricate data.
  if (isError && !data) {
    return (
      <div class="page-prices">
        <Header title="Price Tracker" action={<SettingsButton />} />
        <ErrorState
          title="Couldn't load watchlist"
          message="We couldn't reach the price tracker. Check your connection and try again."
          onRetry={handleRefresh}
        />
        <style>{styles}</style>
      </div>
    );
  }

  // Empty watchlist
  if (items.length === 0) {
    return (
      <div class="page-prices">
        <Header title="Price Tracker" action={<SettingsButton />} />
        <PullToRefresh onRefresh={handleRefresh}>
          <div class="page-prices__empty-state">
            <div class="page-prices__empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 16l4-8 4 4 5-6" />
              </svg>
            </div>
            <h2 class="page-prices__empty-title">No Tracked Items</h2>
            <p class="page-prices__empty-text">Add items to your watchlist to track prices</p>
            <button
              class="page-prices__browse-btn"
              onClick={() => setLocation('/')}
              type="button"
            >
              Browse Collection
            </button>
          </div>
        </PullToRefresh>
        <style>{styles}</style>
      </div>
    );
  }

  // Watchlist with data
  return (
    <div class="page-prices">
      <Header title="Price Tracker" action={<SettingsButton />} />

      <PullToRefresh onRefresh={handleRefresh}>
        {/* Summary Card */}
        <div class="page-prices__summary">
          <div class="page-prices__summary-stat">
            <span class="page-prices__summary-value">{summary.totalItems}</span>
            <span class="page-prices__summary-label">Tracked Items</span>
          </div>
          <div class="page-prices__summary-divider" />
          <div class="page-prices__summary-stat">
            <div class="page-prices__summary-trend">
              <TrendIndicator trend={summary.avgTrend} percent={summary.avgTrendPercent} size="md" />
            </div>
            <span class="page-prices__summary-label">Avg. Trend</span>
          </div>
        </div>

        {/* Watchlist */}
        <div class="page-prices__watchlist">
          <h2 class="page-prices__section-title">Watchlist</h2>
          <div class="page-prices__list">
            {items.map((item) => (
              <WatchlistItem
                key={item.figureId}
                item={item}
                onRemove={handleRemoveItem}
              />
            ))}
          </div>
        </div>
      </PullToRefresh>

      {/* FAB - Add to watchlist */}
      <button
        class={`page-prices__fab ${fabExpanded ? 'page-prices__fab--expanded' : ''}`}
        onClick={handleFabClick}
        type="button"
        aria-label="Add to watchlist"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-prices {
    min-height: 100%;
    position: relative;
  }

  /* Summary card */
  .page-prices__summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-6);
    margin: var(--space-4);
    padding: var(--space-4) var(--space-6);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
  }

  .page-prices__summary-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .page-prices__summary-value {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .page-prices__summary-label {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  .page-prices__summary-divider {
    width: 1px;
    height: 40px;
    background: var(--border-subtle);
  }

  .page-prices__summary-trend {
    display: flex;
    align-items: center;
  }

  /* Watchlist section */
  .page-prices__watchlist {
    padding: 0 0 var(--space-12) 0;
  }

  .page-prices__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: var(--space-2) var(--space-4);
  }

  .page-prices__list {
    display: flex;
    flex-direction: column;
  }

  /* FAB */
  .page-prices__fab {
    position: fixed;
    bottom: calc(var(--bottom-nav-height) + var(--safe-area-bottom) + var(--space-4));
    right: var(--space-4);
    width: 56px;
    height: 56px;
    background: var(--brand-500);
    color: white;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-lg);
    z-index: 50;
    transition: all var(--transition-fast);
  }

  .page-prices__fab:active {
    background: var(--brand-600);
    transform: scale(0.95);
  }

  /* Empty state */
  .page-prices__empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    gap: var(--space-3);
  }

  .page-prices__empty-icon {
    padding: var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-full);
    margin-bottom: var(--space-4);
  }

  .page-prices__empty-title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .page-prices__empty-text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    text-align: center;
    max-width: 280px;
    line-height: var(--line-height-normal);
  }

  .page-prices__browse-btn {
    margin-top: var(--space-4);
    min-height: var(--touch-min);
    padding: var(--space-3) var(--space-8);
    background: var(--brand-500);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    transition: background var(--transition-fast);
  }

  .page-prices__browse-btn:active {
    background: var(--brand-600);
  }

  /* Loading skeletons */
  .page-prices__loading {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .page-prices__skeleton-summary {
    height: 80px;
    border-radius: var(--radius-lg);
    background: var(--surface-secondary);
    animation: prices-pulse 1.5s ease-in-out infinite;
  }

  .page-prices__skeleton-item {
    height: 64px;
    border-radius: var(--radius-md);
    background: var(--surface-secondary);
    animation: prices-pulse 1.5s ease-in-out infinite;
  }

  .page-prices__skeleton-item:nth-child(3) {
    animation-delay: 0.15s;
  }

  .page-prices__skeleton-item:nth-child(4) {
    animation-delay: 0.3s;
  }

  @keyframes prices-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;
