import { useState, useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Observe an element's content width (ResizeObserver when available,
 * best-effort fallback otherwise — jsdom has neither RO nor layout).
 * Measured in a layout effect (STALE-CONTENT): before the first paint, so
 * the first frame is laid out at the real width, never at the fallback.
 */
export function useElementWidth(ref: RefObject<HTMLElement>, fallback = 360): number {
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);

  return width;
}
