import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_AUDIENCE,
  ENTITLEMENT_ISSUER,
  INVENTORY_LEVELS,
} from '@figurecollecting/ingest-contract/entitlement';
import { generateEntitlementKey, MAX_HEADER_BYTES, verifyEntitlementHeader } from '../src/entitlement.js';

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const nowS = Math.floor(NOW / 1000);
const key = generateEntitlementKey('ent-test');

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'EdDSA', typ: 'JWT', kid: 'ent-test' },
  privateKey: crypto.KeyObject = key.privateKey,
): string {
  const h = b64(header);
  const p = b64(claims);
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: ENTITLEMENT_ISSUER,
  aud: ENTITLEMENT_AUDIENCE,
  sub: '11111111-1111-4111-8111-111111111111',
  ent: [INVENTORY_LEVELS],
  iat: nowS,
  exp: nowS + 60,
  kid: 'ent-test',
  ...over,
});

describe('entitlement assertion verifier (port of the spine rules)', () => {
  it('generates an Ed25519 PKCS#8 key with a kid', () => {
    expect(key.kid).toBe('ent-test');
    expect(key.privatePem).toContain('BEGIN PRIVATE KEY');
    expect(key.keys.get('ent-test')?.asymmetricKeyType).toBe('ed25519');
  });

  it('grants a valid assertion and counts unknown names', () => {
    const result = verifyEntitlementHeader(sign(good({ ent: [INVENTORY_LEVELS, 'future_thing', 7] })), key.keys, NOW);
    expect(result.outcome).toBe('granted');
    expect([...result.grants]).toEqual([INVENTORY_LEVELS]);
    expect(result.unknownNames).toBe(2);
    expect(result.sub).toBe('11111111-1111-4111-8111-111111111111');
  });

  it.each([
    ['absent', null],
    ['absent', '   '],
    ['oversized', 'x'.repeat(MAX_HEADER_BYTES + 1)],
    ['malformed', 'a.b'],
    ['malformed', 'a!.b.c'],
  ])('refuses %s input', (outcome, raw) => {
    expect(verifyEntitlementHeader(raw, key.keys, NOW).outcome).toBe(outcome);
  });

  it('refuses when no keys are configured', () => {
    expect(verifyEntitlementHeader(sign(good()), new Map(), NOW).outcome).toBe('no_keys');
  });

  it('refuses a short signature, a non-object header and a missing kid', () => {
    const [h, p] = sign(good()).split('.');
    expect(verifyEntitlementHeader(`${h}.${p}.AAAA`, key.keys, NOW).outcome).toBe('malformed');
    const sig64 = Buffer.alloc(64).toString('base64url');
    expect(verifyEntitlementHeader(`${b64([1])}.${p}.${sig64}`, key.keys, NOW).outcome).toBe('malformed');
    expect(verifyEntitlementHeader(`${Buffer.from('{').toString('base64url')}.${p}.${sig64}`, key.keys, NOW).outcome).toBe('malformed');
    expect(verifyEntitlementHeader(sign(good(), { alg: 'EdDSA' }), key.keys, NOW).outcome).toBe('malformed');
  });

  it('refuses the wrong alg, a crit header and an unknown kid', () => {
    expect(verifyEntitlementHeader(sign(good(), { alg: 'ES256', kid: 'ent-test' }), key.keys, NOW).outcome).toBe('unsupported_alg');
    expect(verifyEntitlementHeader(sign(good(), { alg: 'EdDSA', kid: 'ent-test', crit: ['x'] }), key.keys, NOW).outcome).toBe('unsupported_crit');
    expect(verifyEntitlementHeader(sign(good(), { alg: 'EdDSA', kid: 'other' }), key.keys, NOW).outcome).toBe('unknown_kid');
  });

  it('refuses a signature from another key', () => {
    const other = generateEntitlementKey('ent-test');
    expect(verifyEntitlementHeader(sign(good(), undefined, other.privateKey), key.keys, NOW).outcome).toBe('bad_signature');
  });

  it('refuses a non-object payload', () => {
    const h = b64({ alg: 'EdDSA', kid: 'ent-test' });
    const p = Buffer.from('[1]').toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
    expect(verifyEntitlementHeader(`${h}.${p}.${sig}`, key.keys, NOW).outcome).toBe('malformed');
  });

  it.each([
    ['wrong_issuer', { iss: 'someone-else' }],
    ['wrong_audience', { aud: 'spine-write' }],
    ['no_subject', { sub: ' ' }],
    ['malformed', { iat: 'soon' }],
    ['bad_lifetime', { exp: nowS }],
    ['bad_lifetime', { exp: nowS + 61 }],
    ['expired', { iat: nowS - 200, exp: nowS - 150 }],
    ['not_yet_valid', { iat: nowS + 100, exp: nowS + 150 }],
    ['malformed', { ent: 'inventory_levels' }],
  ])('refuses %s claims', (outcome, over) => {
    expect(verifyEntitlementHeader(sign(good(over)), key.keys, NOW).outcome).toBe(outcome);
  });

  it('defaults the clock to now', () => {
    const live = Math.floor(Date.now() / 1000);
    expect(verifyEntitlementHeader(sign(good({ iat: live, exp: live + 60 })), key.keys).outcome).toBe('granted');
  });
});
