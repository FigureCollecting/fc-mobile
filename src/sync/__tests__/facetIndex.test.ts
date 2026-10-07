import { describe, expect, it } from 'vitest';
import vectorsText from '@figurecollecting/fc-api-contract/golden/key-vectors.json?raw';
import type { FacetRecord } from '../../storage/records';
import { indexFacet } from '../facetIndex';
import { H, O, STAMP } from './viewFixtures';

interface KeyVectors {
  valid: { key: string; owner: 'user' | 'server'; parsed: Record<string, string> }[];
  invalid: { key: string }[];
}
const vectors = JSON.parse(vectorsText) as KeyVectors;

const bare = (key: string, payload?: string, op: 'upsert' | 'delete' = 'upsert'): FacetRecord => ({
  sub: 'user-a',
  facet_key: key,
  value: payload === undefined ? null : { version: '2026-09-26T12:00:00.000000Z', op, payload: op === 'delete' ? '' : payload },
  known: null,
  pending_id: null,
  overwritten: null,
});

describe('indexFacet agrees with the golden key vectors', () => {
  it.each(vectors.valid.map((v) => [v.key, v] as const))('%s', (key, v) => {
    const rec = indexFacet(bare(key));
    expect(rec.family).toBe(v.parsed.family);
    expect(rec.occ_id).toBe(v.parsed.occId);
    expect(rec.tag_id).toBe(v.parsed.tagId);
    if (v.parsed.family !== 'occ/head') expect(rec.head_id).toBe(v.parsed.headId);
  });

  it.each(vectors.invalid.map((v) => [v.key] as const))('stores %j with no family and no index', (key) => {
    const rec = indexFacet(bare(key, JSON.stringify({ status: 'owned', ...STAMP })));
    expect(rec.family).toBeUndefined();
    expect(rec.occ_id).toBeUndefined();
    expect(rec.head_id).toBeUndefined();
    expect(rec.tag_id).toBeUndefined();
    expect(rec.value).not.toBeNull();
  });

  it('covers user and server keys', () => {
    expect(new Set(vectors.valid.map((v) => v.owner))).toEqual(new Set(['user', 'server']));
  });
});

describe('indexFacet: head_id of a copy comes from its head facet', () => {
  const key = `occ/${O[0]}/head`;

  it('indexes the displayed head', () => {
    expect(indexFacet(bare(key, JSON.stringify({ head_id: H[1], ...STAMP }))).head_id).toBe(H[1]);
  });

  it('indexes nothing for a tombstoned, absent or unreadable head', () => {
    expect(indexFacet(bare(key, '', 'delete')).head_id).toBeUndefined();
    expect(indexFacet(bare(key)).head_id).toBeUndefined();
    expect('head_id' in indexFacet(bare(key, JSON.stringify({ head_id: 'nope', ...STAMP })))).toBe(false);
  });

  it('drops an index the new value no longer supports, and the v2 field property', () => {
    const rec = { ...bare(key, '', 'delete'), head_id: H[0], field: 'status', tag_id: 'stale' } as FacetRecord & { field?: string };
    const out = indexFacet(rec) as FacetRecord & { field?: string };
    expect(out.head_id).toBeUndefined();
    expect(out.tag_id).toBeUndefined();
    expect('field' in out).toBe(false);
    expect(out.occ_id).toBe(O[0]);
  });
});
