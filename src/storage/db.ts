import { openDB } from 'idb';
import type { IDBPDatabase, DBSchema } from 'idb';

const DB_NAME = 'fc-mobile';
const DB_VERSION = 1;

export interface PendingOp {
  type: 'create' | 'update' | 'delete';
  figureId?: string;
  data?: unknown;
  createdAt: number;
}

interface FcMobileDB extends DBSchema {
  figures: {
    key: string;
    value: { _id: string; collectionStatus?: string; [k: string]: unknown };
    indexes: { 'by-status': string };
  };
  metadata: {
    key: string;
    value: unknown;
  };
  pendingOps: {
    key: number;
    value: PendingOp;
  };
}

// One open shared by every caller: concurrent first calls (AppShell and its banners at boot) each
// opening their own connection left all but the last unclosed by the yield below, so the v3 upgrade
// waited on them forever (WebKit's boot hung at 'loading').
let db: Promise<IDBPDatabase<FcMobileDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<FcMobileDB>> {
  if (db === null) {
    const opening = openDB<FcMobileDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const figureStore = database.createObjectStore('figures', { keyPath: '_id' });
        figureStore.createIndex('by-status', 'collectionStatus');

        database.createObjectStore('metadata');

        database.createObjectStore('pendingOps', { autoIncrement: true });
      },
      // Yield to the v2 upgrade (storage/localDb.ts): a v1 handle left open blocks it forever.
      // There is one connection per open, so the one yielding is always the memoised one.
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        db = null;
      },
    });
    db = opening;
    // A failed open (a newer store exists) is not kept: the next call tries again.
    opening.catch(() => {
      db = null;
    });
  }
  return db;
}
