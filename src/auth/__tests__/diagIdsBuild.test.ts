// LGMOB: a build without VITE_DIAG_IDS=true (every committed env file, the web image) sends no diagnostic id and
// keeps no choice, whatever this device stored under an earlier build. On (VITE_DIAG_IDS=true) is the behaviour the
// LGMOB suites pin: trace.test.ts, dpopFetch.test.ts, diagIds.test.ts, the sync suites and Settings.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBinary } from '@bufbuild/protobuf';
import { createClient, createContextValues } from '@connectrpc/connect';
import { CompareService, PushRequestSchema, SyncService, isTraceId, type PushRequest } from '@figurecollecting/fc-api-contract';
import { createCoordinatorTransport } from '../../api/transport';
import type { UserStore } from '../../storage/userStore';
import { rig } from '../../sync/__tests__/engineSupport';
import { HEAD, T0, freshDb, openStore, status, write } from '../../sync/__tests__/harness';
import { DIAG_IDS_CLEAR_KEY, DIAG_IDS_KEY, diagIdsClearPending, diagIdsOn, diagIdsSaved, setDiagIds } from '../diagIds';
import { originTracesMayLeave } from '../originTraceGate';
import { addTraceHeader, dropTraceIfOff, kActionTrace, newTraceId, traceInterceptor } from '../trace';
import { APP_ORIGIN } from './fakes';
import { World } from './world';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const PUSH_PATH = '/api/coordinator.v1.SyncService/Push';
const COMPARE = { seed: { case: 'gtin14' as const, value: '04580416940269' }, nowIso: '2026-09-26T12:00:00Z' };

const build = (on: boolean) => vi.stubEnv('VITE_DIAG_IDS', on ? 'true' : undefined);

beforeEach(() => build(false));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function send(store: UserStore) {
  const next = await store.nextBatch();
  if (next.kind !== 'send') throw new Error(`expected a batch, got ${next.kind}`);
  return next.batch;
}

describe('the switch in a build without VITE_DIAG_IDS', () => {
  it('is off with nothing stored, with on stored, and when storage cannot be read', () => {
    expect(diagIdsOn()).toBe(false);
    localStorage.setItem(DIAG_IDS_KEY, 'on');
    expect(diagIdsOn()).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(diagIdsOn()).toBe(false);
    expect(originTracesMayLeave()).toBe(false);
  });

  it('writes nothing for a choice: neither fc-diag-ids nor the clear marker', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    setDiagIds(false);
    setDiagIds(true);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect([DIAG_IDS_KEY, DIAG_IDS_CLEAR_KEY].map((k) => localStorage.getItem(k))).toEqual([null, null]);
    expect(diagIdsOn()).toBe(false);
    expect(diagIdsSaved()).toBe(true);
    expect(diagIdsClearPending()).toBeUndefined();
  });

  it("keeps an earlier build's off and its owed clear as they were, so a build with ids still honours them", () => {
    localStorage.setItem(DIAG_IDS_KEY, 'off');
    localStorage.setItem(DIAG_IDS_CLEAR_KEY, 'mark-1');
    setDiagIds(true);
    expect(localStorage.getItem(DIAG_IDS_KEY)).toBe('off');
    expect(diagIdsClearPending()).toBe('mark-1');
    build(true);
    expect(diagIdsOn()).toBe(false);
  });

  it('a build with ids reads the same storage as before: on with nothing stored', () => {
    build(true);
    expect(diagIdsOn()).toBe(true);
    expect(originTracesMayLeave()).toBe(true);
  });
});

describe('no traceparent from any of the three senders, on real request paths', () => {
  const given = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

  // The enrolment (with its use_dpop_nonce retry) and plain /api calls take addTraceHeader through dpopFetch;
  // Connect calls take the interceptor, unscoped and on an action's trace; a restart makes dpopFetch retry one
  // attempt on the same headers; and dpopFetch drops a traceparent its caller set, attempt by attempt.
  async function everySender() {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const client = createClient(CompareService, createCoordinatorTransport(tab.fetch));
    await client.compare(COMPARE);
    await client.compare(COMPARE, { contextValues: createContextValues().set(kActionTrace, newTraceId()) });
    world.coord.restart();
    await client.compare(COMPARE);
    await tab.fetch('/api/auth/session');
    await tab.fetch('/api/auth/session', { headers: { traceparent: given } });
    const api = world.net.sent.filter((r) => new URL(r.url).origin === APP_ORIGIN);
    expect(api.map((r) => new URL(r.url).pathname)).toEqual([
      '/api/auth/devices',
      '/api/auth/devices',
      '/api/coordinator.v1.CompareService/Compare',
      '/api/coordinator.v1.CompareService/Compare',
      '/api/coordinator.v1.CompareService/Compare',
      '/api/coordinator.v1.CompareService/Compare',
      '/api/auth/session',
      '/api/auth/session',
    ]);
    return { world, api };
  }

  it('off: not one request that leaves the page carries one, though this device stored on', async () => {
    localStorage.setItem(DIAG_IDS_KEY, 'on');
    const { world } = await everySender();
    expect(world.net.sent.filter((r) => r.headers.has('traceparent'))).toEqual([]);
  });

  it('off: each writer adds none and drops one already set', () => {
    let sent: string | null = 'unset';
    void traceInterceptor()((r) => {
      sent = r.header.get('traceparent');
      return Promise.resolve({} as never);
    })({ header: new Headers(), contextValues: createContextValues().set(kActionTrace, newTraceId()) } as never);
    expect(sent).toBeNull();
    const plain = new Headers();
    addTraceHeader(plain, new URL('/api/auth/devices', APP_ORIGIN), APP_ORIGIN);
    expect(plain.has('traceparent')).toBe(false);
    const attempt = new Headers({ traceparent: given });
    dropTraceIfOff(attempt);
    expect(attempt.has('traceparent')).toBe(false);
  });

  it('on (VITE_DIAG_IDS=true): the same calls carry one, and the caller-set one is kept', async () => {
    build(true);
    const { api } = await everySender();
    for (const r of api) expect(r.headers.get('traceparent')).toMatch(TRACEPARENT);
    expect(api.at(-1)!.headers.get('traceparent')).toBe(given);
  });
});

