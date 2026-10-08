// The sync engine reads the session's rows on every pass, so a connection the browser force-closes
// (site data cleared) can abort an auth transaction mid-flight: it fails, and nothing else does.
// The two read-then-write transactions are covered here; the single-row gets go through idb's
// shortcut (reload.test.ts instruments those calls), so they are left as they are.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { openLocalDb } from '../../storage/localDb';
import { AuthStore } from '../store';

describe('AuthStore reads on a connection the browser closes', () => {
  const unhandled: unknown[] = [];
  const onRejection = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  it('reject the read in flight and leave no unhandled rejection behind', async () => {
    const db = await openLocalDb({ factory: new IDBFactory() });
    const store = new AuthStore(db);
    await store.setCurrentSub('user-a');
    // The browser aborts every transaction of a connection it closes; fake-indexeddb lets them finish.
    const raw = unwrap(db) as IDBDatabase;
    const open = raw.transaction.bind(raw);
    const made: IDBTransaction[] = [];
    raw.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const tx = open(...args);
      made.push(tx);
      return tx;
    }) as IDBDatabase['transaction'];
    const reads = [store.takePending('s'), store.addDeviceKey({ sub: 'user-a' } as never)];
    for (const tx of made) tx.abort();
    const settled = await Promise.allSettled(reads);
    expect(made).toHaveLength(2);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });
});
