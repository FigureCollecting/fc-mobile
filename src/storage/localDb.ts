import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { FacetRecord, OutboxEntry, ProductRecord, SyncMeta } from './records';

export const LOCAL_DB_NAME = 'fc-mobile';
export const LOCAL_DB_VERSION = 2;

export interface LocalDbSchema extends DBSchema {
  facets: {
    key: [string, string];
    value: FacetRecord;
    indexes: { by_head: [string, string] };
  };
  outbox: {
    key: number;
    value: OutboxEntry;
    indexes: {
      by_sub: [string, number];
      by_sub_state: [string, string, number];
      by_sub_client: [string, string, number];
    };
  };
  products: {
    key: [string, string];
    value: ProductRecord;
  };
  sync_meta: {
    key: string;
    value: SyncMeta;
  };
  device_key: {
    key: string;
    value: { sub: string; [k: string]: unknown };
  };
  auth: {
    key: IDBValidKey;
    value: unknown;
  };
  legacy_pending: {
    key: number;
    value: unknown;
  };
}

export type LocalDb = IDBPDatabase<LocalDbSchema>;

export interface OpenLocalDbOptions {
  /** Defaults to the global indexedDB. */
  factory?: IDBFactory;
  /**
   * Another page is upgrading or deleting the database: this connection is already closed.
   * `newVersion` is the version a newer build asked for, or null for a delete.
   */
  onVersionChange?: (newVersion: number | null) => void;
  /** The browser closed this connection (site data cleared, storage evicted); a new open may find the store empty. */
  onClose?: () => void;
  /** An older page (e.g. a v1 tab) still holds the database open; ask the user to close it. */
  onBlocked?: () => void;
}

type UpgradeTx = IDBPTransaction<LocalDbSchema, StoreNames<LocalDbSchema>[], 'versionchange'>;

// v1's Mongo-shaped figure cache is dropped; its queued edits are the user's only
// copy, so they move to legacy_pending and are never deleted. A failed copy
// aborts the upgrade and leaves v1 as it was.
async function upgradeFromV1(db: IDBPDatabase<unknown>, tx: UpgradeTx): Promise<void> {
  const raw = tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>;
  const source = raw.objectStore('pendingOps');
  const [keys, values] = await Promise.all([source.getAllKeys(), source.getAll()]);
  const target = raw.objectStore('legacy_pending');
  await Promise.all(keys.map((k, i) => target.put(values[i], k)));
  db.deleteObjectStore('pendingOps');
  db.deleteObjectStore('figures');
  db.deleteObjectStore('metadata');
}

function createV2(db: LocalDb): void {
  const facets = db.createObjectStore('facets', { keyPath: ['sub', 'facet_key'] });
  facets.createIndex('by_head', ['sub', 'head_id']);
  const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
  outbox.createIndex('by_sub', ['sub', 'id']);
  outbox.createIndex('by_sub_state', ['sub', 'state', 'id']);
  outbox.createIndex('by_sub_client', ['sub', 'client_id', 'batch_pos']);
  db.createObjectStore('products', { keyPath: ['sub', 'head_id'] });
  db.createObjectStore('sync_meta', { keyPath: 'sub' });
  db.createObjectStore('device_key', { keyPath: 'sub' });
  db.createObjectStore('auth');
  db.createObjectStore('legacy_pending', { autoIncrement: true });
}

/** Open 'fc-mobile' v2. Takes a factory because idb's openDB always uses the global indexedDB. */
export function openLocalDb(opts: OpenLocalDbOptions = {}): Promise<LocalDb> {
  const factory = opts.factory ?? indexedDB;
  const request = factory.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
  const opened = wrap(request) as Promise<LocalDb>;

  request.addEventListener('upgradeneeded', (event) => {
    const db = wrap(request.result) as unknown as LocalDb;
    const tx = wrap(request.transaction!) as unknown as UpgradeTx;
    // An aborted upgrade rejects the open request, which the caller sees.
    tx.done.catch(() => {});
    if (event.oldVersion < 2) createV2(db);
    if (event.oldVersion === 1) {
      upgradeFromV1(db as unknown as IDBPDatabase<unknown>, tx).catch(() => {
        try {
          tx.abort();
        } catch {
          // Already aborted by the failed request.
        }
      });
    }
  });
  request.addEventListener('blocked', () => opts.onBlocked?.());

  return opened.then((db) => {
    db.addEventListener('versionchange', (event) => {
      db.close();
      opts.onVersionChange?.(event.newVersion);
    });
    // Only a close the browser forces fires 'close'; db.close() above does not.
    db.addEventListener('close', () => opts.onClose?.());
    return db;
  });
}
