import { describe, expect, it } from 'vitest';
import { USER_FACET_FAMILIES, USER_FACET_PAYLOAD_SCHEMAS, type UserFacetFamily } from '@figurecollecting/fc-api-contract';
import occHead from '@figurecollecting/fc-api-contract/schemas/occ-head.schema.json?raw';
import occStatus from '@figurecollecting/fc-api-contract/schemas/occ-status.schema.json?raw';
import occCollection from '@figurecollecting/fc-api-contract/schemas/occ-collection.schema.json?raw';
import occDisposal from '@figurecollecting/fc-api-contract/schemas/occ-disposal.schema.json?raw';
import occTag from '@figurecollecting/fc-api-contract/schemas/occ-tag.schema.json?raw';
import ufScore from '@figurecollecting/fc-api-contract/schemas/uf-score.schema.json?raw';
import ufNote from '@figurecollecting/fc-api-contract/schemas/uf-note.schema.json?raw';
import ufWishability from '@figurecollecting/fc-api-contract/schemas/uf-wishability.schema.json?raw';
import ufTag from '@figurecollecting/fc-api-contract/schemas/uf-tag.schema.json?raw';
import ufKtag from '@figurecollecting/fc-api-contract/schemas/uf-ktag.schema.json?raw';
import collName from '@figurecollecting/fc-api-contract/schemas/coll-name.schema.json?raw';
import tagName from '@figurecollecting/fc-api-contract/schemas/tag-name.schema.json?raw';
import resAnswer from '@figurecollecting/fc-api-contract/schemas/res-answer.schema.json?raw';
import prefImport from '@figurecollecting/fc-api-contract/schemas/pref-import.schema.json?raw';
import { compileSchema } from '../schemaCheck';
import { PayloadInvalidError, buildPayload, deviceTimeZone, formatEditedAt, readPayload } from '../payload';

// The shipped schemas, read here independently of the module under test.
const SHIPPED: Record<UserFacetFamily, string> = {
  'occ/head': occHead,
  'occ/status': occStatus,
  'occ/collection': occCollection,
  'occ/disposal': occDisposal,
  'occ/tag': occTag,
  'uf/score': ufScore,
  'uf/note': ufNote,
  'uf/wishability': ufWishability,
  'uf/tag': ufTag,
  'uf/ktag': ufKtag,
  'coll/name': collName,
  'tag/name': tagName,
  'res/answer': resAnswer,
  'pref/import': prefImport,
};
const EDITED_AT_PATTERN = (JSON.parse(occStatus) as { properties: { edited_at: { pattern: string } } }).properties.edited_at.pattern;

const AT = new Date(Date.UTC(2026, 8, 26, 17, 5, 9, 42));
const OCC = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';
const HEAD = '5b0c7c7e-2f1d-4c1e-9a1b-3c4d5e6f7a8b';

const SAMPLES: Record<UserFacetFamily, Record<string, unknown>> = {
  'occ/head': { head_id: HEAD },
  'occ/status': { status: 'former' },
  'occ/collection': { collection: `owned/${OCC}` },
  'occ/disposal': { reason: 'sold', on: '2026-09-30', note: 'to a friend', counterparty: 'K', price: { amount: '120.50', currency: 'USD' } },
  'occ/tag': {},
  'uf/score': { score: 9 },
  'uf/note': { note: 'boxed, shelf 2' },
  'uf/wishability': { wishability: 5 },
  'uf/tag': {},
  'uf/ktag': {},
  'coll/name': { name: 'Shelf 2' },
  'tag/name': { name: 'red' },
  'res/answer': { item: 'figure', rev: '3:7', choice: 'per_copy', copies: [{ occ: OCC, status: 'removed' }], fields: { note: 'app' } },
  'pref/import': { import_policy: 'FAVOR_APP', disposition_list: '206369' },
};

describe('payload schema parity', () => {
  it('covers every user-owned family the contract names', () => {
    expect(Object.keys(SHIPPED).sort()).toEqual([...USER_FACET_FAMILIES].sort());
    expect(Object.keys(USER_FACET_PAYLOAD_SCHEMAS).sort()).toEqual([...USER_FACET_FAMILIES].sort());
  });

  it.each([...USER_FACET_FAMILIES])('builds a %s payload the shipped schema accepts, carrying edited_at and tz', (family) => {
    const text = buildPayload(family, SAMPLES[family], AT, 'America/Chicago');
    const payload = JSON.parse(text) as Record<string, unknown>;
    expect(compileSchema(JSON.parse(SHIPPED[family]))(payload)).toBeNull();
    expect(payload).toEqual({ ...SAMPLES[family], edited_at: formatEditedAt(AT), tz: 'America/Chicago' });
    expect(readPayload(family, text)).toEqual(payload);
  });
});

describe('formatEditedAt', () => {
  it('writes the device local time with its offset, which names the same instant', () => {
    const text = formatEditedAt(AT);
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(text).getTime()).toBe(AT.getTime());
    expect(text).toMatch(new RegExp(EDITED_AT_PATTERN));
  });

  it.each([
    [-330, '+05:30'],
    [300, '-05:00'],
    [0, '+00:00'],
  ])('spells a timezone offset of %i minutes as %s', (tzOffset, spelled) => {
    const at = new Date(AT);
    at.getTimezoneOffset = () => tzOffset;
    expect(formatEditedAt(at).endsWith(spelled)).toBe(true);
  });
});

