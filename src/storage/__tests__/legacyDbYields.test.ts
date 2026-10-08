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

  it('opens one connection for concurrent callers, so none is left open to block the upgrade (WebKit boot)', async () => {
    // Start from no legacy connection: a v3 open makes the cached one yield, then the store goes.
    (await openLocalDb()).close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('fc-mobile');
      req.onsuccess = () => resolve();
    });
    // A legacy page's first callers ask at once (AppShell and its banners at boot).
    const [a, b, c] = await Promise.all([getDb(), getDb(), getDb()]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    const v3 = await Promise.race([openLocalDb(), hung(2_000)]);
    expect(v3).not.toBe('hung');
    if (v3 === 'hung') return;
    expect(v3.version).toBe(LOCAL_DB_VERSION);
    v3.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('fc-mobile');
      req.onsuccess = () => resolve();
    });
  });
});
