// The spine's fc-entitlements verifier, ported rule for rule from fc-coordinator
// test/helpers/entitlementVerifier.ts. The fake SpineRead redacts by it, so a
// coordinator that stops minting shows up as redacted reads, as it would live.
import * as crypto from 'node:crypto';
import {
  ENTITLEMENT_ALG,
  ENTITLEMENT_AUDIENCE,
  ENTITLEMENT_CLOCK_SKEW_SECONDS,
  ENTITLEMENT_ISSUER,
  ENTITLEMENT_NAMES,
  ENTITLEMENT_TTL_SECONDS,
} from '@figurecollecting/ingest-contract/entitlement';

export type RejectReason =
  | 'absent'
  | 'oversized'
  | 'no_keys'
  | 'malformed'
  | 'unsupported_alg'
  | 'unsupported_crit'
  | 'unknown_kid'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'no_subject'
  | 'bad_lifetime'
  | 'expired'
  | 'not_yet_valid';

export interface VerifyResult {
  grants: ReadonlySet<string>;
  outcome: 'granted' | RejectReason;
  unknownNames: number;
  sub?: string;
}

export interface EntitlementKey {
  kid: string;
  privateKey: crypto.KeyObject;
  privatePem: string;
  keys: Map<string, crypto.KeyObject>;
}

export const MAX_HEADER_BYTES = 4096;

const RECOGNISED: ReadonlySet<string> = new Set<string>(ENTITLEMENT_NAMES);
const B64URL = /^[A-Za-z0-9_-]+$/;
const ED25519_SIGNATURE_BYTES = 64;
const NO_GRANTS: ReadonlySet<string> = new Set<string>();

export function generateEntitlementKey(kid = 'ent-stack'): EntitlementKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { kid, privateKey, privatePem, keys: new Map([[kid, publicKey]]) };
}

const deny = (outcome: RejectReason): VerifyResult => ({ grants: NO_GRANTS, outcome, unknownNames: 0 });

const decode = (segment: string): Buffer | undefined =>
  B64URL.test(segment) ? Buffer.from(segment, 'base64url') : undefined;

function asObject(buf: Buffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(buf.toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function verifyEntitlementHeader(
  raw: string | null | undefined,
  keys: ReadonlyMap<string, crypto.KeyObject>,
  nowMs: number = Date.now(),
): VerifyResult {
  if (raw === null || raw === undefined || raw.trim() === '') return deny('absent');
  if (Buffer.byteLength(raw, 'utf8') > MAX_HEADER_BYTES) return deny('oversized');
  if (keys.size === 0) return deny('no_keys');

  const parts = raw.split('.');
  if (parts.length !== 3) return deny('malformed');
  const [h64, p64, s64] = parts as [string, string, string];
  const headerBuf = decode(h64);
  const payloadBuf = decode(p64);
  const sig = decode(s64);
  if (headerBuf === undefined || payloadBuf === undefined || sig === undefined) return deny('malformed');
  if (sig.length !== ED25519_SIGNATURE_BYTES) return deny('malformed');

  const header = asObject(headerBuf);
  if (header === undefined) return deny('malformed');
  const kid = header['kid'];
  if (typeof kid !== 'string' || kid === '') return deny('malformed');
  if (header['alg'] !== ENTITLEMENT_ALG) return deny('unsupported_alg');
  if (header['crit'] !== undefined) return deny('unsupported_crit');

  const key = keys.get(kid);
  if (key === undefined) return deny('unknown_kid');
  if (!crypto.verify(null, Buffer.from(`${h64}.${p64}`), key, sig)) return deny('bad_signature');

  const claims = asObject(payloadBuf);
  if (claims === undefined) return deny('malformed');
  if (claims['iss'] !== ENTITLEMENT_ISSUER) return deny('wrong_issuer');
  if (claims['aud'] !== ENTITLEMENT_AUDIENCE) return deny('wrong_audience');
  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub.trim() === '') return deny('no_subject');

  const iat = claims['iat'];
  const exp = claims['exp'];
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return deny('malformed');
  const iatS = iat as number;
  const expS = exp as number;
  if (expS <= iatS || expS - iatS > ENTITLEMENT_TTL_SECONDS) return deny('bad_lifetime');

  const nowS = Math.floor(nowMs / 1000);
  if (nowS > expS + ENTITLEMENT_CLOCK_SKEW_SECONDS) return deny('expired');
  if (nowS < iatS - ENTITLEMENT_CLOCK_SKEW_SECONDS) return deny('not_yet_valid');

  const ent = claims['ent'];
  if (!Array.isArray(ent)) return deny('malformed');
  const grants = new Set<string>();
  let unknownNames = 0;
  for (const name of ent as unknown[]) {
    if (typeof name === 'string' && RECOGNISED.has(name)) grants.add(name);
    else unknownNames += 1;
  }
  return { grants, outcome: 'granted', unknownNames, sub };
}
