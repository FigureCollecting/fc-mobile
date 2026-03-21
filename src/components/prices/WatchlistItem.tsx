import { useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { SwipeAction } from '../ui/SwipeAction';
import { TrendIndicator } from './TrendIndicator';
import type { WatchlistItem as WatchlistItemData } from '../../hooks/usePrices';

interface WatchlistItemProps {
  item: WatchlistItemData;
  onRemove: (figureId: string) => void;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

export function WatchlistItem({ item, onRemove }: WatchlistItemProps) {
  const [, setLocation] = useLocation();

  const handleTap = useCallback(() => {
    setLocation(`/prices/${item.figureId}`);
  }, [item.figureId, setLocation]);

  const handleRemove = useCallback(() => {
    onRemove(item.figureId);
  }, [item.figureId, onRemove]);

  return (
    <SwipeAction
      onSwipeLeft={handleRemove}
      rightContent={
        <span class="watchlist-item__remove-label">Remove</span>
      }
    >
      <button class="watchlist-item" onClick={handleTap} type="button">
        <div class="watchlist-item__image">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.figureName} class="watchlist-item__img" loading="lazy" />
          ) : (
            <div class="watchlist-item__placeholder">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          )}
        </div>

        <div class="watchlist-item__info">
          <span class="watchlist-item__name">{item.figureName}</span>
          <span class="watchlist-item__site">{item.cheapestSite}</span>
        </div>

        <div class="watchlist-item__price-area">
          <span class="watchlist-item__price">{formatPrice(item.lowestPrice, item.currency)}</span>
          <TrendIndicator trend={item.trend} percent={item.trendPercent} size="sm" />
        </div>

        <svg class="watchlist-item__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      <style>{`
        .watchlist-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          min-height: var(--touch-min);
          padding: var(--space-3) var(--space-4);
          background: var(--surface-primary);
          text-align: left;
          transition: background var(--transition-fast);
        }

        .watchlist-item:active {
          background: var(--surface-secondary);
        }

        .watchlist-item__image {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-sm);
          overflow: hidden;
          flex-shrink: 0;
          background: var(--surface-tertiary);
        }

        .watchlist-item__img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .watchlist-item__placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .watchlist-item__info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .watchlist-item__name {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .watchlist-item__site {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .watchlist-item__price-area {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          flex-shrink: 0;
        }

        .watchlist-item__price {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .watchlist-item__chevron {
          flex-shrink: 0;
        }

        .watchlist-item__remove-label {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: white;
        }
      `}</style>
    </SwipeAction>
  );
}
