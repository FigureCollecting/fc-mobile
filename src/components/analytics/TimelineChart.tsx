interface TimelineItem {
  month: string;
  count: number;
}

interface TimelineChartProps {
  items: TimelineItem[];
  /** Whether data is loading */
  loading?: boolean;
}

export function TimelineChart({ items, loading }: TimelineChartProps) {
  if (loading) {
    return (
      <div class="timeline-chart">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} class="timeline-chart__skeleton-row">
            <div class="timeline-chart__skeleton-label" />
            <div class="timeline-chart__skeleton-bar" style={{ width: `${50 + Math.random() * 40}%` }} />
          </div>
        ))}
        <style>{styles}</style>
      </div>
    );
  }

  const max = items.reduce((m, item) => Math.max(m, item.count), 0);

  if (items.length === 0) {
    return (
      <div class="timeline-chart">
        <p class="timeline-chart__empty">No growth data yet</p>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div class="timeline-chart">
      {items.map((item) => {
        const pct = max > 0 ? (item.count / max) * 100 : 0;
        return (
          <div key={item.month} class="timeline-chart__row">
            <span class="timeline-chart__month">{item.month}</span>
            <div class="timeline-chart__track">
              <div
                class="timeline-chart__fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span class="timeline-chart__count">{item.count}</span>
          </div>
        );
      })}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .timeline-chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .timeline-chart__row {
    display: grid;
    grid-template-columns: 60px 1fr 32px;
    align-items: center;
    gap: var(--space-2);
    padding: 3px 0;
  }

  .timeline-chart__month {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
  }

  .timeline-chart__track {
    height: 18px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .timeline-chart__fill {
    height: 100%;
    background: var(--brand-400);
    border-radius: var(--radius-sm);
    transition: width 400ms var(--ease-out);
    min-width: 2px;
  }

  .timeline-chart__count {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    text-align: right;
  }

  .timeline-chart__empty {
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-sm);
    padding: var(--space-4);
  }

  /* Skeleton loading */
  .timeline-chart__skeleton-row {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: var(--space-2);
    align-items: center;
    padding: 3px 0;
  }

  .timeline-chart__skeleton-label {
    height: 12px;
    background: var(--surface-secondary);
    border-radius: var(--radius-sm);
    animation: timeline-pulse 1.5s ease-in-out infinite;
  }

  .timeline-chart__skeleton-bar {
    height: 18px;
    background: var(--surface-secondary);
    border-radius: var(--radius-sm);
    animation: timeline-pulse 1.5s ease-in-out infinite;
  }

  @keyframes timeline-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;
