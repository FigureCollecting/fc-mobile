import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { startMockIssuer, USER_A, USER_B, type MockIssuer } from '../src/issuer.js';
import { form, request, type Reply } from './helpers.js';

const APP = 'http://localhost:8480';
const REDIRECT = `${APP}/callback`;
const verifier = (): string => randomBytes(32).toString('base64url');
const challengeOf = (v: string): string => createHash('sha256').update(v).digest('base64url');

let clock = Date.UTC(2026, 8, 26, 12, 0, 0);

describe('mock OIDC issuer', () => {
  let issuer: MockIssuer;

  beforeAll(async () => {
    issuer = await startMockIssuer({
      redirectUris: [REDIRECT, 'http://localhost:5173/callback'],
      allowedOrigins: [APP],
      now: () => clock,
    });
  });
  afterAll(async () => {
    await issuer.close();
  });
  beforeEach(() => {
    clock = Date.now();
    issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true, reuseRevokesFamily: false });
    issuer.loginAs(USER_A.sub);
  });

  const authorize = (params: Record<string, string>): Promise<Reply> =>
    request(`${issuer.authorizationEndpoint}?${new URLSearchParams(params).toString()}`);

  const goodParams = (v: string, extra: Record<string, string> = {}): Record<string, string> => ({
    response_type: 'code',
    client_id: 'fc-coordinator',
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    state: 'st-1',
    nonce: 'n-1',
    code_challenge: challengeOf(v),
    code_challenge_method: 'S256',
    ...extra,
  });

  const codeFrom = (reply: Reply): string => {
    expect(reply.status).toBe(302);
    const location = new URL(reply.headers.location!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('st-1');
    return location.searchParams.get('code')!;
  };

  const token = (fields: Record<string, string>, origin?: string): Promise<Reply> =>
    request(issuer.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
      body: form(fields),
    });

  async function login(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const v = verifier();
    const code = codeFrom(await authorize(goodParams(v, extra)));
    const reply = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: 'fc-coordinator',
      code_verifier: v,
    });
    expect(reply.status).toBe(200);
    return JSON.parse(reply.body) as Record<string, string>;
  }

  it('publishes discovery at the Authentik provider path, without CORS', async () => {
    const reply = await request(`${issuer.issuer}.well-known/openid-configuration`, { headers: { origin: APP } });
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    const doc = JSON.parse(reply.body) as Record<string, unknown>;
    expect(issuer.issuer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/application\/o\/fc-coordinator\/$/);
    expect(doc).toMatchObject({
      issuer: issuer.issuer,
      authorization_endpoint: issuer.authorizationEndpoint,
      token_endpoint: issuer.tokenEndpoint,
      jwks_uri: issuer.jwksUri,
      revocation_endpoint: issuer.revocationEndpoint,
      userinfo_endpoint: issuer.userinfoEndpoint,
      end_session_endpoint: issuer.endSessionEndpoint,
      code_challenge_methods_supported: ['S256'],
    });
    expect(issuer.authorizationEndpoint).toBe(`${issuer.origin}/application/o/authorize/`);
  });

  it('completes auth-code + PKCE S256 and mints tokens the published JWKS verifies', async () => {
    const tokens = await login();
    expect(tokens['token_type']).toBe('Bearer');
    expect(Number(tokens['expires_in'])).toBe(600);
    const jwks = createRemoteJWKSet(new URL(issuer.jwksUri));
    const access = await jwtVerify(tokens['access_token']!, jwks, { issuer: issuer.issuer, audience: 'fc-coordinator' });
    expect(access.payload.sub).toBe(USER_A.sub);
    expect(access.payload['scope']).toBe('openid profile email offline_access');
    expect(access.protectedHeader.alg).toBe('RS256');
    const id = await jwtVerify(tokens['id_token']!, jwks, { issuer: issuer.issuer, audience: 'fc-coordinator' });
    expect(id.payload).toMatchObject({ sub: USER_A.sub, nonce: 'n-1', email: USER_A.email });
    expect(typeof id.payload['at_hash']).toBe('string');
    expect(tokens['refresh_token']).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issuer.log.at(-1)).toMatchObject({ endpoint: 'token', grantType: 'authorization_code', outcome: 'ok', sub: USER_A.sub });
  });

  it('refuses a wrong code_verifier, a missing one, and a second use of the code', async () => {
    const v = verifier();
    const code = codeFrom(await authorize(goodParams(v)));
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'fc-coordinator' };
    const wrong = await token({ ...base, code_verifier: verifier() });
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.body)).toMatchObject({ error: 'invalid_grant' });
    expect(JSON.parse((await token({ ...base })).body)).toMatchObject({ error: 'invalid_request' });
    // The failed attempts did not burn the code; the right verifier still works once.
    expect((await token({ ...base, code_verifier: v })).status).toBe(200);
    const replay = await token({ ...base, code_verifier: v });
    expect(JSON.parse(replay.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('revokes the tokens a replayed code issued', async () => {
    const v = verifier();
    const code = codeFrom(await authorize(goodParams(v)));
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'fc-coordinator', code_verifier: v };
    const first = JSON.parse((await token(base)).body) as Record<string, string>;
    await token(base);
    const refresh = await token({ grant_type: 'refresh_token', refresh_token: first['refresh_token']!, client_id: 'fc-coordinator' });
    expect(JSON.parse(refresh.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses an expired code and a redirect_uri that differs from the authorize request', async () => {
    const v = verifier();
    const code = codeFrom(await authorize(goodParams(v)));
    const mismatch = await token({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:5173/callback', client_id: 'fc-coordinator', code_verifier: v });
    expect(JSON.parse(mismatch.body)).toMatchObject({ error: 'invalid_grant' });
    clock += 61_000;
    const late = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'fc-coordinator', code_verifier: v });
    expect(JSON.parse(late.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('insists on S256: plain, a missing challenge and a malformed one are refused', async () => {
    const v = verifier();
    const cases: Array<Record<string, string>> = [
      { code_challenge_method: 'plain', code_challenge: v },
      { code_challenge_method: '', code_challenge: '' },
      { code_challenge: 'short' },
    ];
    for (const extra of cases) {
      const reply = await authorize(goodParams(v, extra));
      expect(reply.status).toBe(302);
      const location = new URL(reply.headers.location!);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('code')).toBeNull();
    }
  });

  it('never redirects to an unregistered redirect_uri or for an unknown client', async () => {
    const v = verifier();
    const badRedirect = await authorize(goodParams(v, { redirect_uri: 'https://evil.example/callback' }));
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.location).toBeUndefined();
    const badClient = await authorize(goodParams(v, { client_id: 'someone-else' }));
    expect(badClient.status).toBe(400);
    expect(JSON.parse(badClient.body)).toMatchObject({ error: 'invalid_client' });
  });

  it('redirects errors for a bad response_type and a scope without openid', async () => {
    const v = verifier();
    const rt = new URL((await authorize(goodParams(v, { response_type: 'token' }))).headers.location!);
    expect(rt.searchParams.get('error')).toBe('unsupported_response_type');
    const scope = new URL((await authorize(goodParams(v, { scope: 'profile' }))).headers.location!);
    expect(scope.searchParams.get('error')).toBe('invalid_scope');
    const noState = await authorize({ ...goodParams(v), state: '' });
    expect(new URL(noState.headers.location!).searchParams.has('state')).toBe(false);
  });

  it('rotates refresh tokens and refuses the rotated-out one', async () => {
    const first = await login();
    const r1 = first['refresh_token']!;
    const rotated = await token({ grant_type: 'refresh_token', refresh_token: r1, client_id: 'fc-coordinator' });
    expect(rotated.status).toBe(200);
    const second = JSON.parse(rotated.body) as Record<string, string>;
    expect(second['refresh_token']).not.toBe(r1);
    expect(decodeJwt(second['access_token']!).sub).toBe(USER_A.sub);

    const reuse = await token({ grant_type: 'refresh_token', refresh_token: r1, client_id: 'fc-coordinator' });
    expect(reuse.status).toBe(400);
    expect(JSON.parse(reuse.body)).toMatchObject({ error: 'invalid_grant' });
    expect(issuer.log.at(-1)).toMatchObject({ grantType: 'refresh_token', outcome: 'invalid_grant', reason: 'rotated' });

    // Default: reuse is refused but the live successor keeps working.
    const next = await token({ grant_type: 'refresh_token', refresh_token: second['refresh_token']!, client_id: 'fc-coordinator' });
    expect(next.status).toBe(200);
  });

  it('can revoke the whole family on reuse (RFC 9700 strict mode)', async () => {
    issuer.configure({ reuseRevokesFamily: true });
    const first = await login();
    const second = JSON.parse(
      (await token({ grant_type: 'refresh_token', refresh_token: first['refresh_token']!, client_id: 'fc-coordinator' })).body,
    ) as Record<string, string>;
    await token({ grant_type: 'refresh_token', refresh_token: first['refresh_token']!, client_id: 'fc-coordinator' });
    const successor = await token({ grant_type: 'refresh_token', refresh_token: second['refresh_token']!, client_id: 'fc-coordinator' });
    expect(JSON.parse(successor.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses unknown and expired refresh tokens', async () => {
    expect(JSON.parse((await token({ grant_type: 'refresh_token', refresh_token: 'nope', client_id: 'fc-coordinator' })).body))
      .toMatchObject({ error: 'invalid_grant' });
    const t = await login();
    clock += 31 * 86_400_000;
    expect(JSON.parse((await token({ grant_type: 'refresh_token', refresh_token: t['refresh_token']!, client_id: 'fc-coordinator' })).body))
      .toMatchObject({ error: 'invalid_grant' });
  });

  it('issues no refresh token without offline_access, or when the provider withholds it', async () => {
    expect((await login({ scope: 'openid profile email' }))['refresh_token']).toBeUndefined();
    issuer.configure({ offlineAccess: false });
    expect((await login())['refresh_token']).toBeUndefined();
  });

  it('revokeUser ends every refresh family for that user', async () => {
    const t = await login();
    expect(issuer.revokeUser(USER_A.sub)).toBeGreaterThanOrEqual(1);
    const reply = await token({ grant_type: 'refresh_token', refresh_token: t['refresh_token']!, client_id: 'fc-coordinator' });
    expect(JSON.parse(reply.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('revokes through the RFC 7009 endpoint and answers 200 for anything', async () => {
    const t = await login();
    const revoke = (value: string): Promise<Reply> =>
      request(issuer.revocationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
        body: form({ token: value, client_id: 'fc-coordinator' }),
      });
    const reply = await revoke(t['refresh_token']!);
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBe(APP);
    expect((await revoke('unknown')).status).toBe(200);
    expect(JSON.parse((await token({ grant_type: 'refresh_token', refresh_token: t['refresh_token']!, client_id: 'fc-coordinator' })).body))
      .toMatchObject({ error: 'invalid_grant' });
  });

  it('selects the user by login_hint or by loginAs, and refuses an unknown hint', async () => {
    expect(decodeJwt((await login({ login_hint: USER_B.email }))['access_token']!).sub).toBe(USER_B.sub);
    issuer.loginAs(USER_B.sub);
    expect(decodeJwt((await login())['access_token']!).sub).toBe(USER_B.sub);
    const unknown = await authorize(goodParams(verifier(), { login_hint: 'nobody@example' }));
    expect(new URL(unknown.headers.location!).searchParams.get('error')).toBe('access_denied');
    expect(() => issuer.loginAs('not-a-user')).toThrow(/unknown user/);
    expect(issuer.users().map((u) => u.sub)).toEqual([USER_A.sub, USER_B.sub]);
  });

  it('honours a short access-token lifetime', async () => {
    issuer.configure({ accessTokenTtlSeconds: 2 });
    const t = await login();
    expect(Number(t['expires_in'])).toBe(2);
    const claims = decodeJwt(t['access_token']!);
    expect(claims.exp! - claims.iat!).toBe(2);
  });

  it('answers CORS for allowed origins only, including the preflight', async () => {
    const allowed = await token({ grant_type: 'nope', client_id: 'fc-coordinator' }, APP);
    expect(allowed.headers['access-control-allow-origin']).toBe(APP);
    expect(JSON.parse(allowed.body)).toMatchObject({ error: 'unsupported_grant_type' });
    const other = await token({ grant_type: 'nope', client_id: 'fc-coordinator' }, 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(issuer.tokenEndpoint, {
      method: 'OPTIONS',
      headers: { origin: APP, 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
  });

  it('refuses an unknown client at the token endpoint and a non-POST', async () => {
    const reply = await token({ grant_type: 'authorization_code', client_id: 'x' });
    expect(reply.status).toBe(401);
    expect(JSON.parse(reply.body)).toMatchObject({ error: 'invalid_client' });
    expect((await request(issuer.tokenEndpoint)).status).toBe(405);
  });

  it('serves userinfo for a valid access token only', async () => {
    const t = await login();
    const ok = await request(issuer.userinfoEndpoint, { headers: { authorization: `Bearer ${t['access_token']!}`, origin: APP } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ sub: USER_A.sub, email: USER_A.email });
    expect((await request(issuer.userinfoEndpoint, { headers: { authorization: 'Bearer junk' } })).status).toBe(401);
    expect((await request(issuer.userinfoEndpoint)).status).toBe(401);
  });

  it('ends the session back to a registered origin, and 404s unknown paths', async () => {
    const back = await request(`${issuer.endSessionEndpoint}?post_logout_redirect_uri=${encodeURIComponent(`${APP}/`)}`);
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe(`${APP}/`);
    const elsewhere = await request(`${issuer.endSessionEndpoint}?post_logout_redirect_uri=${encodeURIComponent('https://evil.example/')}`);
    expect(elsewhere.status).toBe(200);
    expect((await request(`${issuer.origin}/nothing`)).status).toBe(404);
  });
});
