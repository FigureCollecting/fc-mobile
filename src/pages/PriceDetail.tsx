import { useState, useCallback } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter';
import { SitePrice } from '../components/prices/SitePrice';
import { TrendIndicator } from '../components/prices/TrendIndicator';
import { AlertSheet } from '../components/prices/AlertSheet';
import {
  usePriceHistory,
  useCurrentPrices,
  useAlerts,
  useRemoveFromWatchlist,
  useSaveAlert,
  useDeleteAlert,
} from '../hooks/usePrices';
import type { PriceAlert, PricePoint, SitePrice as SitePriceData } from '../hooks/usePrices';

// --- Mock data for development ---
const MOCK_FIGURE = {
  name: 'Hatsune Miku: Magical Mirai 2024 Ver.',
  manufacturer: 'Good Smile Company',
  imageUrl: '',
};

const MOCK_PRICES: SitePriceData[] = [
  { site: 'AmiAmi', price: 15800, currency: 'JPY', stockStatus: 'in_stock' as const, url: 'https://amiami.com', lastUpdated: '2026-03-20T10:00:00Z' },
  { site: 'Solaris Japan', price: 17200, currency: 'JPY', stockStatus: 'in_stock' as const, url: 'https://solarisjapan.com', lastUpdated: '2026-03-20T08:30:00Z' },
  { site: 'Tokyo Otaku Mode', price: 168.99, currency: 'USD', stockStatus: 'pre_order' as const, url: 'https://otakumode.com', lastUpdated: '2026-03-19T22:00:00Z' },
  { site: 'Hobby Search', price: 16500, currency: 'JPY', stockStatus: 'sold_out' as const, url: 'https://1999.co.jp', lastUpdated: '2026-03-18T15:00:00Z' },
];

const MOCK_HISTORY: PricePoint[] = [
  { site: 'AmiAmi', price: 17200, currency: 'JPY', date: '2026-02-15T00:00:00Z' },
  { site: 'AmiAmi', price: 16800, currency: 'JPY', date: '2026-02-22T00:00:00Z' },
  { site: 'AmiAmi', price: 16200, currency: 'JPY', date: '2026-03-01T00:00:00Z' },
  { site: 'AmiAmi', price: 15800, currency: 'JPY', date: '2026-03-10T00:00:00Z' },
  { site: 'Solaris Japan', price: 18500, currency: 'JPY', date: '2026-02-15T00:00:00Z' },
  { site: 'Solaris Japan', price: 17800, currency: 'JPY', date: '2026-03-01T00:00:00Z' },
  { site: 'Solaris Japan', price: 17200, currency: 'JPY', date: '2026-03-10T00:00:00Z' },
];

const MOCK_ALERTS: PriceAlert[] = [
  {
    _id: 'alert-1',
    figureId: 'mock-1',
    figureName: 'Hatsune Miku: Magical Mirai 2024 Ver.',
    type: 'price_below',
    targetPrice: 15000,
    currency: 'JPY',
    sites: ['AmiAmi', 'Solaris Japan'],
    pushEnabled: true,
    status: 'active',
    createdAt: '2026-03-01T00:00:00Z',
  },
];

// Site color mapping for price history
const SITE_COLORS: Record<string, string> = {
  'AmiAmi': '#ff6b6b',
  'Solaris Japan': '#ffd93d',
  'Tokyo Otaku Mode': '#6bcb77',
  'Hobby Search': '#4d96ff',
  'Mandarake': '#c084fc',
};

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getSiteColor(site: string): string {
  return SITE_COLORS[site] ?? 'var(--text-tertiary)';
}

function SkeletonDetail() {
  return (
    <div class="price-detail" aria-hidden="true">
      <div class="price-detail__header-bar">
        <div class="price-detail__skeleton-line" style={{ width: '60%' }} />
      </div>
      <div class="price-detail__skeleton-card" />
      <div class="price-detail__skeleton-card" style={{ height: '200px' }} />
      <div class="price-detail__skeleton-card" />
      <style>{styles}</style>
    </div>
  );
}

