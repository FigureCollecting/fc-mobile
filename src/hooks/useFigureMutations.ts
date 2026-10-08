// The edit hooks on the local store (WK-15). Every edit is a local write through the WK-13 engine
// (writeFacet and the store's intents): shown at once, queued in the outbox, synced by the engine,
// the only sync path, online or not. Status, count, score, note and wishability; the copy actions
// of the collection screen (GR 2026-09-26); and 'add to collection'.
import { useMemo } from 'preact/hooks';
import { useMutation } from '@tanstack/react-query';
import { ufFacetKey, type OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import type { CollectionStatus } from '@figurecollecting/fc-shared';
import { IntentError, type Disposal, type UserStore } from '../storage/userStore';
import { figureOf, type LocalFigure, type UfField } from '../local/figures';
import { readSnapshot } from '../local/useLocal';
import { requireSession } from '../local/session';

export interface FigureEdit {
  collectionStatus?: CollectionStatus;
  note?: string;
  /** The score, 1 to 10; null clears it. */
  rating?: number | null;
  /** The wishability, 1 to 5; null clears it. */
  wishRating?: number | null;
  /** The count of copies of the figure's shown kind, at least 1. */
  quantity?: number;
}

/** Write through the engine with the figure as the store holds it now. */
function withFigure<T>(id: string, fn: (store: UserStore, figure: LocalFigure) => Promise<T>): Promise<T> {
  return requireSession().engine.write(async (store) => {
    const figure = figureOf(await readSnapshot(store, false), id);
    if (figure === undefined) throw new IntentError('no_copy', `no copy of figure ${id}`);
    return fn(store, figure);
  });
}

const held = (figure: LocalFigure | undefined) => (figure?.local.copies ?? []).filter((c) => c.status !== 'former');

// A uf field's delete tombstones it on every head of the figure holding it live (sync.proto rule 6).
async function clearUf(store: UserStore, figure: LocalFigure, field: UfField): Promise<void> {
  for (const head of figure.local.heads) {
    const key = ufFacetKey(head, field);
    if ((await store.getFacet(key))?.value?.op === 'upsert') await store.writeFacet(key, null);
  }
}

async function applyEdit(store: UserStore, figure: LocalFigure, edit: FigureEdit): Promise<void> {
  const kind = edit.collectionStatus ?? figure.local.kind;
  const mine = figure.local.copies.filter((c) => c.status === figure.local.kind);
  if (edit.collectionStatus !== undefined && edit.collectionStatus !== figure.local.kind) {
    await store.moveCopies(
      mine.map((c) => c.occ_id),
      `${edit.collectionStatus}/default`,
    );
  }
  const values: Record<UfField, unknown> = { note: edit.note, score: edit.rating, wishability: edit.wishRating };
  for (const field of ['note', 'score', 'wishability'] as const) {
    const value = values[field];
    if (value === undefined) continue;
    if (value === null || value === '') await clearUf(store, figure, field);
    else await store.writeFacet(ufFacetKey(figure.local.ufTarget[field], field), { [field]: value });
  }
  if (edit.quantity !== undefined) {
    for (let n = mine.length; n < edit.quantity; n++) await store.createCopy(figure.local.headId, kind);
    const highest = mine.map((c) => c.occ_id).sort().reverse();
    for (const occ of highest.slice(0, Math.max(0, mine.length - edit.quantity))) await store.removeCopy({ occ_id: occ });
  }
}

export function useUpdateFigure() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FigureEdit }) => {
      if (data.quantity !== undefined && !(Number.isInteger(data.quantity) && data.quantity >= 1)) {
        throw new RangeError('the count of copies must be at least 1');
      }
      await withFigure(id, (store, figure) => applyEdit(store, figure, data));
    },
  });
}

/** Remove the figure from the collection: every copy it holds (its former copies stay). */
export function useDeleteFigure() {
  return useMutation({
    mutationFn: (id: string) =>
      withFigure(id, async (store, figure) => {
        for (const c of held(figure)) await store.removeCopy({ occ_id: c.occ_id });
      }),
  });
}

/** Move the held copies of several figures to one status, in one batch. */
export function useBulkUpdateStatus() {
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: CollectionStatus }) =>
      requireSession().engine.write(async (store) => {
        const snapshot = await readSnapshot(store, false);
        const occs = ids.flatMap((id) => held(figureOf(snapshot, id)).filter((c) => c.status !== status));
        if (occs.length > 0) {
          await store.moveCopies(
            occs.map((c) => c.occ_id),
            `${status}/default`,
          );
        }
      }),
  });
}

export function useBulkDelete() {
  return useMutation({
    mutationFn: (ids: string[]) =>
      requireSession().engine.write(async (store) => {
        const snapshot = await readSnapshot(store, false);
        for (const id of ids) for (const c of held(figureOf(snapshot, id))) await store.removeCopy({ occ_id: c.occ_id });
      }),
  });
}

export interface CopyActions {
  /** An ordered copy arrived: owned, filed in owned/default. */
  markArrived(occId: string): Promise<string | undefined>;
  /** Bulk 'Move N copies to…' a collection (a tab is its kind's default). */
  moveCopies(occIds: string[], collection: string): Promise<void>;
  removeCopy(occId: string): Promise<string | undefined>;
  /** Keep the lowest of N identical copies, across every head of the figure (LocalMeta.heads). */
  dedupe(heads: readonly string[], kind: OccurrenceStatus): Promise<string[]>;
  /** 'Mark sold/traded/gifted/…': former, with the disposal, in one batch. */
  markFormer(occIds: string[], disposal: Disposal): Promise<void>;
  /** A new copy of a figure (from a search result or a barcode lookup). */
  addToCollection(headId: string, kind: CollectionStatus): Promise<string>;
}

export function useCopyActions(): CopyActions {
  return useMemo(() => {
    const run = <T,>(fn: (store: UserStore) => Promise<T>): Promise<T> => requireSession().engine.write(fn);
    return {
      markArrived: (occId) => run((s) => s.markArrived({ occ_id: occId })),
      moveCopies: (occIds, collection) => run((s) => s.moveCopies(occIds, collection)),
      removeCopy: (occId) => run((s) => s.removeCopy({ occ_id: occId })),
      dedupe: (heads, kind) => run((s) => s.dedupe(heads, kind)),
      markFormer: (occIds, disposal) => run((s) => s.markFormer(occIds, disposal)),
      addToCollection: (headId, kind) => run((s) => s.createCopy(headId, kind)),
    };
  }, []);
}
