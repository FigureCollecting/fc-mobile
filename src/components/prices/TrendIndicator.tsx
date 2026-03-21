import type { PriceTrend } from '../../hooks/usePrices';

interface TrendIndicatorProps {
  trend: PriceTrend;
  percent?: number;
  size?: 'sm' | 'md';
}

export function TrendIndicator({ trend, percent, size = 'sm' }: TrendIndicatorProps) {
  const iconSize = size === 'sm' ? 14 : 18;

  return (
    <span class={`trend-indicator trend-indicator--${trend} trend-indicator--${size}`}>
      {trend === 'up' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      )}
      {trend === 'down' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14" />
          <path d="M19 12l-7 7-7-7" />
        </svg>
      )}
      {trend === 'stable' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14" />
        </svg>
      )}
      {percent != null && (
        <span class="trend-indicator__percent">
          {trend === 'up' ? '+' : trend === 'down' ? '-' : ''}{Math.abs(percent).toFixed(1)}%
        </span>
      )}

      <style>{`
        .trend-indicator {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-weight: var(--font-weight-semibold);
          line-height: 1;
        }

        .trend-indicator--sm {
          font-size: var(--font-xs);
        }

        .trend-indicator--md {
          font-size: var(--font-sm);
        }

        .trend-indicator--up {
          color: var(--accent-danger);
        }

        .trend-indicator--down {
          color: var(--accent-success);
        }

        .trend-indicator--stable {
          color: var(--text-tertiary);
        }

        .trend-indicator__percent {
          margin-left: 1px;
        }
      `}</style>
    </span>
  );
}
