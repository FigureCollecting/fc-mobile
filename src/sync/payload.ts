// Facet payloads (sync.proto rule 6, PAYLOADS). The client checks a write
// against the contract's shipped JSON Schema before it mints, so the server's
// payload_invalid never drops an edit the user saw land, and it reads a stored
// payload through the same schema: one it cannot read (a kind, status or
// reason a later release added) is hidden, never guessed at.
import type { FacetFamily, UserFacetFamily } from '@figurecollecting/fc-api-contract';
import occHead from '@figurecollecting/fc-api-contract/schemas/occ-head.schema.json?raw';
import occStatus from '@figurecollecting/fc-api-contract/schemas/occ-status.schema.json?raw';
import occCollection from '@figurecollecting/fc-api-contract/schemas/occ-collection.schema.json?raw';
import occDisposal from '@figurecollecting/fc-api-contract/schemas/occ-disposal.schema.json?raw';
import occTag from '@figurecollecting/fc-api-contract/schemas/occ-tag.schema.json?raw';
import occOrigin from '@figurecollecting/fc-api-contract/schemas/occ-origin.schema.json?raw';
import ufScore from '@figurecollecting/fc-api-contract/schemas/uf-score.schema.json?raw';
import ufNote from '@figurecollecting/fc-api-contract/schemas/uf-note.schema.json?raw';
import ufWishability from '@figurecollecting/fc-api-contract/schemas/uf-wishability.schema.json?raw';
import ufTag from '@figurecollecting/fc-api-contract/schemas/uf-tag.schema.json?raw';
import ufKtag from '@figurecollecting/fc-api-contract/schemas/uf-ktag.schema.json?raw';
import collName from '@figurecollecting/fc-api-contract/schemas/coll-name.schema.json?raw';
import tagName from '@figurecollecting/fc-api-contract/schemas/tag-name.schema.json?raw';
import resAnswer from '@figurecollecting/fc-api-contract/schemas/res-answer.schema.json?raw';
import prefImport from '@figurecollecting/fc-api-contract/schemas/pref-import.schema.json?raw';
import { compileSchema, type Check } from './schemaCheck';

export class PayloadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadInvalidError';
  }
}

const USER: Record<UserFacetFamily, string> = {
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

const compile = (text: string): Check => compileSchema(JSON.parse(text));
const WRITE = new Map<string, Check>(Object.entries(USER).map(([family, text]) => [family, compile(text)]));
// The server-owned families a view reads; the import's items are read by the import screen.
const READ = new Map<string, Check>([...WRITE, ['occ/origin', compile(occOrigin)]]);

// Same grammar as the schemas' tz pattern, with its 64-character cap.
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
const TZ_MAX = 64;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The device's local wall time with its offset, e.g. 2026-09-26T12:05:09.042-05:00. Display only. */
export function formatEditedAt(at: Date): string {
  const offsetMin = -at.getTimezoneOffset();
  const local = new Date(at.getTime() + offsetMin * 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${local.toISOString().slice(0, 23)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const intlZone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The device's IANA zone, or UTC when the runtime reports none the schema accepts. */
export function deviceTimeZone(read: () => string | undefined = intlZone): string {
  const zone = read();
  return zone && zone.length <= TZ_MAX && TZ_RE.test(zone) ? zone : 'UTC';
}

/**
 * The UPSERT payload of a user-owned facet: `fields` plus edited_at and tz, as JSON text,
 * checked against the family's shipped schema. edited_at and tz are the store's to stamp.
 */
export function buildPayload(family: UserFacetFamily, fields: Record<string, unknown>, at: Date, tz: string): string {
  const check = WRITE.get(family);
  if (check === undefined) throw new PayloadInvalidError(`not a family a client writes: ${String(family)}`);
  if ('edited_at' in fields || 'tz' in fields) throw new PayloadInvalidError('edited_at and tz are stamped by the store');
  if (Number.isNaN(at.getTime())) throw new PayloadInvalidError('invalid edit time');
  const payload = { ...fields, edited_at: formatEditedAt(at), tz };
  const err = check(payload);
  if (err !== null) throw new PayloadInvalidError(`invalid ${family} payload: ${err}`);
  return JSON.stringify(payload);
}

/** A stored payload as its family's schema reads it, or undefined when this client cannot read it. */
export function readPayload(family: FacetFamily, text: string): Record<string, unknown> | undefined {
  const check = READ.get(family);
  if (check === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return check(value) === null ? (value as Record<string, unknown>) : undefined;
}
