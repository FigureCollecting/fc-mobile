import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_DB_NAME, LOCAL_DB_VERSION, openLocalDb } from '../localDb';

// The v1 layout exactly as src/storage/db.ts creates it.
function openV1(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(LOCAL_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const figures = db.createObjectStore('figures', { keyPath: '_id' });
      figures.createIndex('by-status', 'collectionStatus');
      db.createObjectStore('metadata');
      db.createObjectStore('pendingOps', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const LEGACY_OPS = [
  { type: 'create', data: { name: 'Miku' }, createdAt: 1 },
  { type: 'update', figureId: 'f-2', data: { collectionStatus: 'owned' }, createdAt: 2 },
  { type: 'delete', figureId: 'f-3', createdAt: 3 },
  { type: 'update', figureId: 'f-4', data: { notes: 'boxed' }, createdAt: 4 },
];

async function seedV1(factory: IDBFactory): Promise<void> {
  const db = await openV1(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['figures', 'metadata', 'pendingOps'], 'readwrite');
    for (let i = 0; i < 20; i++) {
      tx.objectStore('figures').put({ _id: `f-${i}`, name: `Figure ${i}`, collectionStatus: i % 2 ? 'owned' : 'wished' });
    }
    tx.objectStore('metadata').put(Date.now(), 'lastFetch');
    for (const op of LEGACY_OPS) tx.objectStore('pendingOps').add(op);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('openLocalDb', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates the v2 stores on a fresh install', async () => {
    const factory = new IDBFactory();
    const db = await openLocalDb({ factory });
    expect(db.version).toBe(LOCAL_DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['auth', 'device_key', 'facets', 'legacy_pending', 'outbox', 'products', 'sync_meta'].sort(),
    );
    const tx = db.transaction(['facets', 'outbox', 'products', 'sync_meta', 'device_key', 'auth', 'legacy_pending']);
    expect(tx.objectStore('facets').keyPath).toEqual(['sub', 'facet_key']);
    expect(tx.objectStore('facets').index('by_head').keyPath).toEqual(['sub', 'head_id']);
    expect(tx.objectStore('outbox').keyPath).toBe('id');
    expect(tx.objectStore('outbox').autoIncrement).toBe(true);
    expect([...tx.objectStore('outbox').indexNames].sort()).toEqual(['by_sub', 'by_sub_client', 'by_sub_state']);
    expect(tx.objectStore('products').keyPath).toEqual(['sub', 'head_id']);
    expect(tx.objectStore('sync_meta').keyPath).toBe('sub');
    // Keyed by sub: user B on the same browser never finds user A's device key.
    expect(tx.objectStore('device_key').keyPath).toBe('sub');
    expect(tx.objectStore('auth').keyPath).toBeNull();
    expect(await tx.objectStore('legacy_pending').count()).toBe(0);
    db.close();
  });

  it('upgrades a v1 database with 20 figures and 4 pendingOps, keeping the ops in legacy_pending', async () => {
    const factory = new IDBFactory();
    await seedV1(factory);

    const db = await openLocalDb({ factory });

    expect(db.version).toBe(2);
    const names = [...db.objectStoreNames];
    expect(names).not.toContain('figures');
    expect(names).not.toContain('metadata');
    expect(names).not.toContain('pendingOps');
    const keys = await db.getAllKeys('legacy_pending');
    const values = await db.getAll('legacy_pending');
    expect(keys).toEqual([1, 2, 3, 4]);
    expect(values).toEqual(LEGACY_OPS);
    db.close();
  });

  it('keeps the v1 keys of pendingOps when earlier drains left gaps', async () => {
    const factory = new IDBFactory();
    const v1 = await openV1(factory);
    await new Promise<void>((resolve, reject) => {
      const ops = v1.transaction('pendingOps', 'readwrite').objectStore('pendingOps');
      for (let i = 1; i <= 9; i++) ops.add({ type: 'update', figureId: `f-${i}`, createdAt: i });
      for (const k of [1, 3, 4, 6, 7, 8]) ops.delete(k);
      ops.transaction.oncomplete = () => resolve();
      ops.transaction.onerror = () => reject(ops.transaction.error);
    });
    v1.close();

    const db = await openLocalDb({ factory });

    expect(await db.getAllKeys('legacy_pending')).toEqual([2, 5, 9]);
    expect(await db.getAll('legacy_pending')).toEqual([2, 5, 9].map((i) => ({ type: 'update', figureId: `f-${i}`, createdAt: i })));
    db.close();
  });

  it('keeps legacy_pending across a later reopen', async () => {
    const factory = new IDBFactory();
    await seedV1(factory);
    (await openLocalDb({ factory })).close();
    const db = await openLocalDb({ factory });
    expect(await db.count('legacy_pending')).toBe(4);
    db.close();
  });

  it('leaves the v1 database intact when the upgrade fails', async () => {
    const factory = new IDBFactory();
    await seedV1(factory);
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'legacy_pending') throw new DOMException('disk full', 'QuotaExceededError');
      return realPut.apply(this, args as Parameters<typeof realPut>);
    });

    await expect(openLocalDb({ factory })).rejects.toThrow();
    vi.restoreAllMocks();

    const v1 = await openV1(factory);
    expect(v1.version).toBe(1);
    const tx = v1.transaction(['figures', 'pendingOps']);
    const count = (store: string) =>
      new Promise<number>((resolve) => {
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
    expect(await count('figures')).toBe(20);
    expect(await count('pendingOps')).toBe(4);
    v1.close();
  });

  it('closes itself and asks for a reload when another page upgrades the database', async () => {
    const factory = new IDBFactory();
    const onVersionChange = vi.fn();
    const db = await openLocalDb({ factory, onVersionChange });

    // A newer build in another tab opens v3; it must not be blocked by this page.
    const req = factory.open(LOCAL_DB_NAME, 3);
    const v3 = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(onVersionChange).toHaveBeenCalledTimes(1);
    expect(v3.version).toBe(3);
    expect(() => db.transaction('facets')).toThrow();
    v3.close();
  });

  it('reports a connection the browser closed (site data cleared, storage evicted)', async () => {
    const factory = new IDBFactory();
    const onClose = vi.fn();
    const db = await openLocalDb({ factory, onClose });
    const closed = new Promise<void>((resolve) => db.addEventListener('close', () => resolve()));
    forceCloseDatabase(unwrap(db) as never);
    await closed;
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a page still holding v1 open, then completes once it closes', async () => {
    const factory = new IDBFactory();
    const legacy = await openV1(factory);
    const onBlocked = vi.fn(() => legacy.close());

    const db = await openLocalDb({ factory, onBlocked });

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(db.version).toBe(2);
    db.close();
  });

  it('opens on the global indexedDB when no factory is given', async () => {
    // A fresh global: the legacy v1 handle cached by setup.ts stays on the old one.
    vi.stubGlobal('indexedDB', new IDBFactory());
    try {
      const db = await openLocalDb();
      expect(db.name).toBe(LOCAL_DB_NAME);
      expect(db.version).toBe(LOCAL_DB_VERSION);
      db.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
