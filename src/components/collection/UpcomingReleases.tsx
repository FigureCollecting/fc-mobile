import { useState, useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { useUpcomingReleases } from '../../hooks/useUpcomingReleases';

export function UpcomingReleases() {
  const [, setLocation] = useLocation();
  const { releases, thisMonthCount, isLoading } = useUpcomingReleases(60);
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (dismissed || isLoading || releases.length === 0) return null;

  const headerText =
    thisMonthCount > 0
      ? `${thisMonthCount} release${thisMonthCount === 1 ? '' : 's'} this month`
      : `${releases.length} upcoming release${releases.length === 1 ? '' : 's'}`;

  return (
    <div class="upcoming-releases">
      <div class="upcoming-releases__header">
        <div class="upcoming-releases__header-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span class="upcoming-releases__title">{headerText}</span>
        </div>
        <button
          class="upcoming-releases__dismiss"
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="upcoming-releases__scroll">
        {releases.slice(0, 10).map((r) => (
          <button
            key={`${r.figure._id}-${r.release.date}`}
            class="upcoming-releases__card"
            type="button"
            onClick={() => setLocation(`/figure/${r.figure._id}`)}
          >
            {r.figure.imageUrl ? (
              <img
                class="upcoming-releases__thumb"
                src={r.figure.imageUrl}
                alt={r.figure.name}
                loading="lazy"
              />
            ) : (
              <div class="upcoming-releases__thumb upcoming-releases__thumb--empty">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}
            <span class="upcoming-releases__name">{r.figure.name}</span>
            <span class="upcoming-releases__countdown">
              {r.daysUntil === 0
                ? 'Today!'
                : r.daysUntil === 1
                  ? 'Tomorrow'
                  : `In ${r.daysUntil} days`}
            </span>
          </button>
        ))}
      </div>

      <style>{`
        .upcoming-releases {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          background: var(--surface-secondary);
          border-bottom: 1px solid var(--border-subtle);
        }

        .upcoming-releases__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .upcoming-releases__header-left {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .upcoming-releases__title {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .upcoming-releases__dismiss {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          color: var(--text-tertiary);
          border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }

        .upcoming-releases__dismiss:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }

        .upcoming-releases__scroll {
          display: flex;
          gap: var(--space-3);
          overflow-x: auto;
          padding: var(--space-1) 0;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .upcoming-releases__scroll::-webkit-scrollbar {
          display: none;
        }

        .upcoming-releases__card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
          width: 96px;
          flex-shrink: 0;
          padding: var(--space-2);
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          text-align: center;
          transition: background var(--transition-fast);
        }

        .upcoming-releases__card:active {
          background: var(--surface-primary);
        }

        .upcoming-releases__thumb {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-sm);
          object-fit: cover;
        }

        .upcoming-releases__thumb--empty {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-secondary);
        }

        .upcoming-releases__name {
          font-size: 0.625rem;
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          line-height: var(--line-height-tight);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          max-height: 2.4em;
          width: 100%;
        }

        .upcoming-releases__countdown {
          font-size: 0.625rem;
          font-weight: var(--font-weight-semibold);
          color: var(--accent-warning);
        }
      `}</style>
    </div>
  );
}
