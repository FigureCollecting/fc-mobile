// Facet rows for the pure view tests, as the store would hold them (displayed value only).
import {
  collNameKey,
  occFacetKey,
  occOriginKey,
  occTagKey,
  tagNameKey,
  ufFacetKey,
  ufKindTagKey,
  ufTagKey,
  type CollectionKind,
} from '@figurecollecting/fc-api-contract';
import type { FacetRecord } from '../../storage/records';
import { indexFacet } from '../facetIndex';

export const STAMP = { edited_at: '2026-09-26T12:05:09.042-05:00', tz: 'America/Chicago' };

export const H = ['1b4e28ba-2fa1-11d2-883f-0016d3cca427', '6fa459ea-ee8a-3ca4-894e-db77e160355e', '886313e1-3b8a-5372-9b90-0c9aee199e5d'] as const;
// Occurrence ids in ascending byte order: O[0] < O[1] < O[2] < O[3].
export const O = [
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-00000000000a',
] as const;
export const C = ['c1000000-0000-4000-8000-0000000000c1', 'c2000000-0000-4000-8000-0000000000c2'] as const;
export const T = ['e1000000-0000-4000-8000-0000000000e1', 'e2000000-0000-4000-8000-0000000000e2', 'e3000000-0000-4000-8000-0000000000e3'] as const;

let n = 0;
const version = () => `2026-09-26T12:00:00.000000Z#${String(++n).padStart(10, '0')}#0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e`;

/** A row holding `fields` (plus the display stamp) as its value, or a tombstone for null. */
export function row(key: string, fields: Record<string, unknown> | null, opts: { raw?: string; stamp?: boolean } = {}): FacetRecord {
  const payload = fields === null ? '' : (opts.raw ?? JSON.stringify(opts.stamp === false ? fields : { ...fields, ...STAMP }));
  const value = { version: version(), op: fields === null ? ('delete' as const) : ('upsert' as const), payload };
  return indexFacet({ sub: 'user-a', facet_key: key, value, known: value, pending_id: null, overwritten: null });
}

/** A live copy: its head and status, and its filing when given. */
export function copy(occ: string, head: string | null, status: string | null, filing?: string): FacetRecord[] {
  const rows: FacetRecord[] = [];
  if (head !== null) rows.push(row(occFacetKey(occ, 'head'), { head_id: head }));
  rows.push(row(occFacetKey(occ, 'status'), status === null ? null : { status }));
  if (filing !== undefined) rows.push(row(occFacetKey(occ, 'collection'), { collection: filing }));
  return rows;
}

export const collection = (kind: CollectionKind, id: string, name: string | null) => row(collNameKey(kind, id), name === null ? null : { name });
export const tag = (id: string, name: string | null) => row(tagNameKey(id), name === null ? null : { name });
export const copyTag = (occ: string, t: string, on = true) => row(occTagKey(occ, t), on ? {} : null);
export const figureTag = (head: string, t: string, on = true) => row(ufTagKey(head, t), on ? {} : null);
export const kindTag = (head: string, kind: CollectionKind, t: string, on = true) => row(ufKindTagKey(head, kind, t), on ? {} : null);
export const note = (head: string, text: string | null) => row(ufFacetKey(head, 'note'), text === null ? null : { note: text });
export const origin = (occ: string, nativeId: string, ordinal: number) =>
  row(occOriginKey(occ), { site: 'mfc', native_id: nativeId, ordinal }, { stamp: false });
