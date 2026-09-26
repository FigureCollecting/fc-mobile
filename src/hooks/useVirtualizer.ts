import { useReducer, useState, useLayoutEffect, useEffect } from 'preact/hooks';
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from '@tanstack/virtual-core';
import type { VirtualizerOptions } from '@tanstack/virtual-core';

// SSR-safe like @tanstack/react-virtual's own isomorphic layout effect —
// harmless here (Vite SPA, no SSR) but costs nothing to keep consistent.
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

type PreactVirtualizerOptions<TScrollElement extends Element, TItemElement extends Element> = Partial<
  Pick<VirtualizerOptions<TScrollElement, TItemElement>, 'observeElementRect' | 'observeElementOffset' | 'scrollToFn'>
> &
  Omit<VirtualizerOptions<TScrollElement, TItemElement>, 'observeElementRect' | 'observeElementOffset' | 'scrollToFn'>;

/**
 * Preact binding for @tanstack/virtual-core's Virtualizer class. There is no
 * official @tanstack/preact-virtual package, so this mirrors
 * @tanstack/react-virtual's useVirtualizer implementation exactly (one
 * Virtualizer instance per mount via useState's lazy initializer, options
 * re-applied every render via setOptions, _didMount on mount, _willUpdate
 * every render, and a rerender dispatched from the virtualizer's onChange)
 * substituting preact/hooks for React's.
 */
export function useVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: PreactVirtualizerOptions<TScrollElement, TItemElement>,
): Virtualizer<TScrollElement, TItemElement> {
  const rerender = useReducer(() => ({}), {})[1];

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      rerender({});
      options.onChange?.(instance, sync);
    },
  };

  const [instance] = useState(() => new Virtualizer(resolvedOptions));
  instance.setOptions(resolvedOptions);

  useIsomorphicLayoutEffect(() => instance._didMount(), []);
  useIsomorphicLayoutEffect(() => instance._willUpdate());

  return instance;
}
