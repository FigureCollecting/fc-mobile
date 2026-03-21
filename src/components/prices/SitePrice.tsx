import type { SitePrice as SitePriceData, StockStatus } from '../../hooks/usePrices';

interface SitePriceProps {
  data: SitePriceData;
}

const STOCK_CONFIG: Record<StockStatus, { label: string; cssClass: string }> = {
  in_stock: { label: 'In Stock', cssClass: 'site-price__stock--in-stock' },
  pre_order: { label: 'Pre-Order', cssClass: 'site-price__stock--pre-order' },
  sold_out: { label: 'Sold Out', cssClass: 'site-price__stock--sold-out' },
  unknown: { label: 'Unknown', cssClass: 'site-price__stock--unknown' },
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

export function SitePrice({ data }: SitePriceProps) {
  const stockConfig = STOCK_CONFIG[data.stockStatus] ?? STOCK_CONFIG.unknown;

  return (
    <div class={`site-price site-price--${data.stockStatus}`}>
      <div class="site-price__header">
        <span class="site-price__name">{data.site}</span>
        <a
          class="site-price__link"
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View on ${data.site}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
      <div class="site-price__body">
        <span class="site-price__price">{formatPrice(data.price, data.currency)}</span>
        <span class={`site-price__stock ${stockConfig.cssClass}`}>{stockConfig.label}</span>
      </div>
      <div class="site-price__footer">
        <span class="site-price__updated">Updated {formatDate(data.lastUpdated)}</span>
      </div>

      <style>{`
        .site-price {
          background: var(--surface-secondary);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-4);
          border-left: 3px solid var(--border-subtle);
        }

        .site-price--in_stock {
          border-left-color: var(--accent-success);
        }

        .site-price--pre_order {
          border-left-color: var(--accent-warning);
        }

        .site-price--sold_out {
          border-left-color: var(--accent-danger);
        }

        .site-price__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-2);
        }

        .site-price__name {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .site-price__link {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          color: var(--text-tertiary);
          border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }

        .site-price__link:active {
          color: var(--brand-400);
          background: var(--surface-tertiary);
        }

        .site-price__body {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-2);
        }

        .site-price__price {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .site-price__stock {
          display: inline-flex;
          align-items: center;
          font-size: 0.625rem;
          font-weight: var(--font-weight-semibold);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          line-height: 1;
        }

        .site-price__stock--in-stock {
          background: rgba(34, 197, 94, 0.15);
          color: var(--accent-success);
        }

        .site-price__stock--pre-order {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-warning);
        }

        .site-price__stock--sold-out {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-danger);
        }

        .site-price__stock--unknown {
          background: var(--surface-tertiary);
          color: var(--text-tertiary);
        }

        .site-price__footer {
          margin-top: var(--space-1);
        }

        .site-price__updated {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }
      `}</style>
    </div>
  );
}
