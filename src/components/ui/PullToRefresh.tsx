import { useRef, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { hapticMedium } from '../../utils/haptics';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ComponentChildren;
}

const THRESHOLD = 80;
const MAX_PULL = 140;

/**
 * Rubber-band damping: returns diminishing pull distance as you pull further.
 * Gives the native iOS overscroll feel.
 */
function rubberBand(distance: number, max: number): number {
  const ratio = distance / max;
  // Rubber band formula: d * (1 - 0.55 * pow(ratio, 2))
  return distance * (1 - 0.55 * Math.pow(Math.min(ratio, 1), 2));
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const hapticFired = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const container = containerRef.current;
    if (!container || container.scrollTop > 0 || refreshing) return;

    startY.current = e.touches[0].clientY;
    pulling.current = true;
    hapticFired.current = false;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current) return;

    const rawDelta = e.touches[0].clientY - startY.current;
    if (rawDelta > 0) {
      const dampened = rubberBand(rawDelta, MAX_PULL * 2);
      const clamped = Math.min(dampened, MAX_PULL);
      setPullDistance(clamped);

      // Haptic at threshold crossing
      if (clamped >= THRESHOLD && !hapticFired.current) {
        hapticFired.current = true;
        hapticMedium();
      } else if (clamped < THRESHOLD) {
        hapticFired.current = false;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.6);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  // Spinner rotation: 0-360 tied to pull distance
  const spinnerRotation = refreshing ? undefined : `rotate(${(pullDistance / THRESHOLD) * 360}deg)`;
  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div
      ref={containerRef}
      class="pull-to-refresh"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        class="pull-to-refresh__indicator"
        style={{
          height: `${pullDistance}px`,
          opacity: progress,
          transition: pulling.current ? 'none' : 'height 300ms cubic-bezier(0.25, 1, 0.5, 1), opacity 200ms ease',
        }}
      >
        <div
          class={`pull-to-refresh__spinner ${refreshing ? 'pull-to-refresh__spinner--active' : ''}`}
          style={{ transform: spinnerRotation }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2">
            <path
              d="M21 12a9 9 0 1 1-6.219-8.56"
              stroke={pullDistance >= THRESHOLD ? 'var(--brand-500)' : 'var(--text-tertiary)'}
              style={{ transition: 'stroke 150ms ease' }}
            />
          </svg>
        </div>
      </div>

      {children}

      <style>{`
        .pull-to-refresh {
          height: 100%;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .pull-to-refresh__indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .pull-to-refresh__spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          will-change: transform;
        }

        .pull-to-refresh__spinner--active svg {
          animation: ptr-spin 0.8s linear infinite;
        }

        @keyframes ptr-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