describe('no origin_trace in any Push body', () => {
  // The wire: our transport and dpopFetch to the fake coordinator, whose first Push asks for a fresh DPoP nonce
  // (a restart), so each call is two attempts. Every Push body that reaches our origin is read as it arrives.
  async function wire() {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const coord = world.coord.handler;
    const bodies: string[] = [];
    world.net.route(APP_ORIGIN, async (req) => {
      if (new URL(req.url).pathname !== PUSH_PATH) return coord(req);
      bodies.push(await req.clone().text());
      if (bodies.length % 2 === 1) {
        world.coord.restart();
        return coord(req);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createClient(SyncService, createCoordinatorTransport(tab.fetch));
    const traces = () => bodies.map((t) => (JSON.parse(t) as { events: { originTrace?: string }[] }).events.map((e) => e.originTrace));
    return { push: (req: PushRequest) => client.push(req), traces };
  }

  it('edits queued while a build had ids and one made now: the batch, its nonce retry and its resend carry none', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    build(true);
    await write(store, 0, 'note', 'earlier');
    await write(store, 1, 'status', 'owned');
    expect((await store.listOutbox()).every((e) => isTraceId(e.origin_trace))).toBe(true);
    build(false);
    await write(store, 2, 'note', 'now');
    await store.onStatus(status(T0), 0);

    const fresh = await send(store);
    expect(fresh.retry).toBe(false);
    expect(fresh.request.events.map((e) => e.originTrace)).toEqual([undefined, undefined, undefined]);
    expect((await store.listOutbox()).map((e) => 'origin_trace' in e)).toEqual([false, false, false]);
    const { push, traces } = await wire();
    await push(fresh.request);
    const resend = await send(store);
    expect(resend.retry).toBe(true);
    expect(toBinary(PushRequestSchema, resend.request)).toEqual(toBinary(PushRequestSchema, fresh.request));
    await push(resend.request);
    expect(traces()).toEqual(Array.from({ length: 4 }, () => [undefined, undefined, undefined]));
  });

  it('a batch a build with ids froze, ids in its request: the wire takes them off every attempt, and its resend has none', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    build(true);
    await write(store, 0, 'note', 'a');
    await store.createCopy(HEAD[1], 'owned');
    await store.onStatus(status(T0), 0);
    const frozen = await send(store);
    expect(frozen.request.events.map((e) => isTraceId(e.originTrace))).toEqual([true, true, true]);
    build(false);
    const { push, traces } = await wire();
    await push(frozen.request);
    const resend = await send(store);
    expect(resend.retry).toBe(true);
    expect(resend.request.events.map((e) => e.originTrace)).toEqual([undefined, undefined, undefined]);
    expect((await store.listOutbox()).map((e) => [e.state, 'origin_trace' in e])).toEqual([
      ['IN_FLIGHT', false],
      ['IN_FLIGHT', false],
      ['IN_FLIGHT', false],
    ]);
    await push(resend.request);
    expect(traces()).toEqual(Array.from({ length: 4 }, () => [undefined, undefined, undefined]));
  });

  it('through the sync engine: a sync pass clears ids at rest first, and neither the Push nor its retry after a drop carries one', async () => {
    const r = await rig();
    build(true);
    await r.engine.write((s) => write(s, 0, 'note', 'earlier'));
    expect(isTraceId((await r.store.listOutbox())[0].origin_trace)).toBe(true);
    build(false);
    await r.engine.write((s) => write(s, 1, 'note', 'now'));
    r.server.fault('push', { kind: 'drop' });
    await r.engine.trigger('start');
    expect((await r.store.listOutbox()).map((e) => [e.state, 'origin_trace' in e])).toEqual([
      ['IN_FLIGHT', false],
      ['IN_FLIGHT', false],
    ]);
    await r.engine.trigger('manual');
    const pushes = r.server.calls.filter((c) => c.rpc === 'push').map((c) => c.request as PushRequest);
    expect(pushes).toHaveLength(2);
    expect(pushes.map((p) => p.events.map((e) => e.originTrace))).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect((await r.store.listOutbox()).map((e) => [e.state, e.outcome])).toEqual([
      ['APPLIED', 'DUPLICATE'],
      ['APPLIED', 'DUPLICATE'],
    ]);
  });

  it('on (VITE_DIAG_IDS=true): the same fresh batch carries its ids on both attempts', async () => {
    build(true);
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'a');
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    const { push, traces } = await wire();
    await push(batch.request);
    const [trace] = batch.request.events.map((e) => e.originTrace);
    expect(isTraceId(trace)).toBe(true);
    expect(traces()).toEqual([[trace], [trace]]);
  });
});
