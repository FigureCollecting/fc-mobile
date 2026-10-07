import { describe, expect, it } from 'vitest';
import { Code, ConnectError, createClient } from '@connectrpc/connect';
import { CompareService } from '@figurecollecting/fc-api-contract';
import { COORDINATOR_BASE_URL, createCoordinatorTransport } from '../transport';
import { World } from '../../auth/__tests__/world';
import { APP_ORIGIN } from '../../auth/__tests__/fakes';

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
      const req = world.factory.open('fc-mobile', 3);
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
