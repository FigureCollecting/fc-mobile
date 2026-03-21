import { Header } from '../components/layout/Header';

export function Prices() {
  return (
    <div class="page-prices">
      <Header title="Prices" />
      <div class="page-prices__content">
        <div class="page-prices__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 5-6" />
          </svg>
        </div>
        <h2 class="page-prices__title">Price Tracker</h2>
        <p class="page-prices__description">Coming Soon</p>
        <p class="page-prices__detail">Track price history and get alerts for your wishlisted figures</p>
      </div>

      <style>{`
        .page-prices__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: var(--space-12) var(--space-4);
          gap: var(--space-3);
        }

        .page-prices__icon {
          padding: var(--space-4);
          background: var(--surface-secondary);
          border-radius: var(--radius-full);
          margin-bottom: var(--space-4);
        }

        .page-prices__title {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .page-prices__description {
          font-size: var(--font-base);
          font-weight: var(--font-weight-semibold);
          color: var(--brand-500);
        }

        .page-prices__detail {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          text-align: center;
          max-width: 280px;
          line-height: var(--line-height-normal);
        }
      `}</style>
    </div>
  );
}
