import { describe, expect, it } from 'vitest';
import { Code, ConnectError, createClient, createContextValues } from '@connectrpc/connect';
import { CatalogService, CompareService, SyncOp, SyncService } from '@figurecollecting/fc-api-contract';
import { COORDINATOR_BASE_URL, createCoordinatorTransport } from '../transport';
import { LOCAL_DB_VERSION } from '../../storage/localDb';
import { World } from '../../auth/__tests__/world';
import { APP_ORIGIN } from '../../auth/__tests__/fakes';
import { kActionTrace, newTraceId } from '../../auth/trace';
import { inDiagIdsBuild } from '../../test/diagIdsBuild';

// LGMOB: these tests run as a build with diagnostic ids (VITE_DIAG_IDS=true).
inDiagIdsBuild();

const compare = (world: World, tab = world.tab()) => {
  const client = createClient(CompareService, createCoordinatorTransport(tab.fetch));
  return { tab, call: () => client.compare({ seed: { case: 'gtin14', value: '04580416940269' }, nowIso: '2026-09-26T12:00:00Z' }) };
};

describe('coordinator transport', () => {
  it('speaks Connect JSON under /api with DPoP on every call', async () => {
    expect(COORDINATOR_BASE_URL).toBe('/api');
    const world = await World.create();
    const { tab, call } = compare(world);
    await world.signIn(tab);
    const res = await call();
    expect(JSON.parse(res.resultJson)).toEqual({ gtin14: '04580416940269' });
    expect(res.coverage?.redacted).toEqual([]);
    expect(world.coord.log.at(-1)).toMatchObject({ path: '/api/coordinator.v1.CompareService/Compare', status: 200 });
  });

  it('pushes JSON, the wire format the origin_trace replay rule assumes (contract 0.7.0), with originTrace as a JSON field', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const client = createClient(SyncService, createCoordinatorTransport(tab.fetch));
    const originTrace = newTraceId();
    const from = world.net.sent.length;
    const event = { facetKey: 'uf/1b4e28ba-2fa1-11d2-883f-0016d3cca427/note', version: 'v', op: SyncOp.UPSERT, payload: '{}', basis: '' };
    // The fake edge answers 404 for Push: only what left the page matters here.
    await client.push({ clientId: 'b-1', events: [{ ...event, originTrace }, event] }).catch(() => undefined);
    const sent = world.net.sent.slice(from).filter((r) => r.url === `${APP_ORIGIN}/api/coordinator.v1.SyncService/Push`).at(-1)!;
    expect(sent.headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(await sent.text()) as { events: Record<string, unknown>[] };
    expect(body.events[0].originTrace).toBe(originTrace);
    expect('originTrace' in body.events[1]).toBe(false);
  });

  it('sends a W3C traceparent on every Connect call: a fresh trace each unscoped call, one trace per action', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const client = createClient(CompareService, createCoordinatorTransport(tab.fetch));
    const req = { seed: { case: 'gtin14' as const, value: '04580416940269' }, nowIso: '2026-09-26T12:00:00Z' };
    const from = world.net.sent.length;
    await client.compare(req);
    await client.compare(req);
    const action = newTraceId();
    await client.compare(req, { contextValues: createContextValues().set(kActionTrace, action) });
    await client.compare(req, { contextValues: createContextValues().set(kActionTrace, action) });
    const headers = world.net.sent.slice(from).map((s) => s.headers.get('traceparent'));
    expect(headers).toHaveLength(4);
    for (const h of headers) expect(h).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const [a, b, c, d] = headers.map((h) => h!.split('-'));
    expect(a![1]).not.toBe(b![1]);
    expect([c![1], d![1]]).toEqual([action, action]);
    expect(c![2]).not.toBe(d![2]);
    expect(world.net.sent.slice(from).every((s) => !s.headers.has('tracestate') && !s.headers.has('baggage'))).toBe(true);
  });

  it('retries a use_dpop_nonce silently after a coordinator restart', async () => {
    const world = await World.create();
    const { tab, call } = compare(world);
    await world.signIn(tab);
    world.coord.restart();
    const from = world.coord.log.length;
    await call();
    expect(world.statuses(from)).toEqual([401, 200]);
  });

  it('maps signed-out and a final 401 to Unauthenticated, and no network to Unavailable', async () => {
    const world = await World.create();
    const { tab, call } = compare(world);
    await expect(call()).rejects.toMatchObject({ code: Code.Unauthenticated });
    await world.signIn(tab);
    world.net.offline = true;
    const offline = await call().catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(ConnectError);
    expect(offline).toMatchObject({ code: Code.Unavailable });
    world.net.offline = false;
    world.idp.isValidAccess = () => false;
    await expect(call()).rejects.toMatchObject({ code: Code.Unauthenticated });
    expect(tab.status.value).toBe('reauth-required');
  });

  it('maps an enrolment the coordinator could not answer (5xx) to Unavailable', async () => {
    const world = await World.create();
    const handler = world.coord.handler;
    let enrolStatus = 502;
    world.net.route(APP_ORIGIN, async (req) =>
      new URL(req.url).pathname === '/api/auth/devices' ? new Response('Bad Gateway', { status: enrolStatus }) : handler(req),
    );
    const { tab, call } = compare(world);
    await world.signIn(tab);
    await expect(call()).rejects.toMatchObject({ code: Code.Unavailable });
    enrolStatus = 403;
    await expect(call()).rejects.toMatchObject({ code: Code.Unknown });
    world.net.route(APP_ORIGIN, handler);
    await expect(call()).resolves.toMatchObject({ coverage: { redacted: [] } });
  });

  it('maps a store a newer build took to FailedPrecondition, never Unknown with the raw VersionError', async () => {
    const world = await World.create();
    const { tab, call } = compare(world);
    await world.signIn(tab);
    (await new Promise<IDBDatabase>((resolve, reject) => {
      const req = world.factory.open('fc-mobile', LOCAL_DB_VERSION + 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })).close();
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect(err).toMatchObject({ code: Code.FailedPrecondition });
    expect((err as ConnectError).cause).toMatchObject({ name: 'ReloadRequiredError' });
    expect(tab.status.value).toBe('reload-required');
  });

  it('keeps a cancellation a cancellation', async () => {
    const world = await World.create();
    const { tab } = compare(world);
    await world.signIn(tab);
    const client = createClient(CompareService, createCoordinatorTransport(tab.fetch));
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.compare({ seed: { case: 'gtin14', value: '1' }, nowIso: 'x' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: Code.Canceled });
  });

  it('ends a call given a deadline that the coordinator never answers, through the DPoP fetch: DeadlineExceeded', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.net.hanging.add(APP_ORIGIN);
    const client = createClient(CatalogService, createCoordinatorTransport(tab.fetch));
    await expect(client.getProductImages({ headIds: ['h'] }, { timeoutMs: 20 })).rejects.toMatchObject({ code: Code.DeadlineExceeded });
  });

  it('passes through errors it does not own', async () => {
    const boom = new ConnectError('boom', Code.DataLoss);
    const client = createClient(
      CompareService,
      createCoordinatorTransport(async () => {
        throw boom;
      }),
    );
    await expect(client.compare({})).rejects.toMatchObject({ code: Code.DataLoss });
    const odd = createClient(
      CompareService,
      createCoordinatorTransport(async () => {
        throw new RangeError('odd');
      }),
    );
    await expect(odd.compare({})).rejects.toMatchObject({ code: Code.Unknown });
  });
});
