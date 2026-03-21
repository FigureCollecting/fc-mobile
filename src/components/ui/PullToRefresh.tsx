import { useRef, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ComponentChildren;
}

const THRESHOLD = 80;

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const container = containerRef.current;
    if (!container || container.scrollTop > 0 || refreshing) return;

    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current) return;

    const deltaY = e.touches[0].clientY - startY.current;
    if (deltaY > 0) {
      setPullDistance(Math.min(deltaY * 0.5, 120));
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
          opacity: Math.min(pullDistance / THRESHOLD, 1),
        }}
      >
        <div class={`pull-to-refresh__spinner ${refreshing ? 'pull-to-refresh__spinner--active' : ''}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
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
          transition: height 200ms var(--spring-snappy);
        }

        .pull-to-refresh__spinner {
          display: flex;
          align-items: center;
          justify-content: center;
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
