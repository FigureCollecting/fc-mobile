import { afterEach, describe, expect, it } from 'vitest';
import { cacheFigures, clearCache, getCachedFigures, getMetadata, setMetadata } from '../figureCache';
import { getCacheStats } from '../cacheManager';

// The v1 REST cache, kept until the hooks move to the v2 store.
const FIGURES = [
  { _id: 'f-1', collectionStatus: 'owned' },
  { _id: 'f-2', collectionStatus: 'wished' },
] as never[];

function stubEstimate(estimate?: () => Promise<StorageEstimate>): void {
  Object.defineProperty(navigator, 'storage', { value: estimate ? { estimate } : undefined, configurable: true });
}

afterEach(() => {
  delete (navigator as { storage?: unknown }).storage;
});

describe('v1 figure cache', () => {
  it('keeps metadata by key and clears it with the figures', async () => {
    await cacheFigures(FIGURES);
    await setMetadata('lastFetch', 123);
    expect(await getMetadata('lastFetch')).toBe(123);

    await clearCache();

    expect(await getCachedFigures()).toEqual([]);
    expect(await getMetadata('lastFetch')).toBeUndefined();
  });
});

describe('v1 cache stats', () => {
  it('reports the storage estimate in KB', async () => {
    await cacheFigures(FIGURES);
    stubEstimate(async () => ({ usage: 10_240 }));
    expect(await getCacheStats()).toEqual({ figureCount: 2, pendingOpsCount: 0, estimatedSizeKb: 10 });
  });

  it('reports 0 KB when the estimate carries no usage', async () => {
    stubEstimate(async () => ({}));
    expect((await getCacheStats()).estimatedSizeKb).toBe(0);
  });

  it('falls back to 2 KB a figure when the estimate fails or is missing', async () => {
    await cacheFigures(FIGURES);
    stubEstimate(async () => {
      throw new Error('denied');
    });
    expect((await getCacheStats()).estimatedSizeKb).toBe(4);
    stubEstimate();
    expect((await getCacheStats()).estimatedSizeKb).toBe(4);
  });
});
