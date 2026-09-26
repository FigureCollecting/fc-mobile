// The four user-owned facet payloads (sync.proto rule 6). The client checks a
// write before it mints, so the server's payload_invalid never drops an edit
// the user saw land. The bounds mirror the contract's shipped JSON Schemas.
import { HOLDING_STATUSES, type HoldingStatus, type UserFacetField } from '@figurecollecting/fc-api-contract';

export const COUNT_MIN = 1;
export const COUNT_MAX = 9999;
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const NOTE_MAX_CODE_POINTS = 10000;

export interface FieldValues {
  status: HoldingStatus;
  count: number;
  score: number;
  note: string;
}

export class PayloadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadInvalidError';
  }
}

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

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function checkValue(field: UserFacetField, value: unknown): void {
  const ok =
    field === 'status'
      ? (HOLDING_STATUSES as readonly unknown[]).includes(value)
      : field === 'count'
        ? isIntIn(value, COUNT_MIN, COUNT_MAX)
        : field === 'score'
          ? isIntIn(value, SCORE_MIN, SCORE_MAX)
          : field === 'note'
            ? typeof value === 'string' && [...value].length <= NOTE_MAX_CODE_POINTS
            : false;
  if (!ok) throw new PayloadInvalidError(`invalid ${String(field)}: ${JSON.stringify(value)?.slice(0, 80)}`);
}

/** The UPSERT payload for one field: the value plus edited_at and tz, as JSON text. */
export function buildPayload<F extends UserFacetField>(field: F, value: FieldValues[F], at: Date, tz: string): string {
  checkValue(field, value);
  if (Number.isNaN(at.getTime())) throw new PayloadInvalidError('invalid edit time');
  if (tz.length > TZ_MAX || !TZ_RE.test(tz)) throw new PayloadInvalidError(`invalid tz: ${tz}`);
  return JSON.stringify({ [field]: value, edited_at: formatEditedAt(at), tz });
}
