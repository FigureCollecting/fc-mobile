// The derived fields of a facet row, from its key and its displayed value. Run on
// every write and on every local-store upgrade (sync.proto rule 6, READERS), so a
// later release's keys need no device migration: a key form this client does not
// know keeps no family and no index, and is stored, hidden and never counted.
import { parseServerFacetKey, parseUserFacetKey } from '@figurecollecting/fc-api-contract';
import type { FacetRecord } from '../storage/records';
import { readPayload } from './payload';

/** Set family, occ_id, head_id and tag_id on the row in place, dropping any that no longer hold. */
export function indexFacet(rec: FacetRecord): FacetRecord {
  const row = rec as FacetRecord & { field?: unknown };
  delete row.family;
  delete row.occ_id;
  delete row.head_id;
  delete row.tag_id;
  delete row.field; // v2's per-figure field
  const key = parseUserFacetKey(rec.facet_key) ?? parseServerFacetKey(rec.facet_key);
  if (key === undefined) return rec;
  const ids = key as { occId?: string; headId?: string; tagId?: string };
  rec.family = key.family;
  if (ids.occId !== undefined) rec.occ_id = ids.occId;
  if (ids.tagId !== undefined) rec.tag_id = ids.tagId;
  if (ids.headId !== undefined) rec.head_id = ids.headId;
  if (key.family === 'occ/head' && rec.value?.op === 'upsert') {
    const head = readPayload('occ/head', rec.value.payload)?.head_id as string | undefined;
    if (head !== undefined) rec.head_id = head;
  }
  return rec;
}
