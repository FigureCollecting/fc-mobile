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

let db: IDBPDatabase<FcMobileDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<FcMobileDB>> {
  if (!db) {
    db = await openDB<FcMobileDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const figureStore = database.createObjectStore('figures', { keyPath: '_id' });
        figureStore.createIndex('by-status', 'collectionStatus');

        database.createObjectStore('metadata');

        database.createObjectStore('pendingOps', { autoIncrement: true });
      },
    });
  }
  return db;
}
