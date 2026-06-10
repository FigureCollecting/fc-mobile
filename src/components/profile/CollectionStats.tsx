import { useCollectionStats } from '../../hooks/useCollectionStats';

export function CollectionStats() {
  const { data, isLoading } = useCollectionStats();

  const stats = [
    { label: 'Owned', count: data?.owned ?? 0, colorClass: 'collection-stats__card--owned' },
    { label: 'Ordered', count: data?.ordered ?? 0, colorClass: 'collection-stats__card--ordered' },
    { label: 'Wished', count: data?.wished ?? 0, colorClass: 'collection-stats__card--wished' },
  ];

  return (
    <div class="collection-stats">
      {stats.map((stat) => (
        <div key={stat.label} class={`collection-stats__card ${stat.colorClass}`}>
          {isLoading ? (
            <span class="collection-stats__skeleton" />
          ) : (
            <span class="collection-stats__count">{stat.count}</span>
          )}
          <span class="collection-stats__label">{stat.label}</span>
        </div>
      ))}

      <style>{`
        .collection-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-3);
          width: 100%;
        }

        .collection-stats__card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-1);
          padding: var(--space-4) var(--space-2);
          border-radius: var(--radius-lg);
          background: var(--surface-tertiary);
        }

        .collection-stats__card--owned {
          border: 1px solid rgba(34, 197, 94, 0.25);
        }

        .collection-stats__card--ordered {
          border: 1px solid rgba(245, 158, 11, 0.25);
        }

        .collection-stats__card--wished {
          border: 1px solid rgba(59, 130, 246, 0.25);
        }

        .collection-stats__count {
          font-size: var(--font-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          line-height: var(--line-height-tight);
        }

        .collection-stats__card--owned .collection-stats__count {
          color: var(--accent-success);
        }

        .collection-stats__card--ordered .collection-stats__count {
          color: var(--accent-warning);
        }

        .collection-stats__card--wished .collection-stats__count {
          color: var(--accent-info);
        }

        .collection-stats__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-medium);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .collection-stats__skeleton {
          display: block;
          width: 36px;
          height: 28px;
          background: var(--surface-secondary);
          border-radius: var(--radius-sm);
          animation: stats-pulse 1.5s ease-in-out infinite;
        }

        @keyframes stats-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
