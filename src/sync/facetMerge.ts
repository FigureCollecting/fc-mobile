// The per-facet LWW rule (sync.proto rule 5): a value replaces the local one
// only when its version is greater, compared bytewise through compareVersion.
// Pure, so it is the same whatever order or how often events arrive.
import {
  SyncOp,
  compareVersion,
  isCanonicalVersion,
  parseUserFacetKey,
  type SyncEvent,
} from '@figurecollecting/fc-api-contract';
import type { FacetRecord, FacetValue } from '../storage/records';

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

export function emptyFacet(sub: string, facetKey: string): FacetRecord {
  const user = parseUserFacetKey(facetKey);
  return {
    sub,
    facet_key: facetKey,
    ...(user && { head_id: user.headId, field: user.field }),
    value: null,
    known: null,
    pending_id: null,
    overwritten: null,
  };
}

export interface MergeResult {
  applied: boolean;
  /** The unanswered local edit the value replaced; its outbox entries are superseded. */
  superseded: boolean;
}

/** Fold a value the server reported into the record, in place. */
export function mergeRemote(rec: FacetRecord, value: FacetValue): MergeResult {
  if (isNewer(value, rec.known)) rec.known = value;
  if (!isNewer(value, rec.value)) return { applied: false, superseded: false };
  const superseded = rec.pending_id !== null;
  if (superseded) {
    rec.overwritten = rec.value;
    rec.pending_id = null;
  }
  rec.value = value;
  return { applied: true, superseded };
}
