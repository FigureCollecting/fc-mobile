import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDb } from '../db';
import { clearAllCaches, getCacheStats } from '../cacheManager';

/** Minimal fake of the Cache Storage API, just enough to assert on. */
function installFakeCaches(names: string[]) {
  const deleted: string[] = [];
  const fake = {
    keys: vi.fn().mockResolvedValue(names),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  };
  vi.stubGlobal('caches', fake);
  return { fake, deleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearAllCaches', () => {
  it('clears figures and metadata but never the outbox (pendingOps)', async () => {
    const db = await getDb();
    await db.put('figures', { _id: 'f1' });
    await db.put('metadata', 'x', 'lastSync');
    await db.add('pendingOps', { type: 'create', createdAt: Date.now() });
    await db.add('pendingOps', { type: 'update', createdAt: Date.now() });
    await db.add('pendingOps', { type: 'delete', createdAt: Date.now() });

    await clearAllCaches();

    expect(await db.count('figures')).toBe(0);
    expect(await db.count('metadata')).toBe(0);
    expect(await db.count('pendingOps')).toBe(3);
  });

  it('deletes runtime Cache Storage entries but keeps the workbox precache', async () => {
    const { deleted } = installFakeCaches(['workbox-precache-v2-abc123', 'some-runtime-cache']);

    await clearAllCaches();

    expect(deleted).toContain('some-runtime-cache');
    expect(deleted).not.toContain('workbox-precache-v2-abc123');
  });

  it('getCacheStats still reports pending ops after a clear', async () => {
    const db = await getDb();
    await db.add('pendingOps', { type: 'create', createdAt: Date.now() });
    await clearAllCaches();
    const stats = await getCacheStats();
    expect(stats.pendingOpsCount).toBe(1);
  });
});
