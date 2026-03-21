import { Header } from '../components/layout/Header';

export function Discover() {
  return (
    <div class="page-discover">
      <Header title="Discover" />
      <div class="page-discover__search">
        <div class="page-discover__search-input">
          <svg class="page-discover__search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            placeholder="Search figures, series, manufacturers..."
            class="page-discover__input"
          />
        </div>
      </div>
      <div class="page-discover__content">
        <p class="page-discover__placeholder">Browse the catalog to discover new figures</p>
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

        .page-discover__content {
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
