import { useRef, useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { ComponentChildren } from 'preact';

/**
 * Lightweight animated route transitions using CSS transforms + opacity.
 * Detects navigation direction from history state to determine slide direction.
 *
 * - Forward navigation: slide from right
 * - Back navigation: slide from left
 * - Tab switches (bottom nav): crossfade
 */

const TAB_PATHS = new Set(['/', '/discover', '/prices', '/profile']);

interface AnimatedRoutesProps {
  children: ComponentChildren;
}

export function AnimatedRoutes({ children }: AnimatedRoutesProps) {
  const [location] = useLocation();
  const prevLocation = useRef(location);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyLength = useRef(window.history.length);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || location === prevLocation.current) return;

    const isTab = TAB_PATHS.has(location) && TAB_PATHS.has(prevLocation.current);
    const isBack = window.history.length <= historyLength.current;

    // Remove any existing animation class
    el.classList.remove(
      'animated-route--slide-in-right',
      'animated-route--slide-in-left',
      'animated-route--crossfade',
    );

    // Force reflow to restart animation
    void el.offsetWidth;

    if (isTab) {
      el.classList.add('animated-route--crossfade');
    } else if (isBack) {
      el.classList.add('animated-route--slide-in-left');
    } else {
      el.classList.add('animated-route--slide-in-right');
    }

    prevLocation.current = location;
    historyLength.current = window.history.length;

    const cleanup = () => {
      el.classList.remove(
        'animated-route--slide-in-right',
        'animated-route--slide-in-left',
        'animated-route--crossfade',
      );
    };

    el.addEventListener('animationend', cleanup, { once: true });
    return () => el.removeEventListener('animationend', cleanup);
  }, [location]);

  return (
    <div ref={containerRef} class="animated-route">
      {children}

      <style>{`
        .animated-route {
          will-change: transform, opacity;
        }

        .animated-route--slide-in-right {
          animation: ar-slide-right 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
        }

        .animated-route--slide-in-left {
          animation: ar-slide-left 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
        }

        .animated-route--crossfade {
          animation: ar-fade 200ms ease both;
        }

        @keyframes ar-slide-right {
          from {
            transform: translateX(30px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes ar-slide-left {
          from {
            transform: translateX(-30px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes ar-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .animated-route--slide-in-right,
          .animated-route--slide-in-left,
          .animated-route--crossfade {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
