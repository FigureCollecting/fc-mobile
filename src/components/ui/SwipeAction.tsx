import { useRef, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface SwipeActionProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftContent?: ComponentChildren;
  rightContent?: ComponentChildren;
  children: ComponentChildren;
}

const SWIPE_THRESHOLD = 80;

export function SwipeAction({
  onSwipeLeft,
  onSwipeRight,
  leftContent,
  rightContent,
  children,
}: SwipeActionProps) {
  const [offsetX, setOffsetX] = useState(0);
  const startX = useRef(0);
  const swiping = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = true;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!swiping.current) return;

    const deltaX = e.touches[0].clientX - startX.current;
    const maxLeft = onSwipeLeft && leftContent ? 120 : 0;
    const maxRight = onSwipeRight && rightContent ? -120 : 0;

    setOffsetX(Math.max(maxRight, Math.min(maxLeft, deltaX)));
  }, [onSwipeLeft, onSwipeRight, leftContent, rightContent]);

  const handleTouchEnd = useCallback(() => {
    swiping.current = false;

    if (offsetX > SWIPE_THRESHOLD && onSwipeRight) {
      onSwipeRight();
    } else if (offsetX < -SWIPE_THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    }

    setOffsetX(0);
  }, [offsetX, onSwipeLeft, onSwipeRight]);

  return (
    <div class="swipe-action">
      {rightContent && (
        <div class="swipe-action__bg swipe-action__bg--right">
          {rightContent}
        </div>
      )}
      {leftContent && (
        <div class="swipe-action__bg swipe-action__bg--left">
          {leftContent}
        </div>
      )}

      <div
        class="swipe-action__content"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping.current ? 'none' : 'transform 250ms var(--spring-snappy)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>

      <style>{`
        .swipe-action {
          position: relative;
          overflow: hidden;
        }

        .swipe-action__bg {
          position: absolute;
          top: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          padding: 0 var(--space-4);
        }

        .swipe-action__bg--left {
          left: 0;
          background: var(--accent-success);
          border-radius: var(--radius-md);
        }

        .swipe-action__bg--right {
          right: 0;
          background: var(--accent-danger);
          border-radius: var(--radius-md);
        }

        .swipe-action__content {
          position: relative;
          z-index: 1;
          background: var(--surface-primary);
        }
      `}</style>
    </div>
  );
}
