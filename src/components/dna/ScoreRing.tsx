import { useState, useEffect, useRef } from 'preact/hooks';

interface ScoreRingProps {
  /** Score from 0-100 */
  score: number;
  /** Label displayed below the ring */
  label: string;
  /** Size of the ring in pixels */
  size?: number;
}

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--accent-success)';
  if (score >= 40) return 'var(--accent-warning)';
  return 'var(--accent-danger)';
}

export function ScoreRing({ score, label, size = 96 }: ScoreRingProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = visible ? score / 100 : 0;
  const dashOffset = circumference * (1 - progress);
  const color = scoreColor(score);

  return (
    <div class="score-ring" ref={ref} style={{ width: `${size}px` }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        class="score-ring__svg"
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-tertiary)"
          stroke-width={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          stroke-width={strokeWidth}
          stroke-linecap="round"
          stroke-dasharray={circumference}
          stroke-dashoffset={dashOffset}
          class="score-ring__progress"
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
            transition: visible ? 'stroke-dashoffset 1s var(--ease-out)' : 'none',
          }}
        />
      </svg>

      <span class="score-ring__value" style={{ color }}>
        {visible ? score : 0}
      </span>
      <span class="score-ring__label">{label}</span>

      <style>{`
        .score-ring {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
          position: relative;
        }

        .score-ring__svg {
          display: block;
        }

        .score-ring__value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, calc(-50% - 8px));
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          line-height: 1;
        }

        .score-ring__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}
