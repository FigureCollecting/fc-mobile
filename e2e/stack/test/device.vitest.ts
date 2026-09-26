import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loginDevice } from '../src/device.js';
import { startMockIssuer, USER_B, type MockIssuer } from '../src/issuer.js';

interface Seen {
  path: string;
  status: number;
  proof: Record<string, unknown>;
  authorization: string | undefined;
}

describe('Node device (PKCE sign-in, DPoP proofs, nonce retry)', () => {
  let issuer: MockIssuer;
  let server: http.Server;
  let origin: string;
  let nonce = 'nonce-1';
  let enrolReturnsNull = false;
  const seen: Seen[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const proofHeader = req.headers['dpop'] as string;
      const proof = JSON.parse(Buffer.from(proofHeader.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
      const path = req.url as string;
      const reply = (status: number, body: string, type = 'application/json', extra: Record<string, string> = {}): void => {
        seen.push({ path, status, proof, authorization: req.headers.authorization });
        res.writeHead(status, { 'content-type': type, 'dpop-nonce': nonce, ...extra }).end(body);
      };
      if (path === '/api/plain-401') return reply(401, '{"error":"invalid_token"}', 'application/json', { 'www-authenticate': 'DPoP error="invalid_token"' });
      if (path === '/api/bare-401') return reply(401, '');
      if (enrolReturnsNull && path === '/api/auth/devices' && proof['nonce'] === nonce) return reply(201, 'null');
      if (proof['nonce'] !== nonce) {
        return reply(401, '{"error":"use_dpop_nonce"}', 'application/json', { 'www-authenticate': 'DPoP error="use_dpop_nonce"' });
      }
      if (path === '/api/auth/devices') return reply(201, JSON.stringify({ deviceId: '9d3c1f7e-0000-4000-8000-000000000001' }));
      if (path === '/api/text') return reply(200, 'hello', 'text/plain');
      return reply(200, JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    issuer = await startMockIssuer({ redirectUris: [`${origin}/callback`], allowedOrigins: [origin] });
  });
  afterAll(async () => {
    await issuer.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
  });

  const login = (extra: { loginHint?: string; scope?: string; tokenEndpoint?: string } = {}) =>
    loginDevice({
      origin,
      authorizationEndpoint: issuer.authorizationEndpoint,
      tokenEndpoint: extra.tokenEndpoint ?? issuer.tokenEndpoint,
      clientId: issuer.clientId,
      ...(extra.loginHint === undefined ? {} : { loginHint: extra.loginHint }),
      ...(extra.scope === undefined ? {} : { scope: extra.scope }),
    });

  it('signs in, retries once on use_dpop_nonce, and enrols', async () => {
    const device = await login({ loginHint: USER_B.email });
    expect(device.sub).toBe(USER_B.sub);
    expect(device.refreshToken).toBeDefined();
    const enrol = await device.enrol();
    expect(enrol.status).toBe(201);
    expect(device.deviceId).toBe('9d3c1f7e-0000-4000-8000-000000000001');
    expect(seen.map((s) => s.status)).toEqual([401, 201]);
    const proof = seen[1]!.proof;
    expect(proof).toMatchObject({ htm: 'POST', htu: `${origin}/api/auth/devices`, nonce: 'nonce-1' });
    expect(proof['ath']).toBe(createHash('sha256').update(device.accessToken).digest('base64url'));
    expect(seen[1]!.authorization).toBe(`DPoP ${device.accessToken}`);

    seen.length = 0;
    nonce = 'nonce-2';
    const connect = await device.connect('coordinator.v1.CompareService', 'Compare', { gtin14: '1' });
    expect(connect.status).toBe(200);
    expect(seen.map((s) => [s.path, s.status])).toEqual([
      ['/api/coordinator.v1.CompareService/Compare', 401],
      ['/api/coordinator.v1.CompareService/Compare', 200],
    ]);
    seen.length = 0;
    expect((await device.call('GET', '/api/ok')).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('returns a non-JSON body as text and does not retry a plain 401', async () => {
    const device = await login();
    expect((await device.call('GET', '/api/text')).body).toBe('hello');
    seen.length = 0;
    expect((await device.call('GET', '/api/plain-401')).status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it('keeps the device id unset when enrolment names none, and passes a bare 401 through', async () => {
    const device = await login();
    enrolReturnsNull = true;
    expect((await device.enrol('no id')).status).toBe(201);
    enrolReturnsNull = false;
    expect(device.deviceId).toBeUndefined();
    expect((await device.enrol('text')).status).toBe(201);
    seen.length = 0;
    expect((await device.call('GET', '/api/bare-401')).status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it('rotates on refresh and refuses to refresh without offline_access', async () => {
    const device = await login();
    const first = device.refreshToken;
    await device.refresh();
    expect(device.refreshToken).not.toBe(first);
    const noOffline = await login({ scope: 'openid profile email' });
    await expect(noOffline.refresh()).rejects.toThrow(/offline_access/);
  });

  it('fails clearly when authorize returns no code or the token call fails', async () => {
    await expect(login({ loginHint: 'nobody' })).rejects.toThrow(/did not return a code/);
    await expect(
      loginDevice({ origin, authorizationEndpoint: issuer.authorizationEndpoint, tokenEndpoint: issuer.tokenEndpoint, clientId: 'wrong' }),
    ).rejects.toThrow(/did not return a code/);
    await expect(login({ tokenEndpoint: `${issuer.origin}/application/o/nowhere/` })).rejects.toThrow(/token endpoint 404/);
  });
});