export function PriceDetail() {
  const [, params] = useRoute('/prices/:figureId');
  const [, setLocation] = useLocation();
  const figureId = params?.figureId;

  const { data: currentPrices } = useCurrentPrices(figureId);
  const { data: priceHistory } = usePriceHistory(figureId);
  const { data: alerts } = useAlerts(figureId);
  const removeFromWatchlist = useRemoveFromWatchlist();
  const saveAlert = useSaveAlert();
  const deleteAlert = useDeleteAlert();

  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<PriceAlert | undefined>();

  // Use real data when available, fall back to mock
  const prices = currentPrices ?? MOCK_PRICES;
  const history = priceHistory ?? MOCK_HISTORY;
  const activeAlerts = alerts ?? MOCK_ALERTS;
  const figure = MOCK_FIGURE; // TODO: fetch from figure detail API

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/prices');
    }
  }, [setLocation]);

  const handleAddAlert = useCallback(() => {
    setEditingAlert(undefined);
    setAlertSheetOpen(true);
  }, []);

  const handleEditAlert = useCallback((alert: PriceAlert) => {
    setEditingAlert(alert);
    setAlertSheetOpen(true);
  }, []);

  const handleSaveAlert = useCallback((alertData: Parameters<typeof saveAlert.mutate>[0]) => {
    saveAlert.mutate(alertData as any);
  }, [saveAlert]);

  const handleDeleteAlert = useCallback((alertId: string) => {
    deleteAlert.mutate(alertId);
  }, [deleteAlert]);

  const handleRemoveFromWatchlist = useCallback(() => {
    if (figureId) {
      removeFromWatchlist.mutate(figureId);
      setLocation('/prices');
    }
  }, [figureId, removeFromWatchlist, setLocation]);

  if (!figureId) return <SkeletonDetail />;

  // Group history by site
  const historyBySite = history.reduce<Record<string, PricePoint[]>>((acc, point) => {
    if (!acc[point.site]) acc[point.site] = [];
    acc[point.site].push(point);
    return acc;
  }, {});

  const availableSites = prices.map((p) => p.site);

  return (
    <div class="price-detail">
      {/* Header */}
      <div class="price-detail__header-bar">
        <button
          class="price-detail__back-btn"
          onClick={handleBack}
          aria-label="Go back"
          type="button"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 class="price-detail__title">Price Details</h1>
      </div>

      {/* Figure info card */}
      <div class="price-detail__figure-card">
        <div class="price-detail__figure-image">
          {figure.imageUrl ? (
            <img src={figure.imageUrl} alt={figure.name} class="price-detail__figure-img" />
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          )}
        </div>
        <div class="price-detail__figure-info">
          <h2 class="price-detail__figure-name">{figure.name}</h2>
          <span class="price-detail__figure-maker">{figure.manufacturer}</span>
        </div>
      </div>

      {/* Price History (placeholder - list format until uPlot) */}
      <section class="price-detail__section">
        <h2 class="price-detail__section-title">Price History</h2>
        <div class="price-detail__history-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span>Interactive chart coming soon</span>
        </div>
        <div class="price-detail__history-list">
          {Object.entries(historyBySite).map(([site, points]) => (
            <div key={site} class="price-detail__history-group">
              <div class="price-detail__history-site">
                <span
                  class="price-detail__history-dot"
                  style={{ background: getSiteColor(site) }}
                />
                <span class="price-detail__history-site-name">{site}</span>
              </div>
              {points
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((point, i) => {
                  const prevPoint = points[i + 1];
                  const priceDiff = prevPoint ? point.price - prevPoint.price : 0;
                  const trend = priceDiff > 0 ? 'up' : priceDiff < 0 ? 'down' : 'stable';
                  return (
                    <div key={`${site}-${point.date}`} class="price-detail__history-entry">
                      <span class="price-detail__history-date">{formatDate(point.date)}</span>
                      <span class="price-detail__history-price">
                        {formatPrice(point.price, point.currency)}
                      </span>
                      {prevPoint && (
                        <TrendIndicator
                          trend={trend as 'up' | 'down' | 'stable'}
                          percent={Math.abs((priceDiff / prevPoint.price) * 100)}
                          size="sm"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </section>

      {/* Site Comparison */}
      <section class="price-detail__section">
        <h2 class="price-detail__section-title">Site Comparison</h2>
        <div class="price-detail__sites">
          {prices.map((sitePrice) => (
            <SitePrice key={sitePrice.site} data={sitePrice} />
          ))}
        </div>
      </section>

      {/* Alerts */}
      <section class="price-detail__section">
        <div class="price-detail__section-header">
          <h2 class="price-detail__section-title">Alerts</h2>
          <span class="price-detail__alert-count">{activeAlerts.length} active</span>
        </div>
        {activeAlerts.length > 0 ? (
          <div class="price-detail__alerts">
            {activeAlerts.map((alert) => (
              <button
                key={alert._id}
                class="price-detail__alert-card"
                onClick={() => handleEditAlert(alert)}
                type="button"
              >
                <div class="price-detail__alert-info">
                  <span class="price-detail__alert-type">
                    {alert.type === 'price_below' && `Price below ${formatPrice(alert.targetPrice!, alert.currency!)}`}
                    {alert.type === 'back_in_stock' && 'Back in stock'}
                    {alert.type === 'any_change' && 'Any price change'}
                  </span>
                  <span class="price-detail__alert-sites">
                    {alert.sites.join(', ')}
                  </span>
                </div>
                <span class={`price-detail__alert-status price-detail__alert-status--${alert.status}`}>
                  {alert.status}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p class="price-detail__no-alerts">No alerts configured for this item</p>
        )}
      </section>

      {/* Actions */}
      <div class="price-detail__actions">
        <button
          class="price-detail__action-btn price-detail__action-btn--primary"
          onClick={handleAddAlert}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Add Alert
        </button>
        <button
          class="price-detail__action-btn price-detail__action-btn--danger"
          onClick={handleRemoveFromWatchlist}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Remove from Watchlist
        </button>
      </div>

      {/* Bottom spacer */}
      <div class="price-detail__spacer" />

      {/* Alert Sheet */}
      <AlertSheet
        open={alertSheetOpen}
        onClose={() => setAlertSheetOpen(false)}
        figureId={figureId}
        figureName={figure.name}
        existingAlert={editingAlert}
        availableSites={availableSites}
        onSave={handleSaveAlert}
        onDelete={handleDeleteAlert}
      />

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .price-detail {
    min-height: 100%;
    background: var(--surface-primary);
    padding-bottom: 0;
  }

  /* Header bar */
  .price-detail__header-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-height);
    padding: 0 var(--space-2);
    padding-top: var(--safe-area-top);
    position: sticky;
    top: 0;
    background: var(--surface-primary);
    z-index: 10;
  }

  .price-detail__back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    color: var(--text-primary);
    border-radius: var(--radius-md);
  }

  .price-detail__back-btn:active {
    background: var(--surface-tertiary);
  }

  .price-detail__title {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  /* Figure card */
  .price-detail__figure-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 var(--space-4) var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
  }

  .price-detail__figure-image {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .price-detail__figure-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .price-detail__figure-info {
    flex: 1;
    min-width: 0;
  }

  .price-detail__figure-name {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .price-detail__figure-maker {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  /* Sections */
  .price-detail__section {
    padding: 0 var(--space-4);
    margin-bottom: var(--space-6);
  }

  .price-detail__section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .price-detail__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-3);
  }

  .price-detail__alert-count {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    margin-bottom: var(--space-3);
  }

  /* Price history placeholder */
  .price-detail__history-note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    margin-bottom: var(--space-3);
  }

  .price-detail__history-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .price-detail__history-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .price-detail__history-site {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }

  .price-detail__history-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .price-detail__history-site-name {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .price-detail__history-entry {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-2) var(--space-5);
    border-left: 2px solid var(--border-subtle);
    margin-left: 3px;
  }

  .price-detail__history-date {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    min-width: 90px;
  }

  .price-detail__history-price {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
  }

  /* Site comparison */
  .price-detail__sites {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Alerts */
  .price-detail__alerts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .price-detail__alert-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--touch-min);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-md);
    text-align: left;
    transition: background var(--transition-fast);
  }

  .price-detail__alert-card:active {
    background: var(--surface-tertiary);
  }

  .price-detail__alert-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .price-detail__alert-type {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
  }

  .price-detail__alert-sites {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .price-detail__alert-status {
    font-size: 0.625rem;
    font-weight: var(--font-weight-semibold);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    line-height: 1;
  }

  .price-detail__alert-status--active {
    background: rgba(34, 197, 94, 0.15);
    color: var(--accent-success);
  }

  .price-detail__alert-status--paused {
    background: var(--surface-tertiary);
    color: var(--text-tertiary);
  }

  .price-detail__no-alerts {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
    text-align: center;
    padding: var(--space-4);
  }

  /* Action buttons */
  .price-detail__actions {
    padding: 0 var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .price-detail__action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-min);
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    transition: all var(--transition-fast);
  }

  .price-detail__action-btn--primary {
    background: var(--brand-500);
    color: white;
  }

  .price-detail__action-btn--primary:active {
    background: var(--brand-600);
  }

  .price-detail__action-btn--danger {
    background: rgba(239, 68, 68, 0.1);
    color: var(--accent-danger);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .price-detail__action-btn--danger:active {
    background: rgba(239, 68, 68, 0.2);
  }

  /* Spacer */
  .price-detail__spacer {
    height: calc(var(--bottom-nav-height) + var(--safe-area-bottom) + var(--space-8));
  }

  /* Skeleton loading */
  .price-detail__skeleton-line {
    height: 20px;
    border-radius: var(--radius-sm);
    background: var(--surface-secondary);
    animation: pd-pulse 1.5s ease-in-out infinite;
  }

  .price-detail__skeleton-card {
    height: 120px;
    margin: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-secondary);
    animation: pd-pulse 1.5s ease-in-out infinite;
  }

  @keyframes pd-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;
