import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Install DOM polyfills BEFORE any modules that read them at import-time
// (e.g. stores/theme.ts subscribes to matchMedia on load). jsdom stubs these
// keys on `window` as undefined, so we install unconditionally.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(globalThis as unknown as { IntersectionObserver: typeof NoopIntersectionObserver }).IntersectionObserver =
  NoopIntersectionObserver;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver = NoopResizeObserver;

// Dynamic import AFTER polyfills are in place.
const { useAuthStore } = await import('../stores/auth');

// Reset DOM and in-memory state between tests so no stray elements / store
// values leak across.
afterEach(async () => {
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    lastActivity: 0,
    twoFactorPending: null,
  });
  // Wipe IDB content via the existing connection (swapping the global
  // indexedDB doesn't help because the cached `db` handle in storage/db.ts
  // still points at the old database).
  try {
    const { getDb } = await import('../storage/db');
    const db = await getDb();
    await db.clear('figures');
    await db.clear('metadata');
    await db.clear('pendingOps');
  } catch {
    // Best-effort; fake-indexeddb may not be loaded for non-page tests.
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Default online state. Individual tests flip via Object.defineProperty.
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
