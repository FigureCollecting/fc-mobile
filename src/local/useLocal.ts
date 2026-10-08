// The screens' reads of the local store: one snapshot (facets, product cards, sync_meta and the read
// model) per store change, shared by every hook through the query cache and narrowed by `select`.
import { useCallback } from 'preact/hooks';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FacetRecord, ProductRecord, SyncMeta } from '../storage/records';
import type { UserStore } from '../storage/userStore';
import { buildView, type CollectionView, type LocalView } from '../sync/occurrences';
import { buildFigures, type FigureInputs, type LocalFigure } from './figures';
import { localSession } from './session';

export type AuthPhase = 'loading' | 'signed-out' | 'signed-in';

/** signed-in: a user's local data can be shown (offline, sign in to sync and reload required included). */
export function useAuthPhase(): AuthPhase {
  const session = localSession.value;
  if (session === undefined) return 'loading';
  const status = session.status.value;
  if (status === 'loading') return 'loading';
  return status === 'signed-out' ? 'signed-out' : 'signed-in';
}

export interface Snapshot extends FigureInputs {
  facets: FacetRecord[];
  products: ProductRecord[];
  meta: SyncMeta;
  figures: LocalFigure[];
  /** The four defaults and every user collection with a live name. */
  collections: CollectionView[];
  /** The occurrence view this change built, for the selects that need more than `figures`. */
  view: LocalView;
}

export async function readSnapshot(store: UserStore, stale: boolean): Promise<Snapshot> {
  const [facets, products, meta] = await Promise.all([store.listFacets(), store.listProducts(), store.getMeta()]);
  const inputs = { sub: store.sub, facets, products, stale, syncedAt: meta.status_at ?? null };
  const view = buildView(facets);
  return { ...inputs, meta, figures: buildFigures(inputs, view), collections: view.collections, view };
}

/** The snapshot, narrowed by `select` (keep it stable: useCallback), re-read on every engine change. */
export function useSnapshot<T>(select: (snapshot: Snapshot) => T, enabled = true): UseQueryResult<T> {
  const session = localSession.value;
  const phase = useAuthPhase();
  const engine = session?.engine;
  const rev = engine?.changes.value ?? 0;
  const state = engine?.state.value;
  const stale = state?.reachability === 'unreachable' || state?.phase === 'paused';
  return useQuery({
    queryKey: ['local', session?.sub() ?? null, rev, stale],
    queryFn: () => engine!.read((store) => readSnapshot(store, stale)),
    enabled: engine !== undefined && phase === 'signed-in' && enabled,
    select,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 60_000,
  });
}

const lastSynced = (s: Snapshot): number | null => s.meta.status_at ?? null;

/** When this device last heard from the server (sync_meta's last Status), or null. */
export function useLastSynced(): number | null {
  return useSnapshot(useCallback(lastSynced, [])).data ?? null;
}
