import { useState, useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Locates the app's single page-level scroll container (AppShell's
 * `.app-content`) so long lists can virtualize against the same element the
 * whole page already scrolls, instead of introducing a nested scrollbox.
 * Returns null when no such ancestor exists (e.g. a component rendered in
 * isolation, as in unit tests) — callers fall back to an unvirtualized
 * render in that case.
 */
export function useScrollParent(ref: RefObject<HTMLElement>): HTMLElement | null {
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setScrollParent((ref.current?.closest('.app-content') as HTMLElement | null) ?? null);
  }, [ref]);

  return scrollParent;
}
