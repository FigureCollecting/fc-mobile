// The per-facet LWW rule (sync.proto rule 5): a value replaces the replica's
// only when its version is greater, compared bytewise through compareVersion.
// What the user sees is the replica with the unanswered outbox laid over it
// (rule 6, THE IMPORT, ON A CLIENT): a newer remote value never drops a pending
// edit, which is still pushed for the server to decide. Pure, so it is the same
// whatever order or how often events arrive.
import { SERVER_DEVICE_ID, SyncOp, compareVersion, isCanonicalVersion, parseVersion, type SyncEvent } from '@figurecollecting/fc-api-contract';
import type { FacetRecord, FacetValue } from '../storage/records';
import { indexFacet } from './facetIndex';

export type RemoteEvent = Pick<SyncEvent, 'facetKey' | 'version' | 'op' | 'payload'>;

/** The event as a facet value, or undefined when this client cannot order or read it. */
export function toFacetValue(event: RemoteEvent): FacetValue | undefined {
  if (!isCanonicalVersion(event.version)) return undefined;
  if (event.op === SyncOp.UPSERT) return { version: event.version, op: 'upsert', payload: event.payload };
  if (event.op === SyncOp.DELETE) return { version: event.version, op: 'delete', payload: '' };
  return undefined;
}

export function isNewer(value: FacetValue, than: FacetValue | null): boolean {
  return than === null || compareVersion(value.version, than.version) > 0;
}

/** The higher of two versions, or undefined when neither is held: the facet floor for the next edit. */
export function floorOf(rec: FacetRecord): string | undefined {
  const versions = [rec.value?.version, rec.known?.version].filter((v): v is string => v !== undefined);
  return versions.sort(compareVersion).at(-1);
}

export function emptyFacet(sub: string, facetKey: string): FacetRecord {
  return indexFacet({ sub, facet_key: facetKey, value: null, known: null, pending_id: null, overwritten: null });
}

const deviceOf = (value: FacetValue): string | undefined => parseVersion(value.version)?.deviceId ?? undefined;

// A payload's content without its display stamp: two devices writing the same value differ only
// there. A tombstone's empty payload is its own content, which no upsert's is ({} at least).
function content(value: FacetValue): string {
  try {
    const { edited_at: _at, tz: _tz, ...rest } = JSON.parse(value.payload) as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return value.payload;
  }
}

/**
 * 'Replaced by another device' (client-only, GR 2026-09-26 D11): the value this device wrote that
 * `after` replaced, when another device (not the import's server device) wrote a different value.
 */
export function replacedMine(before: FacetValue | null, after: FacetValue | null, deviceId: string): FacetValue | null {
  if (before === null || after === null || deviceOf(before) !== deviceId) return null;
  const by = deviceOf(after);
  if (by === undefined || by === deviceId || by === SERVER_DEVICE_ID) return null;
  return content(before) !== content(after) ? before : null;
}

/** Fold a value the server reported into the replica, in place; the display follows unless an edit is pending. */
export function mergeRemote(rec: FacetRecord, value: FacetValue, deviceId: string): boolean {
  if (!isNewer(value, rec.known)) return false;
  rec.known = value;
  if (rec.pending_id === null) show(rec, value, deviceId);
  return true;
}

/** Show `value`, recording the notice when it replaces this device's value with another device's. */
export function show(rec: FacetRecord, value: FacetValue | null, deviceId: string): void {
  rec.overwritten = replacedMine(rec.value, value, deviceId) ?? rec.overwritten;
  rec.value = value;
  indexFacet(rec);
}
