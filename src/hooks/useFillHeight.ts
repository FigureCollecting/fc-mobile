import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

function bottomInset(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.marginBottom) || 0);
}

/**
 * How tall the element can grow before its scroll container starts to
 * scroll: the container's height, less its bottom padding (the tab bar sits
 * over it), less the element's top in scroll-content space, less the bottom
 * padding, border and margin of every ancestor in between. Null without a
 * scroll container. Re-measured when `layoutKey` changes (content above the
 * element may have moved) and when the container resizes (fold, rotate).
 */
export function useFillHeight(
  ref: RefObject<HTMLElement>,
  scrollParent: HTMLElement | null,
  layoutKey: unknown,
): number | null {
  const [fill, setFill] = useState<number | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !scrollParent) {
      setFill(null);
      return;
    }
    const top =
      el.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - scrollParent.clientTop + scrollParent.scrollTop;
    let insets = parseFloat(getComputedStyle(scrollParent).paddingBottom) || 0;
    for (let a = el.parentElement; a && a !== scrollParent; a = a.parentElement) insets += bottomInset(a);
    setFill(Math.max(0, Math.floor(scrollParent.clientHeight - insets - top)));
  }, [ref, scrollParent, layoutKey, resizeTick]);

  useEffect(() => {
    if (!scrollParent) return;
    const bump = () => setResizeTick((t) => t + 1);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(bump);
      ro.observe(scrollParent);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, [scrollParent]);

  return fill;
}
