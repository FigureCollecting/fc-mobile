interface StatCardProps {
  value: number | string;
  label: string;
  /** Optional color for the value text (CSS variable or direct color) */
  color?: string;
  /** Optional trend direction */
  trend?: 'up' | 'down' | 'stable';
  /** Whether the value is loading */
  loading?: boolean;
}

export function StatCard({ value, label, color, trend, loading }: StatCardProps) {
  return (
    <div class="stat-card">
      {loading ? (
        <span class="stat-card__skeleton" />
      ) : (
        <div class="stat-card__value-row">
          {trend && (
            <span class={`stat-card__trend stat-card__trend--${trend}`}>
              {trend === 'up' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              )}
              {trend === 'down' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14" />
                  <path d="M19 12l-7 7-7-7" />
                </svg>
              )}
              {trend === 'stable' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" />
                </svg>
              )}
            </span>
          )}
          <span
            class="stat-card__value"
            style={color ? { color } : undefined}
          >
            {value}
          </span>
        </div>
      )}
      <span class="stat-card__label">{label}</span>

      <style>{`
        .stat-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-1);
          padding: var(--space-3) var(--space-2);
          background: var(--surface-tertiary);
          border-radius: var(--radius-lg);
          min-width: 0;
        }

        .stat-card__value-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .stat-card__value {
          font-size: var(--font-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          line-height: var(--line-height-tight);
        }

        .stat-card__trend {
          display: flex;
          align-items: center;
        }

        .stat-card__trend--up {
          color: var(--accent-danger);
        }

        .stat-card__trend--down {
          color: var(--accent-success);
        }

        .stat-card__trend--stable {
          color: var(--text-tertiary);
        }

        .stat-card__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-medium);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stat-card__skeleton {
          display: block;
          width: 36px;
          height: 28px;
          background: var(--surface-secondary);
          border-radius: var(--radius-sm);
          animation: stat-pulse 1.5s ease-in-out infinite;
        }

        @keyframes stat-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
