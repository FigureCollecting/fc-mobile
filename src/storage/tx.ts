import type { IDBPTransaction, StoreNames } from 'idb';
import type { LocalDb, LocalDbSchema } from './localDb';

/** An IndexedDB write failed and nothing of it was kept. `quota` = the device is out of space. */
export class LocalWriteError extends Error {
  readonly quota: boolean;

  constructor(message: string, quota: boolean, cause: unknown) {
    super(message, { cause });
    this.name = 'LocalWriteError';
    this.quota = quota;
  }
}

export type WriteTx<S extends StoreNames<LocalDbSchema>[]> = IDBPTransaction<LocalDbSchema, S, 'readwrite'>;

// One readwrite transaction that resolves only once committed. Any failure aborts
// all of it; an IndexedDB failure (a DOMException, e.g. QuotaExceededError at a
// request or at commit) surfaces as LocalWriteError.
export async function runTx<S extends StoreNames<LocalDbSchema>[], T>(
  db: LocalDb,
  stores: S,
  fn: (tx: WriteTx<S>) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, 'readwrite');
  tx.done.catch(() => {});
  try {
    const out = await fn(tx);
    await tx.done;
    return out;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Already committed or aborting.
    }
    if (err instanceof DOMException) {
      throw new LocalWriteError(`local write failed: ${err.name}`, err.name === 'QuotaExceededError', err);
    }
    throw err;
  }
}
