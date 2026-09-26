import { describe, expect, it } from 'vitest';
import { EmbeddedJWK, calculateJwkThumbprint, decodeProtectedHeader, jwtVerify } from 'jose';
import { base64url, createPkcePair, randomToken, sha256Base64url } from '../pkce';
import { ServerClock } from '../clock';
import { createDpopProof, dpopChallengeError } from '../dpop';
import { generateDeviceKey } from '../deviceKey';
import { oidcConfig, OIDC_SCOPE, postLogoutUriFor, redirectUriFor, configuredOidc } from '../config';
import { T0 } from './fakes';

describe('pkce', () => {
  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64url(new Uint8Array([]))).toBe('');
  });

  it('matches the RFC 7636 appendix B S256 vector', async () => {
    expect(await sha256Base64url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes a 43-char verifier from 32 random bytes and its S256 challenge', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await sha256Base64url(verifier));
    expect((await createPkcePair()).verifier).not.toBe(verifier);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('ServerClock', () => {
  it('is uncorrected until a Date header is seen', () => {
    const clock = new ServerClock(() => T0);
    expect(clock.known).toBe(false);
    expect(clock.offsetMs()).toBe(0);
    expect(clock.serverNow()).toBe(T0);
  });

  it('measures the offset at the midpoint of the round trip, from a whole-second Date', () => {
    let now = T0 + 90_000; // device runs 90 s fast
    const clock = new ServerClock(() => now);
    clock.observe(new Date(T0).toUTCString(), now - 100, now + 100);
    expect(clock.known).toBe(true);
    // The server second [T0, T0+1000) is taken at its middle.
    expect(clock.offsetMs()).toBe(-89_500);
    now += 1_000;
    expect(Math.abs(clock.serverNow() - (T0 + 1_000))).toBeLessThanOrEqual(1_000);
  });

  it('ignores a missing or unparseable Date header', () => {
    const clock = new ServerClock(() => T0);
    clock.observe(null, T0, T0);
    clock.observe('not a date', T0, T0);
    expect(clock.known).toBe(false);
  });
});

describe('device key', () => {
  it('is a non-extractable ES256 key whose public half is a bare EC JWK', async () => {
    const key = await generateDeviceKey('sub-1', T0);
    expect(key.privateKey.extractable).toBe(false);
    expect(key.privateKey.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow();
    expect(Object.keys(key.jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(key.jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(key.jkt).toBe(await calculateJwkThumbprint(key.jwk));
    expect(key).toMatchObject({ sub: 'sub-1', createdAt: T0 });
    expect(key.deviceId).toBeUndefined();
  });
});

describe('DPoP proof', () => {
  it('signs htm, htu, iat, jti, ath and nonce with the embedded public key', async () => {
    const key = await generateDeviceKey('sub-1', T0);
    const proof = await createDpopProof(key, {
      method: 'post',
      htu: 'https://app.test/api/auth/devices',
      iat: 1_790_000_000,
      accessToken: 'at-1',
      nonce: 'n-1',
    });
    const header = decodeProtectedHeader(proof);
    expect(header).toMatchObject({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.jwk });
    const { payload } = await jwtVerify(proof, EmbeddedJWK, { typ: 'dpop+jwt', algorithms: ['ES256'] });
    expect(payload).toMatchObject({
      htm: 'POST',
      htu: 'https://app.test/api/auth/devices',
      iat: 1_790_000_000,
      nonce: 'n-1',
      ath: await sha256Base64url('at-1'),
    });
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits nonce and ath when there are none, and never repeats a jti', async () => {
    const key = await generateDeviceKey('sub-1', T0);
    const claims = { method: 'GET', htu: 'https://app.test/api/x', iat: 1 };
    const a = await jwtVerify(await createDpopProof(key, claims), EmbeddedJWK);
    const b = await jwtVerify(await createDpopProof(key, claims), EmbeddedJWK);
    expect(a.payload).not.toHaveProperty('nonce');
    expect(a.payload).not.toHaveProperty('ath');
    expect(a.payload.jti).not.toBe(b.payload.jti);
  });

  it('reads the error code out of a DPoP WWW-Authenticate challenge', () => {
    expect(dpopChallengeError('DPoP error="use_dpop_nonce", error_description="x", algs="ES256"')).toBe('use_dpop_nonce');
    expect(dpopChallengeError('DPoP error="invalid_token"')).toBe('invalid_token');
    expect(dpopChallengeError('Bearer realm="x"')).toBeUndefined();
    expect(dpopChallengeError(null)).toBeUndefined();
  });
});

describe('OIDC config', () => {
  it('hardcodes the Authentik fc-coordinator layout, because discovery sends no CORS headers', () => {
    expect(oidcConfig()).toEqual({
      issuer: 'https://auth.mindsignals1.com/application/o/fc-coordinator/',
      clientId: 'fc-coordinator',
      authorizationEndpoint: 'https://auth.mindsignals1.com/application/o/authorize/',
      tokenEndpoint: 'https://auth.mindsignals1.com/application/o/token/',
      endSessionEndpoint: 'https://auth.mindsignals1.com/application/o/fc-coordinator/end-session/',
      scope: 'openid profile email offline_access',
    });
    expect(OIDC_SCOPE).toBe('openid profile email offline_access');
    expect(oidcConfig('http://127.0.0.1:8481').tokenEndpoint).toBe('http://127.0.0.1:8481/application/o/token/');
  });

  it('uses the production IdP unless the build names another', () => {
    expect(configuredOidc().issuer).toBe(
      import.meta.env.VITE_OIDC_ORIGIN ? `${import.meta.env.VITE_OIDC_ORIGIN}/application/o/fc-coordinator/` : oidcConfig().issuer,
    );
    expect(configuredOidc({ VITE_OIDC_ORIGIN: 'http://127.0.0.1:8481/' }).issuer).toBe(
      'http://127.0.0.1:8481/application/o/fc-coordinator/',
    );
    expect(configuredOidc({ VITE_OIDC_ORIGIN: '' }).issuer).toBe(oidcConfig().issuer);
  });

  it('derives the redirect and post-logout URIs from the page origin', () => {
    expect(redirectUriFor('http://localhost:8480')).toBe('http://localhost:8480/callback');
    expect(postLogoutUriFor('https://figurecollecting.com')).toBe('https://figurecollecting.com/');
  });
});
