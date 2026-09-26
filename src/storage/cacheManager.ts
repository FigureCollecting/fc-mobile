import { getDb } from './db';

export interface CacheStats {
  figureCount: number;
  pendingOpsCount: number;
  estimatedSizeKb: number;
}

/**
 * Gather cache statistics from IndexedDB stores.
 * Uses the Storage Manager API for size estimation when available,
 * otherwise falls back to a count-based heuristic.
 */
export async function getCacheStats(): Promise<CacheStats> {
  const db = await getDb();
  const figureCount = await db.count('figures');
  const pendingOpsCount = await db.count('pendingOps');

  let estimatedSizeKb = 0;

  // StorageManager estimate (if available)
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      if (usage) {
        estimatedSizeKb = Math.round(usage / 1024);
      }
    } catch {
      // Fallback: rough estimate of ~2KB per figure record
      estimatedSizeKb = Math.round(figureCount * 2);
    }
  } else {
    estimatedSizeKb = Math.round(figureCount * 2);
  }

  return { figureCount, pendingOpsCount, estimatedSizeKb };
}

/** Workbox's precache lives under this name prefix (see src/sw.ts, precacheAndRoute). */
const WORKBOX_PRECACHE_PREFIX = 'workbox-precache';

/**
 * Clear cached data: IndexedDB figures/metadata, React Query cache, and
 * runtime Service Worker caches. The React Query client must be cleared by
 * the caller (pass `queryClient.clear()` since we don't hold a reference
 * here).
 *
 * Two things are deliberately NEVER touched: `pendingOps` (the offline
 * outbox — clearing it would silently drop unsynced edits) and the workbox
 * precache (clearing it would leave the shell unable to boot offline until
 * the next successful fetch).
 */
export async function clearAllCaches(): Promise<void> {
  // 1. Clear IndexedDB stores — figures/metadata only, never the outbox.
  const db = await getDb();
  const tx = db.transaction(['figures', 'metadata'], 'readwrite');
  await Promise.all([
    tx.objectStore('figures').clear(),
    tx.objectStore('metadata').clear(),
    tx.done,
  ]);

  // 2. Clear runtime Service Worker caches, but keep the workbox precache.
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(WORKBOX_PRECACHE_PREFIX))
          .map((name) => caches.delete(name)),
      );
    } catch {
      // SW caches may not be available in all contexts
    }
  }
}
