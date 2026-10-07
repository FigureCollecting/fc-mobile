import { describe, expect, it } from 'vitest';
import { getDb } from '../db';
import { LOCAL_DB_VERSION, openLocalDb } from '../localDb';

const hung = (ms: number): Promise<'hung'> => new Promise((resolve) => setTimeout(() => resolve('hung'), ms));

describe('legacy v1 connection', () => {
  it('closes when the local store upgrades, so an open legacy page never blocks the upgrade', async () => {
    const v1 = await getDb();
    await v1.add('pendingOps', { type: 'create', data: { name: 'Miku' }, createdAt: 1 });
    let blocked = false;
    const v2 = await Promise.race([
      openLocalDb({
        onBlocked: () => {
          blocked = true;
        },
      }),
      hung(2_000),
    ]);
    expect(v2).not.toBe('hung');
    if (v2 === 'hung') return;
    expect(blocked).toBe(false);
    expect(v2.version).toBe(LOCAL_DB_VERSION);
    expect(await v2.count('legacy_pending')).toBe(1);
    v2.close();
    // The v1 page cannot reopen the newer database; it fails instead of hanging.
    await expect(getDb()).rejects.toThrow();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('fc-mobile');
      req.onsuccess = () => resolve();
    });
  });
});
