interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Tiny inline SVG sparkline for price trend visualization.
 * Pure SVG, zero library dependencies.
 * Green if trending down (good for buyers), red if trending up.
 */
export function Sparkline({ points, width = 60, height = 20, color }: SparklineProps) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;

  // Auto-color based on trend direction if no color specified
  const trend = points[points.length - 1]! - points[0]!;
  const strokeColor = color ?? (trend > 0 ? 'var(--accent-danger)' : 'var(--accent-success)');

  const pathData = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 2) - 1;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  // Gradient fill under the line
  const fillPath = `${pathData} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      class="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-grad-${trend > 0 ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={strokeColor} stop-opacity="0.2" />
          <stop offset="100%" stop-color={strokeColor} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path
        d={fillPath}
        fill={`url(#spark-grad-${trend > 0 ? 'up' : 'down'})`}
      />
      <path
        d={pathData}
        fill="none"
        stroke={strokeColor}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <style>{`
        .sparkline {
          display: inline-block;
          vertical-align: middle;
          flex-shrink: 0;
        }
      `}</style>
    </svg>
  );
}
