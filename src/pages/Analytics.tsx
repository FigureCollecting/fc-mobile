import { useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { StatCard } from '../components/analytics/StatCard';
import { BarChart } from '../components/analytics/BarChart';
import { TimelineChart } from '../components/analytics/TimelineChart';
import { useCollectionAnalytics, useCollectionBreakdown, useCollectionTimeline, usePriceSummary } from '../hooks/useAnalytics';
import { useAuthStore } from '../stores/auth';
import { useQueryClient } from '@tanstack/react-query';

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="analytics-back-btn"
      onClick={onClick}
      type="button"
      aria-label="Go back"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>

      <style>{`
        .analytics-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast);
          margin-left: calc(-1 * var(--space-2));
        }

        .analytics-back-btn:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }
      `}</style>
    </button>
  );
}

function formatValue(value: number | null): string {
  if (value == null || value === 0) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function Analytics() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const collection = useCollectionAnalytics();
  const manufacturers = useCollectionBreakdown('manufacturer');
  const origins = useCollectionBreakdown('origin');
  const timeline = useCollectionTimeline(12);
  const prices = usePriceSummary();

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
  }, [queryClient]);

  const handleManufacturerTap = useCallback((label: string) => {
    // Navigate to collection filtered by manufacturer
    setLocation(`/?manufacturer=${encodeURIComponent(label)}`);
  }, [setLocation]);

  const handleOriginTap = useCallback((label: string) => {
    setLocation(`/?origin=${encodeURIComponent(label)}`);
  }, [setLocation]);

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div class="page-analytics">
        <Header title="Analytics" leading={<BackButton onClick={() => history.back()} />} />
        <div class="analytics__empty">
          <p>Sign in to view your collection analytics</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  const stats = collection.data;
  const isLoading = collection.isLoading;

  return (
    <div class="page-analytics">
      <Header title="Analytics" leading={<BackButton onClick={() => history.back()} />} />

      <PullToRefresh onRefresh={handleRefresh}>
        <div class="analytics__content">

          {/* Collection Overview Card */}
          <section class="analytics__section">
            <div class="analytics__overview-card">
              <div class="analytics__overview-hero">
                {isLoading ? (
                  <span class="analytics__skeleton-hero" />
                ) : (
                  <span class="analytics__hero-number">{stats?.totalFigures ?? 0}</span>
                )}
                <span class="analytics__hero-label">Total Figures</span>
              </div>

              <div class="analytics__overview-stats">
                <StatCard
                  value={stats?.statusCounts.owned ?? 0}
                  label="Owned"
                  color="var(--accent-success)"
                  loading={isLoading}
                />
                <StatCard
                  value={stats?.statusCounts.ordered ?? 0}
                  label="Ordered"
                  color="var(--accent-warning)"
                  loading={isLoading}
                />
                <StatCard
                  value={stats?.statusCounts.wished ?? 0}
                  label="Wished"
                  color="var(--accent-info)"
                  loading={isLoading}
                />
              </div>

              {(stats?.totalValue != null && stats.totalValue > 0) && (
                <div class="analytics__overview-value">
                  <span class="analytics__value-amount">{formatValue(stats.totalValue)} JPY</span>
                  <span class="analytics__value-label">Estimated Value</span>
                </div>
              )}
            </div>
          </section>

          {/* Collection Growth */}
          <section class="analytics__section">
            <h2 class="analytics__section-title">Collection Growth</h2>
            <div class="analytics__card">
              <TimelineChart
                items={timeline.data ?? []}
                loading={timeline.isLoading}
              />
            </div>
          </section>

          {/* Top Manufacturers */}
          <section class="analytics__section">
            <h2 class="analytics__section-title">Top Manufacturers</h2>
            <div class="analytics__card">
              <BarChart
                items={(manufacturers.data ?? []).map((b) => ({
                  label: b._id,
                  value: b.count,
                }))}
                limit={10}
                barColor="var(--brand-400)"
                onItemTap={handleManufacturerTap}
                loading={manufacturers.isLoading}
              />
            </div>
          </section>

          {/* Top Series / Origins */}
          <section class="analytics__section">
            <h2 class="analytics__section-title">Top Series</h2>
            <div class="analytics__card">
              <BarChart
                items={(origins.data ?? []).map((b) => ({
                  label: b._id,
                  value: b.count,
                }))}
                limit={10}
                barColor="var(--accent-info)"
                onItemTap={handleOriginTap}
                loading={origins.isLoading}
              />
            </div>
          </section>

          {/* Price Tracking Summary */}
          <section class="analytics__section">
            <h2 class="analytics__section-title">Price Tracking</h2>
            <div class="analytics__card analytics__price-summary">
              {prices.isLoading ? (
                <div class="analytics__price-loading">
                  <div class="analytics__skeleton-row" />
                  <div class="analytics__skeleton-row" />
                </div>
              ) : (
                <>
                  <div class="analytics__price-row">
                    <span class="analytics__price-label">Tracked Items</span>
                    <span class="analytics__price-value">{prices.data?.trackedItems ?? 0}</span>
                  </div>
                  <div class="analytics__price-row">
                    <span class="analytics__price-label">Trending Up</span>
                    <span class="analytics__price-value analytics__price-value--up">{prices.data?.trends.up ?? 0}</span>
                  </div>
                  <div class="analytics__price-row">
                    <span class="analytics__price-label">Trending Down</span>
                    <span class="analytics__price-value analytics__price-value--down">{prices.data?.trends.down ?? 0}</span>
                  </div>
                  <div class="analytics__price-row">
                    <span class="analytics__price-label">Stable</span>
                    <span class="analytics__price-value">{prices.data?.trends.stable ?? 0}</span>
                  </div>
                  <div class="analytics__price-row">
                    <span class="analytics__price-label">Active Alerts</span>
                    <span class="analytics__price-value analytics__price-value--alert">{prices.data?.activeAlerts ?? 0}</span>
                  </div>
                  <button
                    class="analytics__price-link"
                    type="button"
                    onClick={() => setLocation('/prices')}
                  >
                    View Price Tracker
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </section>

        </div>
      </PullToRefresh>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-analytics {
    min-height: 100%;
  }

  .analytics__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
    padding-bottom: var(--space-12);
  }

  .analytics__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    color: var(--text-secondary);
    font-size: var(--font-sm);
  }

  /* Section */
  .analytics__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .analytics__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--space-1);
  }

  .analytics__card {
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    padding: var(--space-4);
  }

  /* Overview Card */
  .analytics__overview-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    padding: var(--space-5);
  }

  .analytics__overview-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .analytics__hero-number {
    font-size: 3rem;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: 1;
  }

  .analytics__hero-label {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
  }

  .analytics__overview-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  .analytics__overview-value {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .analytics__value-amount {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--accent-success);
  }

  .analytics__value-label {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  /* Skeleton */
  .analytics__skeleton-hero {
    display: block;
    width: 80px;
    height: 48px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-md);
    animation: analytics-pulse 1.5s ease-in-out infinite;
  }

  /* Price summary */
  .analytics__price-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .analytics__price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .analytics__price-row:last-of-type {
    border-bottom: none;
  }

  .analytics__price-label {
    font-size: var(--font-sm);
    color: var(--text-secondary);
  }

  .analytics__price-value {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .analytics__price-value--up {
    color: var(--accent-danger);
  }

  .analytics__price-value--down {
    color: var(--accent-success);
  }

  .analytics__price-value--alert {
    color: var(--accent-warning);
  }

  .analytics__price-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-tertiary);
    border-radius: var(--radius-md);
    color: var(--brand-400);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    min-height: var(--touch-min);
    transition: background var(--transition-fast);
  }

  .analytics__price-link:active {
    background: var(--surface-primary);
  }

  /* Price loading */
  .analytics__price-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .analytics__skeleton-row {
    height: 20px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
    animation: analytics-pulse 1.5s ease-in-out infinite;
  }

  .analytics__skeleton-row:nth-child(2) {
    width: 60%;
    animation-delay: 0.15s;
  }

  @keyframes analytics-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;
