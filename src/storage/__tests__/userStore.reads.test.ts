// Reads on a connection the browser force-closes (site data cleared, the 7-day eviction): the read
// fails, and nothing else does. idb's shortcut reads leave each transaction's done promise
// unwatched, so an abort there surfaced as an unhandled rejection the page logs as an error.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unwrap } from 'idb';
import { HEAD, freshDb, key, openStore, write } from '../../sync/__tests__/harness';

describe('UserStore reads on a connection the browser closes', () => {
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
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'x');
    await store.putProducts([]);
    // The browser aborts every transaction of a connection it closes; fake-indexeddb lets them finish, so abort them here.
    const raw = unwrap(db) as IDBDatabase;
    const open = raw.transaction.bind(raw);
    const made: IDBTransaction[] = [];
    raw.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const tx = open(...args);
      made.push(tx);
      return tx;
    }) as IDBDatabase['transaction'];
    const reads = [store.listOutbox(), store.listFacets(), store.getFacet(key(0, 'note')), store.getMeta(), store.listProducts(), store.getProduct(HEAD[0])];
    for (const tx of made) tx.abort();
    const settled = await Promise.allSettled(reads);
    expect(made).toHaveLength(6);
    expect(settled.map((s) => s.status)).toEqual(Array(6).fill('rejected'));
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });

  it('still read normally on an open connection', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'x');
    expect((await store.listOutbox()).length).toBe(1);
    expect((await store.getFacet(key(0, 'note')))!.facet_key).toBe(key(0, 'note'));
    expect((await store.listFacets()).length).toBe(1);
    expect((await store.getMeta()).sub).toBe('user-a');
    expect(await store.listProducts()).toEqual([]);
    expect(await store.getProduct(HEAD[0])).toBeUndefined();
  });
});
