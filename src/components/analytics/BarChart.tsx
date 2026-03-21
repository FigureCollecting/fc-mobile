interface BarChartItem {
  label: string;
  value: number;
}

interface BarChartProps {
  items: BarChartItem[];
  /** Max items to show (default 10) */
  limit?: number;
  /** Bar fill color (CSS value) */
  barColor?: string;
  /** Called when an item is tapped */
  onItemTap?: (label: string) => void;
  /** Whether data is loading */
  loading?: boolean;
}

export function BarChart({ items, limit = 10, barColor, onItemTap, loading }: BarChartProps) {
  if (loading) {
    return (
      <div class="bar-chart">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} class="bar-chart__skeleton-row">
            <div class="bar-chart__skeleton-label" />
            <div class="bar-chart__skeleton-bar" style={{ width: `${80 - i * 12}%` }} />
          </div>
        ))}
        <style>{styles}</style>
      </div>
    );
  }

  const visible = items.slice(0, limit);
  const max = visible.reduce((m, item) => Math.max(m, item.value), 0);

  if (visible.length === 0) {
    return (
      <div class="bar-chart">
        <p class="bar-chart__empty">No data available</p>
        <style>{styles}</style>
      </div>
    );
  }

  const color = barColor ?? 'var(--brand-400)';

  return (
    <div class="bar-chart">
      {visible.map((item) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        const Tag = onItemTap ? 'button' : 'div';
        return (
          <Tag
            key={item.label}
            class={`bar-chart__row ${onItemTap ? 'bar-chart__row--tappable' : ''}`}
            type={onItemTap ? 'button' : undefined}
            onClick={onItemTap ? () => onItemTap(item.label) : undefined}
          >
            <span class="bar-chart__label">{item.label}</span>
            <div class="bar-chart__track">
              <div
                class="bar-chart__fill"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
            <span class="bar-chart__value">{item.value}</span>
          </Tag>
        );
      })}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .bar-chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bar-chart__row {
    display: grid;
    grid-template-columns: 120px 1fr 36px;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    width: 100%;
    text-align: left;
  }

  .bar-chart__row--tappable {
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-1);
    margin: 0 calc(-1 * var(--space-1));
    transition: background var(--transition-fast);
  }

  .bar-chart__row--tappable:active {
    background: var(--surface-tertiary);
  }

  .bar-chart__label {
    font-size: var(--font-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-chart__track {
    height: 20px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .bar-chart__fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width 400ms var(--ease-out);
    min-width: 4px;
  }

  .bar-chart__value {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    text-align: right;
  }

  .bar-chart__empty {
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-sm);
    padding: var(--space-4);
  }

  /* Skeleton loading */
  .bar-chart__skeleton-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) 0;
  }

  .bar-chart__skeleton-label {
    height: 14px;
    background: var(--surface-secondary);
    border-radius: var(--radius-sm);
    animation: bar-pulse 1.5s ease-in-out infinite;
  }

  .bar-chart__skeleton-bar {
    height: 20px;
    background: var(--surface-secondary);
    border-radius: var(--radius-sm);
    animation: bar-pulse 1.5s ease-in-out infinite;
  }

  @keyframes bar-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;
