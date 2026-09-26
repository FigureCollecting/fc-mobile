// Persistent storage: without it the browser may evict IndexedDB (the outbox
// included) under pressure, and Safari clears tab storage after 7 idle days.

export type PersistResult = 'persisted' | 'granted' | 'denied' | 'unsupported';

const currentStorage = (): StorageManager | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.storage;

export async function requestPersistentStorage(storage = currentStorage()): Promise<PersistResult> {
  if (storage?.persist === undefined) return 'unsupported';
  try {
    if (await storage.persisted?.()) return 'persisted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

let hydrated = false;

/** Call when local data first lands; browsers grant persistence more readily to a site in use. */
export async function markHydrated(storage = currentStorage()): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  await requestPersistentStorage(storage);
}

export function resetHydratedForTest(): void {
  hydrated = false;
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function readStorageStatus(storage = currentStorage()): Promise<StorageStatus | null> {
  if (storage?.estimate === undefined) return null;
  try {
    const { usage = 0, quota = 0 } = await storage.estimate();
    const persisted = (await storage.persisted?.()) ?? false;
    return { usage, quota, persisted };
  } catch {
    return null;
  }
}
