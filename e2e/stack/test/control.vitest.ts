import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stackClient, type StackClient } from '../src/client.js';
import { startControl, type Control, type ControlTarget } from '../src/control.js';
import type { FaultRule } from '../src/edge.js';
import type { Tuple } from '../src/openfga.js';
import { request } from './helpers.js';

function stubTarget() {
  const called: string[] = [];
  const faults: FaultRule[] = [];
  const tuples: Tuple[] = [];
  const settings = { accessTokenTtlSeconds: 600, offlineAccess: true, reuseRevokesFamily: false };
  let edgeUp = true;
  let coordinatorUp = true;
  const note = (name: string) => async (): Promise<void> => {
    called.push(name);
  };
  const target: ControlTarget = {
    state: { origin: 'http://localhost:1' },
    edge: {
      log: [{ at: 't', method: 'GET', path: '/', route: 'web', status: 200 }],
      running: () => edgeUp,
      stop: async () => {
        edgeUp = false;
        called.push('edge.stop');
      },
      start: async () => {
        edgeUp = true;
        called.push('edge.start');
      },
      addFault: (rule) => {
        if (rule.match === '(') throw new Error('Invalid regular expression');
        faults.push(rule);
      },
      clearFaults: () => {
        faults.length = 0;
      },
      faults: () => [...faults],
      releaseHung: () => called.push('edge.release'),
    },
    coordinator: {
      running: () => coordinatorUp,
      stop: async () => {
        coordinatorUp = false;
        called.push('coordinator.stop');
      },
      start: async () => {
        coordinatorUp = true;
        called.push('coordinator.start');
      },
      restart: note('coordinator.restart'),
    },
    web: { stop: note('web.stop') },
    startWeb: note('web.start'),
    issuer: {
      log: [{ at: 't', endpoint: 'token', outcome: 'ok' }],
      loginAs: (sub) => {
        if (sub === 'nobody') throw new Error('unknown user nobody');
        called.push(`loginAs:${sub}`);
      },
      revokeUser: () => 2,
      configure: (patch) => Object.assign(settings, patch),
      settings: () => ({ ...settings }),
    },
    spine: { calls: [{ method: 'getProducts', wire: 'h2c', protocol: 'grpc', entitlementOutcome: 'granted', entitled: true, at: 't' }] },
    openfga: {
      calls: [],
      tuples: () => [...tuples],
      write: (t) => tuples.push(t),
      remove: (t) => {
        const i = tuples.findIndex((x) => x.user === t.user);
        if (i >= 0) tuples.splice(i, 1);
      },
    },
    stop: note('stack.stop'),
  };
  return { target, called, faults };
}

describe('control API and client', () => {
  let control: Control;
  let client: StackClient;
  let stub: ReturnType<typeof stubTarget>;

  beforeAll(async () => {
    stub = stubTarget();
    control = await startControl(stub.target, 0);
    client = stackClient(control.url);
  });
  afterAll(async () => {
    await control.close();
  });
  beforeEach(() => {
    stub.called.length = 0;
  });

  it('reports state', async () => {
    expect(await client.state()).toEqual({ origin: 'http://localhost:1' });
  });

  it('stops and starts the edge, the coordinator and the web container', async () => {
    await client.edge.stop();
    await client.edge.start();
    await client.coordinator.stop();
    await client.coordinator.start();
    await client.coordinator.restart();
    await client.web.stop();
    await client.web.start();
    expect(stub.called).toEqual([
      'edge.stop', 'edge.start', 'coordinator.stop', 'coordinator.start', 'coordinator.restart', 'web.stop', 'web.start',
    ]);
    expect(await client.health()).toEqual({ edge: true, coordinator: true });
  });

  it('manages edge faults and reads the edge log', async () => {
    await client.edge.fault({ match: '^/api/', action: 'hang' });
    expect(await client.edge.faults()).toEqual([{ match: '^/api/', action: 'hang' }]);
    await client.edge.releaseHung();
    await client.edge.clearFaults();
    expect(await client.edge.faults()).toEqual([]);
    expect(stub.called).toContain('edge.release');
    expect((await client.edge.log())[0]).toMatchObject({ route: 'web' });
  });

  it('drives the issuer', async () => {
    await client.issuer.loginAs('22222222-2222-4222-8222-222222222222');
    expect(stub.called).toContain('loginAs:22222222-2222-4222-8222-222222222222');
    expect(await client.issuer.revokeUser('x')).toBe(2);
    expect(await client.issuer.configure({ accessTokenTtlSeconds: 5 })).toMatchObject({ accessTokenTtlSeconds: 5 });
    expect((await client.issuer.log())[0]).toMatchObject({ endpoint: 'token' });
  });

  it('reads and clears spine calls, and edits OpenFGA tuples', async () => {
    expect(await client.spine.calls()).toHaveLength(1);
    await client.spine.clearCalls();
    expect(await client.spine.calls()).toHaveLength(0);
    const t = { user: 'user:x', relation: 'inventory_levels', object: 'app:figurecollecting' };
    await client.openfga.write(t);
    expect(await client.openfga.tuples()).toEqual([t]);
    await client.openfga.remove(t);
    expect(await client.openfga.tuples()).toEqual([]);
    expect(await client.openfga.calls()).toEqual([]);
  });

  it('answers 400 for a bad request and 404 for an unknown route', async () => {
    await expect(client.issuer.loginAs('nobody')).rejects.toThrow(/400.*unknown user/);
    await expect(client.edge.fault({ match: '(', action: 'hang' })).rejects.toThrow(/400/);
    const bad = await request(`${control.url}/edge/faults`, { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
    expect((await request(`${control.url}/nope`)).status).toBe(404);
  });

  it('refuses a body over the size limit', async () => {
    const big = await request(`${control.url}/edge/faults`, { method: 'POST', body: 'x'.repeat(1_048_577) }).catch(
      (e: unknown) => e as Error,
    );
    expect(big instanceof Error ? big.message : String(big.status)).toMatch(/400|ECONNRESET|EPIPE|socket hang up/);
  });

  it('acknowledges shutdown before stopping the stack', async () => {
    await client.shutdown();
    await new Promise((r) => setTimeout(r, 50));
    expect(stub.called).toContain('stack.stop');
  });
});