describe('deviceTimeZone', () => {
  it('uses the IANA zone the runtime reports', () => {
    expect(deviceTimeZone(() => 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it.each([undefined, '', 'not a zone!', 'x'.repeat(65)])('falls back to UTC for %j', (reported) => {
    expect(deviceTimeZone(() => reported)).toBe('UTC');
  });

  it('reads Intl by default', () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  });
});

describe('buildPayload refuses what the server would reject as payload_invalid', () => {
  it.each([
    ['occ/status', { status: 'sold' }],
    ['occ/status', { status: 'owned', count: 2 }],
    ['occ/head', { head_id: HEAD.toUpperCase() }],
    ['occ/head', {}],
    ['occ/collection', { collection: 'custom/default' }],
    ['occ/collection', { collection: 'owned' }],
    ['occ/disposal', { reason: 'burnt' }],
    ['occ/disposal', { reason: 'sold', price: { amount: 120, currency: 'USD' } }],
    ['occ/disposal', { reason: 'sold', note: '' }],
    ['occ/tag', { colour: 'red' }],
    ['uf/score', { score: 0 }],
    ['uf/score', { score: 11 }],
    ['uf/score', { score: 1.5 }],
    ['uf/score', { score: Number.NaN }],
    ['uf/wishability', { wishability: 0 }],
    ['uf/wishability', { wishability: 6 }],
    ['uf/note', { note: 'x'.repeat(10001) }],
    ['uf/note', { note: 42 }],
    ['coll/name', { name: '' }],
    ['tag/name', { name: 'x'.repeat(101) }],
    ['res/answer', { item: 'figure', rev: '1', choice: 'per_copy' }],
    ['res/answer', { item: 'figure', rev: '1', choice: 'keep', copies: [] }],
    ['pref/import', { import_policy: 'ALWAYS' }],
  ] as const)('%s %j', (family, fields) => {
    expect(() => buildPayload(family, fields as Record<string, unknown>, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])('refuses an extra %s on write and on read', (name) => {
    const fields = JSON.parse(`{"head_id":"${HEAD}","${name}":"x"}`) as Record<string, unknown>;
    expect(() => buildPayload('occ/head', fields, AT, 'UTC')).toThrow(PayloadInvalidError);
    const stored = JSON.stringify({ head_id: HEAD, edited_at: '2026-09-26T12:05:09.042-05:00', tz: 'America/Chicago' });
    expect(readPayload('occ/head', stored)).toBeDefined();
    expect(readPayload('occ/head', `${stored.slice(0, -1)},"${name}":"x"}`)).toBeUndefined();
  });

  it('counts a note in code points, not UTF-16 units', () => {
    const emoji = '\u{1F600}'.repeat(10000);
    expect(emoji.length).toBe(20000);
    expect(() => buildPayload('uf/note', { note: emoji }, AT, 'UTC')).not.toThrow();
    expect(() => buildPayload('uf/note', { note: emoji + 'x' }, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('refuses a family no client may write', () => {
    expect(() => buildPayload('occ/origin' as never, { site: 'mfc', native_id: '1', ordinal: 1 }, AT, 'UTC')).toThrow(PayloadInvalidError);
    expect(() => buildPayload('holding/status' as never, { status: 'owned' }, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('stamps edited_at and tz itself and refuses them from the caller', () => {
    expect(() => buildPayload('uf/score', { score: 5, edited_at: '2026-01-01T00:00:00Z' }, AT, 'UTC')).toThrow(PayloadInvalidError);
    expect(() => buildPayload('uf/score', { score: 5, tz: 'UTC' }, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('refuses an invalid edit time or zone', () => {
    expect(() => buildPayload('uf/score', { score: 5 }, new Date(Number.NaN), 'UTC')).toThrow(PayloadInvalidError);
    expect(() => buildPayload('uf/score', { score: 5 }, AT, 'bad zone')).toThrow(PayloadInvalidError);
    expect(() => buildPayload('uf/score', { score: 5 }, AT, 'x'.repeat(65))).toThrow(PayloadInvalidError);
  });
});

describe('readPayload hides what this client cannot read', () => {
  const stamp = { edited_at: '2026-09-26T12:05:09.042-05:00', tz: 'America/Chicago' };

  it('reads a server-owned origin', () => {
    const origin = { site: 'mfc', native_id: '1144', ordinal: 2 };
    expect(readPayload('occ/origin', JSON.stringify(origin))).toEqual(origin);
  });

  it.each([
    ['occ/status', JSON.stringify({ status: 'lent', ...stamp }), 'a status a later release added'],
    ['occ/collection', JSON.stringify({ collection: 'lent/default', ...stamp }), 'a kind a later release added'],
    ['occ/disposal', JSON.stringify({ reason: 'recycled', ...stamp }), 'a reason a later release added'],
    ['uf/score', '{not json', 'text that is not JSON'],
    ['uf/score', '', 'an empty payload'],
    ['uf/score', 'null', 'JSON null'],
    ['occ/head', JSON.stringify({ head_id: HEAD }), 'a payload missing edited_at'],
  ] as const)('%s: %s', (family, text, _why) => {
    expect(readPayload(family, text)).toBeUndefined();
  });

  it('refuses a family it does not know', () => {
    expect(readPayload('occ/lent' as never, JSON.stringify(stamp))).toBeUndefined();
  });
});
