interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  title: string;
  segments: DonutSegment[];
  /** Diameter in pixels */
  size?: number;
}

export function DonutChart({ title, segments, size = 160 }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  // Build conic-gradient stops
  let accumulated = 0;
  const stops: string[] = [];
  for (const segment of segments) {
    const pct = (segment.value / total) * 100;
    stops.push(`${segment.color} ${accumulated}% ${accumulated + pct}%`);
    accumulated += pct;
  }

  const gradient = `conic-gradient(${stops.join(', ')})`;

  return (
    <div class="donut-chart">
      <h3 class="donut-chart__title">{title}</h3>

      <div class="donut-chart__row">
        <div
          class="donut-chart__ring"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            background: gradient,
          }}
        >
          <div class="donut-chart__hole">
            <span class="donut-chart__total">{total}</span>
            <span class="donut-chart__total-label">total</span>
          </div>
        </div>

        <div class="donut-chart__legend">
          {segments.map((s) => (
            <div key={s.label} class="donut-chart__legend-item">
              <span
                class="donut-chart__legend-dot"
                style={{ background: s.color }}
              />
              <span class="donut-chart__legend-label">{s.label}</span>
              <span class="donut-chart__legend-value">
                {s.value} ({Math.round((s.value / total) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .donut-chart {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .donut-chart__title {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0 var(--space-1);
        }

        .donut-chart__row {
          display: flex;
          align-items: center;
          gap: var(--space-5);
        }

        .donut-chart__ring {
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .donut-chart__hole {
          width: 60%;
          height: 60%;
          border-radius: 50%;
          background: var(--surface-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
        }

        .donut-chart__total {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          line-height: 1;
        }

        .donut-chart__total-label {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .donut-chart__legend {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          min-width: 0;
          flex: 1;
        }

        .donut-chart__legend-item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .donut-chart__legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .donut-chart__legend-label {
          font-size: var(--font-sm);
          color: var(--text-primary);
          font-weight: var(--font-weight-medium);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }

        .donut-chart__legend-value {
          font-size: var(--font-xs);
          color: var(--text-secondary);
          white-space: nowrap;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
