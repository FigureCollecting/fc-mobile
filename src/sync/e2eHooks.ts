// Test-only handles on the sync engine for the local-stack Playwright suite. Loaded only when the
// build sets VITE_E2E_HOOKS=true (.env.stack); production builds never import it.
import type { CollectionKind, OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import type { FacetRecord, OutboxState } from '../storage/records';
import type { UserStore } from '../storage/userStore';
import type { SyncEngine, SyncState } from './engine';

export interface SyncHooks {
  state(): SyncState;
  /** Run a pass now and resolve with the state after it. */
  syncNow(): Promise<SyncState>;
  counts(): Promise<{ shown: number; products: number; cursor: string; outbox: Partial<Record<OutboxState, number>> }>;
  copies(): Promise<Array<{ occ_id: string; head_id: string | null; status: string | null; shown_in: string | null }>>;
  outbox(): Promise<Array<{ facet_key: string; state: OutboxState; outcome?: string; client_id?: string; reason?: string }>>;
  facet(key: string): Promise<FacetRecord | undefined>;
  createCopy(headId: string, status: OccurrenceStatus): Promise<string>;
  setStatus(occId: string, status: OccurrenceStatus): Promise<void>;
  moveCopy(occId: string, collection: string): Promise<void>;
  createCollection(kind: CollectionKind, name: string): Promise<string>;
  writeNote(headId: string, note: string): Promise<void>;
}

export function createSyncHooks(engine: SyncEngine): SyncHooks {
  const read = <T>(fn: (store: UserStore) => Promise<T>): Promise<T> => engine.read(fn);
  return {
    state: () => engine.state.peek(),
    syncNow: async () => {
      await engine.trigger('manual');
      return engine.state.peek();
    },
    counts: () =>
      read(async (store) => {
        const view = await store.getView();
        const outbox: Partial<Record<OutboxState, number>> = {};
        for (const e of await store.listOutbox()) outbox[e.state] = (outbox[e.state] ?? 0) + 1;
        return {
          shown: view.copies.filter((c) => c.shown_in !== null).length,
          products: (await store.listProducts()).length,
          cursor: (await store.getMeta()).cursor,
          outbox,
        };
      }),
    copies: () =>
      read(async (store) => (await store.getView()).copies.map((c) => ({ occ_id: c.occ_id, head_id: c.head_id, status: c.status, shown_in: c.shown_in }))),
    outbox: () =>
      read(async (store) =>
        (await store.listOutbox()).map((e) => ({
          facet_key: e.facet_key,
          state: e.state,
          ...(e.outcome === undefined ? {} : { outcome: e.outcome }),
          ...(e.client_id === undefined ? {} : { client_id: e.client_id }),
          ...(e.reason === undefined ? {} : { reason: e.reason }),
        })),
      ),
    facet: (key) => read((store) => store.getFacet(key)),
    createCopy: (headId, status) => engine.write((store) => store.createCopy(headId, status)),
    setStatus: (occId, status) => engine.write((store) => store.setStatus(occId, status)),
    moveCopy: (occId, collection) => engine.write((store) => store.moveCopy(occId, collection)),
    createCollection: (kind, name) => engine.write((store) => store.createCollection(kind, name)),
    writeNote: async (headId, note) => {
      await engine.write((store) => store.writeFacet(ufFacetKey(headId, 'note'), { note }));
    },
  };
}

export function installSyncHooks(engine: SyncEngine, target: { __fcSync?: unknown } = window as never): void {
  target.__fcSync = createSyncHooks(engine);
}
