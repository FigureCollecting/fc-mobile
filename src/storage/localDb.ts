import { wrap, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { parseUserFacetKey } from '@figurecollecting/fc-api-contract';
import type { FacetRecord, OutboxEntry, ProductRecord, SyncMeta } from './records';
import { indexFacet } from '../sync/facetIndex';

export const LOCAL_DB_NAME = 'fc-mobile';
export const LOCAL_DB_VERSION = 3;

export interface LocalDbSchema extends DBSchema {
  facets: {
    key: [string, string];
    value: FacetRecord;
    indexes: { by_head: [string, string]; by_occ: [string, string]; by_tag: [string, string] };
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

// v3 (contract 0.3.0): copies and tags are indexed. The retired holding/* edits
// (and any other key a 0.3.0 client may not push) move to legacy_pending, never
// deleted. Every kept edit gets an empty basis (it was minted before any basis
// was kept, so it claims to have seen nothing), and a batch sent but unanswered
// is queued again: a 0.3.0 push carries the basis, so the old bytes cannot be
// replayed. Then every facet row is re-parsed (sync.proto rule 6, READERS). A
// failed step aborts the upgrade and leaves v2 as it was.
async function upgradeFromV2(tx: UpgradeTx): Promise<void> {
  const outbox = tx.objectStore('outbox');
  const moved = new Set<number>();
  for (const entry of await outbox.getAll()) {
    if (parseUserFacetKey(entry.facet_key) === undefined) {
      await tx.objectStore('legacy_pending').put(entry);
      await outbox.delete(entry.id!);
      moved.add(entry.id!);
      continue;
    }
    const kept: OutboxEntry = { ...entry, basis: entry.basis ?? '' };
    if (kept.state === 'IN_FLIGHT') {
      kept.state = 'PENDING';
      delete kept.client_id;
      delete kept.batch_pos;
    }
    await outbox.put(kept);
  }
  const facets = tx.objectStore('facets');
  for (const rec of await facets.getAll()) {
    if (rec.pending_id !== null && moved.has(rec.pending_id)) rec.pending_id = null;
    await facets.put(indexFacet(rec));
  }
}

function createV3(tx: UpgradeTx): void {
  const facets = tx.objectStore('facets');
  facets.createIndex('by_occ', ['sub', 'occ_id']);
  facets.createIndex('by_tag', ['sub', 'tag_id']);
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

/** Open 'fc-mobile' v3. Takes a factory because idb's openDB always uses the global indexedDB. */
export function openLocalDb(opts: OpenLocalDbOptions = {}): Promise<LocalDb> {
  const factory = opts.factory ?? indexedDB;
  const request = factory.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
  const opened = wrap(request) as Promise<LocalDb>;

  request.addEventListener('upgradeneeded', (event) => {
    const db = wrap(request.result) as unknown as LocalDb;
    const tx = wrap(request.transaction!) as unknown as UpgradeTx;
    // An aborted upgrade rejects the open request, which the caller sees.
    tx.done.catch(() => {});
    const abort = () => {
      try {
        tx.abort();
      } catch {
        // Already aborted by the failed request.
      }
    };
    if (event.oldVersion < 2) createV2(db);
    if (event.oldVersion < 3) createV3(tx);
    if (event.oldVersion === 1) upgradeFromV1(db as unknown as IDBPDatabase<unknown>, tx).catch(abort);
    if (event.oldVersion === 2) upgradeFromV2(tx).catch(abort);
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
