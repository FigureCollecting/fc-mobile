// Acceptance for the whole harness: the real coordinator behind the edge,
// the production build behind nginx, and a device that signs in, enrols and
// reads through the entitlement path. Needs Docker and a built dist/.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_LEVELS } from '@figurecollecting/ingest-contract/entitlement';
import { stackClient, readStackState, type StackClient } from '../src/client.js';
import { loginDevice, type Device } from '../src/device.js';
import { USER_A, USER_B } from '../src/issuer.js';
import { REPO_ROOT } from '../src/paths.js';
import { optionsFromEnv, startStack, type Stack } from '../src/stack.js';
import { request } from './helpers.js';

const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-state-'));
const portBase = Number(process.env['FC_STACK_TEST_PORT_BASE'] ?? '18480');

interface CompareBody {
  resultJson: string;
  coverage?: { redacted?: string[]; semanticsRev?: string };
}

describe('local full stack', () => {
  let stack: Stack;
  let control: StackClient;
  let alice: Device;
  let gtin: string;

  const device = (loginHint: string): Promise<Device> =>
    loginDevice({
      origin: stack.state.origin,
      authorizationEndpoint: stack.state.issuer.authorizationEndpoint,
      tokenEndpoint: stack.state.issuer.tokenEndpoint,
      clientId: stack.state.issuer.clientId,
      loginHint,
    });
  const compare = (d: Device): Promise<{ status: number; body: unknown }> =>
    d.connect('coordinator.v1.CompareService', 'Compare', { gtin14: gtin, nowIso: new Date().toISOString() });

  beforeAll(async () => {
    stack = await startStack({ ...optionsFromEnv(), portBase, stateDir, log: () => undefined });
    control = stackClient(stack.state.controlUrl);
    gtin = stack.catalog.heads[0]!.identifiers.find((i) => i.idType === 'jan')!.gtin14!;
    alice = await device(USER_A.email);
  }, 600_000);
  afterAll(async () => {
    await stack?.stop();
  }, 120_000);

  it('routes /api/x to the coordinator: 401 carrying DPoP-Nonce', async () => {
    const reply = await request(`${stack.state.origin}/api/x`);
    expect(reply.status).toBe(401);
    expect(reply.headers['dpop-nonce']).toMatch(/.+/);
    expect(reply.headers['www-authenticate']).toMatch(/^DPoP/);
    const bare = await request(`${stack.state.origin}/api`);
    expect(bare.status).toBe(401);
    expect(bare.headers['dpop-nonce']).toMatch(/.+/);
  });

  it('routes / and deep links to the SPA served by nginx', async () => {
    const index = readFileSync(path.join(optionsFromEnv().webDist ?? path.join(REPO_ROOT, 'dist'), 'index.html'), 'utf8');
    const marker = /<title>[^<]*<\/title>/.exec(index)![0];
    for (const p of ['/', '/figure/123', '/discover', '/apix']) {
      const reply = await request(`${stack.state.origin}${p}`);
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toMatch(/text\/html/);
      expect(reply.headers['server']).toMatch(/nginx/);
      expect(reply.body).toContain(marker);
      expect(reply.headers['dpop-nonce']).toBeUndefined();
    }
  });

  it('writes a state file other processes can read, and pins the Postgres locale', async () => {
    expect(readStackState(stateDir)?.origin).toBe(stack.state.origin);
    const state = await control.state();
    expect(state.origin).toBe(`http://localhost:${portBase}`);
    expect(state.postgres.locale).toMatchObject({ collate: 'en_US.UTF-8', bytewise: false });
    expect(state.catalog.size).toBe(1200);
    expect(JSON.parse(readFileSync(state.catalog.file, 'utf8')).heads).toHaveLength(1200);
    expect(await stack.postgres.psql('SELECT count(*) FROM schema_migrations', 'migrator')).toMatch(/^[3-9]$|^\d{2,}$/);
  });

  it('signs a device in with PKCE, enrols it and reads the session', async () => {
    const enrol = await alice.enrol();
    expect(enrol.status).toBe(201);
    expect(alice.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    const session = await alice.call('GET', '/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ userId: USER_A.sub, deviceId: alice.deviceId, jkt: alice.jkt });
    expect(await stack.postgres.psql(`SELECT count(*) FROM device WHERE user_id = '${USER_A.sub}'`, 'migrator')).toBe('1');
  });

  it('delivers inventory to the entitled user through OpenFGA, the mint and the fake spine', async () => {
    await control.spine.clearCalls();
    const reply = await compare(alice);
    expect(reply.status).toBe(200);
    const body = reply.body as CompareBody;
    expect(body.coverage?.redacted ?? []).toEqual([]);
    expect(body.resultJson).toContain('"stockOnHand"');
    const [call] = await control.spine.calls();
    expect(call).toMatchObject({ method: 'compare', entitlementOutcome: 'granted', entitled: true, sub: USER_A.sub });
    expect(call?.wire).toBe(stack.state.coordinator.spineWire);
    expect((await control.openfga.calls()).at(-1)).toMatchObject({ user: `user:${USER_A.sub}`, allowed: true });
  });

  it('redacts inventory for a user without the tuple, as a normal 200', async () => {
    const bob = await device(USER_B.preferredUsername);
    expect((await bob.enrol()).status).toBe(201);
    const reply = await compare(bob);
    expect(reply.status).toBe(200);
    const body = reply.body as CompareBody;
    expect(body.coverage?.redacted).toEqual([INVENTORY_LEVELS]);
    expect(body.resultJson).not.toContain('stockOnHand');
  });

  it('recovers from a coordinator restart through one use_dpop_nonce retry', async () => {
    await control.coordinator.restart();
    const before = (await control.edge.log()).length;
    const reply = await alice.call('GET', '/api/auth/session');
    expect(reply.status).toBe(200);
    const statuses = (await control.edge.log()).slice(before).map((e) => e.status);
    expect(statuses).toEqual([401, 200]);
  });

  it('accepts the rotated access token and refuses the rotated-out refresh token', async () => {
    const old = alice.refreshToken!;
    await alice.refresh();
    expect(alice.refreshToken).not.toBe(old);
    expect((await alice.call('GET', '/api/auth/session')).status).toBe(200);
    const reuse = await request(stack.state.issuer.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: old, client_id: 'fc-coordinator' }).toString(),
    });
    expect(JSON.parse(reuse.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('drops a reply after the coordinator handled it', async () => {
    await control.spine.clearCalls();
    await control.edge.fault({ match: '^/api/coordinator\\.v1\\.CompareService/Compare$', action: 'drop-response' });
    await expect(compare(alice)).rejects.toThrow();
    expect(await control.spine.calls()).toHaveLength(1);
    expect((await compare(alice)).status).toBe(200);
  });

  it('takes the whole origin down for a true outage and brings it back', async () => {
    await control.edge.stop();
    await expect(request(`${stack.state.origin}/`)).rejects.toThrow(/ECONNREFUSED/);
    expect(await control.health()).toMatchObject({ edge: false });
    await control.edge.start();
    expect((await request(`${stack.state.origin}/`)).status).toBe(200);
  });

  it('survives the web container being replaced', async () => {
    await control.web.stop();
    expect((await request(`${stack.state.origin}/`)).status).toBe(502);
    await control.web.start();
    expect((await request(`${stack.state.origin}/`)).status).toBe(200);
  });

  it('removes the state file when it stops', async () => {
    await stack.stop();
    expect(existsSync(stack.stateFile)).toBe(false);
  });
});
