import { describe, expect, it } from 'vitest';
import { HOLDING_STATUSES } from '@figurecollecting/fc-api-contract';
import statusSchemaText from '@figurecollecting/fc-api-contract/schemas/holding-status.schema.json?raw';
import countSchemaText from '@figurecollecting/fc-api-contract/schemas/holding-count.schema.json?raw';
import scoreSchemaText from '@figurecollecting/fc-api-contract/schemas/uf-score.schema.json?raw';
import noteSchemaText from '@figurecollecting/fc-api-contract/schemas/uf-note.schema.json?raw';
import {
  COUNT_MAX,
  COUNT_MIN,
  NOTE_MAX_CODE_POINTS,
  PayloadInvalidError,
  SCORE_MAX,
  SCORE_MIN,
  buildPayload,
  deviceTimeZone,
  formatEditedAt,
} from '../payload';

interface Schema {
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, { enum?: string[]; minimum?: number; maximum?: number; maxLength?: number; pattern?: string }>;
}

const schemas = {
  status: JSON.parse(statusSchemaText) as Schema,
  count: JSON.parse(countSchemaText) as Schema,
  score: JSON.parse(scoreSchemaText) as Schema,
  note: JSON.parse(noteSchemaText) as Schema,
};

const AT = new Date(Date.UTC(2026, 8, 26, 17, 5, 9, 42));

describe('payload schema parity', () => {
  it('uses the bounds the shipped JSON Schemas declare', () => {
    expect([...HOLDING_STATUSES]).toEqual(schemas.status.properties.status.enum);
    expect(COUNT_MIN).toBe(schemas.count.properties.count.minimum);
    expect(COUNT_MAX).toBe(schemas.count.properties.count.maximum);
    expect(SCORE_MIN).toBe(schemas.score.properties.score.minimum);
    expect(SCORE_MAX).toBe(schemas.score.properties.score.maximum);
    expect(NOTE_MAX_CODE_POINTS).toBe(schemas.note.properties.note.maxLength);
  });

  it.each([
    ['status', 'wished'],
    ['count', 3],
    ['score', 9],
    ['note', 'boxed, shelf 2'],
  ] as const)('builds a %s payload with exactly the schema properties, all matching', (field, value) => {
    const schema = schemas[field];
    const payload = JSON.parse(buildPayload(field, value as never, AT, 'America/Chicago')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    expect(payload[field]).toBe(value);
    expect(payload.edited_at).toMatch(new RegExp(schema.properties.edited_at.pattern!));
    expect(payload.tz).toMatch(new RegExp(schema.properties.tz.pattern!));
  });
});

describe('formatEditedAt', () => {
  it('writes the device local time with its offset, which names the same instant', () => {
    const text = formatEditedAt(AT);
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(text).getTime()).toBe(AT.getTime());
    expect(text).toMatch(new RegExp(schemas.status.properties.edited_at.pattern!));
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
    ['status', 'sold'],
    ['count', 0],
    ['count', 10000],
    ['count', 1.5],
    ['score', 0],
    ['score', 11],
    ['score', Number.NaN],
    ['note', 'x'.repeat(10001)],
    ['note', 42],
  ] as const)('%s = %j', (field, value) => {
    expect(() => buildPayload(field, value as never, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('counts a note in code points, not UTF-16 units', () => {
    const emoji = '\u{1F600}'.repeat(NOTE_MAX_CODE_POINTS);
    expect(emoji.length).toBe(2 * NOTE_MAX_CODE_POINTS);
    expect(() => buildPayload('note', emoji, AT, 'UTC')).not.toThrow();
    expect(() => buildPayload('note', emoji + 'x', AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('refuses a field outside the four', () => {
    expect(() => buildPayload('price' as never, 1 as never, AT, 'UTC')).toThrow(PayloadInvalidError);
  });

  it('refuses an invalid edit time or zone', () => {
    expect(() => buildPayload('score', 5, new Date(Number.NaN), 'UTC')).toThrow(PayloadInvalidError);
    expect(() => buildPayload('score', 5, AT, 'bad zone')).toThrow(PayloadInvalidError);
  });
});
