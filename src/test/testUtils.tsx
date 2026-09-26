import type { ComponentChildren, VNode } from 'preact';
import { render } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

/**
 * Create a fresh QueryClient per test so cached queries don't bleed between
 * tests. Retries are disabled so error paths resolve immediately.
 */
export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, networkMode: 'always' },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

interface RenderOptions {
  initialPath?: string;
  queryClient?: QueryClient;
}

export interface RenderResult extends ReturnType<typeof render> {
  queryClient: QueryClient;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  /** Read the current in-memory path without invoking a hook. */
  currentPath: () => string;
  /** History of visited paths since render. Record-mode on. */
  history: string[];
}

/** Render a Preact component wrapped in QueryClientProvider + in-memory router. */
export function renderWithProviders(ui: VNode, opts: RenderOptions = {}): RenderResult {
  const queryClient = opts.queryClient ?? makeTestQueryClient();
  const loc = memoryLocation({ path: opts.initialPath ?? '/', record: true });
  const { hook, searchHook, navigate, history } = loc;

  const wrapper = ({ children }: { children: ComponentChildren }) => (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>{children}</Router>
    </QueryClientProvider>
  );

  const result = render(ui, { wrapper });
  return {
    ...result,
    queryClient,
    navigate,
    currentPath: () => history![history!.length - 1] ?? '/',
    history: history!,
  };
}

/** Flush pending microtasks — useful after user events or async mutations. */
export async function flushAll() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
