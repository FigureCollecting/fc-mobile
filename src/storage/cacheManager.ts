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

/**
 * Clear all caches: IndexedDB stores, React Query cache, and Service Worker caches.
 * The React Query client must be cleared by the caller (pass `queryClient.clear()`
 * since we don't hold a reference here).
 */
export async function clearAllCaches(): Promise<void> {
  // 1. Clear IndexedDB stores
  const db = await getDb();
  const tx = db.transaction(['figures', 'metadata', 'pendingOps'], 'readwrite');
  await Promise.all([
    tx.objectStore('figures').clear(),
    tx.objectStore('metadata').clear(),
    tx.objectStore('pendingOps').clear(),
    tx.done,
  ]);

  // 2. Clear Service Worker caches
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    } catch {
      // SW caches may not be available in all contexts
    }
  }
}
