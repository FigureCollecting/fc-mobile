import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import {
  authorizeUrl,
  endSessionUrl,
  exchangeCode,
  IdTokenError,
  idTokenClaims,
  refreshGrant,
  TokenError,
} from '../oidc';
import { NetworkError } from '../errors';
import { oidcConfig } from '../config';
import { FakeIdp, FakeNet, IDP_ORIGIN, SUB_A, T0 } from './fakes';

const cfg = oidcConfig(IDP_ORIGIN);

describe('authorize URL', () => {
  it('asks for a code with PKCE S256, the full scope, state and nonce', () => {
    const url = new URL(
      authorizeUrl(cfg, {
        redirectUri: 'https://app.test/callback',
        state: 'st',
        challenge: 'ch',
        nonce: 'no',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(cfg.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'fc-coordinator',
      redirect_uri: 'https://app.test/callback',
      scope: 'openid profile email offline_access',
      state: 'st',
      nonce: 'no',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    const hinted = new URL(
      authorizeUrl(cfg, { redirectUri: 'https://app.test/callback', state: 's', challenge: 'c', nonce: 'n', loginHint: 'b@x' }),
    );
    expect(hinted.searchParams.get('login_hint')).toBe('b@x');
  });
});

describe('end-session URL', () => {
  it('names the registered post-logout URI exactly, with the id_token hint when there is one', () => {
    const url = new URL(endSessionUrl(cfg, { postLogoutRedirectUri: 'https://app.test/', idTokenHint: 'idt' }));
    expect(`${url.origin}${url.pathname}`).toBe(cfg.endSessionEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'fc-coordinator',
      post_logout_redirect_uri: 'https://app.test/',
      id_token_hint: 'idt',
    });
    expect(new URL(endSessionUrl(cfg, { postLogoutRedirectUri: 'https://app.test/' })).searchParams.has('id_token_hint')).toBe(
      false,
    );
  });
});

describe('token endpoint', () => {
  let idp: FakeIdp;
  let net: FakeNet;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    net = new FakeNet();
    net.route(IDP_ORIGIN, idp.handler);
  });

  const codeFor = async (verifier: string): Promise<string> => {
    const { sha256Base64url } = await import('../pkce');
    const cb = idp.authorize(
      authorizeUrl(cfg, { redirectUri: 'https://app.test/callback', state: 's', challenge: await sha256Base64url(verifier), nonce: 'n' }),
    );
    return new URL(cb).searchParams.get('code')!;
  };

  it('exchanges a code with its verifier, then refreshes with rotation', async () => {
    const verifier = 'v'.repeat(43);
    const tokens = await exchangeCode(cfg, net.fetch, {
      code: await codeFor(verifier),
      verifier,
      redirectUri: 'https://app.test/callback',
    });
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 600 });
    expect(tokens.refresh_token).toMatch(/^rt-/);
    const next = await refreshGrant(cfg, net.fetch, tokens.refresh_token!);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    const reuse = await refreshGrant(cfg, net.fetch, tokens.refresh_token!).catch((e: unknown) => e);
    expect(reuse).toBeInstanceOf(TokenError);
    expect(reuse).toMatchObject({ error: 'invalid_grant', status: 400 });
  });

  it('reports a wrong verifier as invalid_grant', async () => {
    const code = await codeFor('a'.repeat(43));
    await expect(
      exchangeCode(cfg, net.fetch, { code, verifier: 'b'.repeat(43), redirectUri: 'https://app.test/callback' }),
    ).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('turns a dropped connection into a NetworkError and a 5xx into a TokenError', async () => {
    net.offline = true;
    await expect(refreshGrant(cfg, net.fetch, 'rt-x')).rejects.toBeInstanceOf(NetworkError);
    net.offline = false;
    idp.failNextWith = 503;
    await expect(refreshGrant(cfg, net.fetch, 'rt-x')).rejects.toMatchObject({ error: 'server_error', status: 503 });
  });

  it('treats a non-JSON or tokenless reply as a server error', async () => {
    const html = async (): Promise<Response> => new Response('<html>', { status: 502 });
    await expect(refreshGrant(cfg, html, 'rt-x')).rejects.toMatchObject({ error: 'server_error', status: 502 });
    const empty = async (): Promise<Response> => Response.json({}, { status: 200 });
    await expect(refreshGrant(cfg, empty, 'rt-x')).rejects.toMatchObject({ error: 'server_error', status: 200 });
  });
});

describe('ID token claims', () => {
  let sign: (claims: Record<string, unknown>) => Promise<string>;
  const nowSeconds = Math.floor(T0 / 1000);

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair('RS256');
    sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
  });

  const good = { iss: cfg.issuer, aud: 'fc-coordinator', sub: SUB_A, exp: nowSeconds + 600, iat: nowSeconds, nonce: 'n' };

  it('returns the subject of a token for this client and this login', async () => {
    expect(idTokenClaims(cfg, await sign(good), { nonce: 'n', nowSeconds }).sub).toBe(SUB_A);
    expect(idTokenClaims(cfg, await sign({ ...good, aud: ['other', 'fc-coordinator'] }), { nowSeconds }).sub).toBe(SUB_A);
  });

  it.each([
    ['issuer', { iss: 'https://evil.test/' }],
    ['audience', { aud: 'other' }],
    ['audience list', { aud: ['other'] }],
    ['expiry', { exp: nowSeconds - 301 }],
    ['nonce', { nonce: 'other' }],
    ['subject', { sub: '' }],
  ])('refuses a wrong %s', async (_name, patch) => {
    expect(() => idTokenClaims(cfg, '', { nowSeconds })).toThrow(IdTokenError);
    const token = await sign({ ...good, ...patch });
    expect(() => idTokenClaims(cfg, token, { nonce: 'n', nowSeconds })).toThrow(IdTokenError);
  });

  it('tolerates a device clock within five minutes of the IdP', async () => {
    expect(idTokenClaims(cfg, await sign({ ...good, exp: nowSeconds - 299 }), { nowSeconds }).sub).toBe(SUB_A);
  });
});
