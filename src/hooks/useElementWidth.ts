import { useState, useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Observe an element's content width (ResizeObserver when available,
 * best-effort fallback otherwise — jsdom has neither RO nor layout).
 */
export function useElementWidth(ref: RefObject<HTMLElement>, fallback = 360): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
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
