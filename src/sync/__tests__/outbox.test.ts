import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary, toJson } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { PushRequestSchema, isTraceId, type PushRequest, type PushResponse } from '@figurecollecting/fc-api-contract';
import { diagIdsDefault, setDiagIds } from '../../auth/diagIds';
import { newTraceId } from '../../auth/trace';
import type { UserStore } from '../../storage/userStore';
import { rig } from './engineSupport';
import {
  DAY,
  DEVICE,
  FakeClock,
  HEAD,
  HOUR,
  OTHER_DEVICE,
  PushOutcome,
  T0,
  appliedAll,
  ev,
  freshDb,
  key,
  openStore,
  result,
  status,
  token,
  write,
} from './harness';

async function send(store: UserStore, max = 100) {
  const next = await store.nextBatch(max);
  if (next.kind !== 'send') throw new Error(`expected a batch, got ${next.kind}`);
  return next.batch;
}

describe('(b) a failed send loses nothing', () => {
  it('keeps all 3 entries recoverable when the transport throws after 1 of 3 sends', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'status', 'owned');
    await write(store, 1, 'status', 'wished');
    await write(store, 2, 'status', 'ordered');
    await store.onStatus(status(T0), 0);

    let sends = 0;
    const transport = {
      push: async (req: PushRequest): Promise<Pick<PushResponse, 'results'>> => {
        sends += 1;
        if (sends > 1) throw new Error('network down');
        return appliedAll(req.events);
      },
    };
    const inFlight: Uint8Array[] = [];
    const clientIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const batch = await send(store, 1);
      inFlight.push(toBinary(PushRequestSchema, batch.request));
      clientIds.push(batch.clientId);
      try {
        await store.recordPush(batch.clientId, await transport.push(batch.request));
      } catch {
        break;
      }
    }

    expect(sends).toBe(2);
    const states = (await store.listOutbox()).map((e) => [e.facet_key, e.state]);
    expect(states).toEqual([
      [key(0, 'status'), 'APPLIED'],
      [key(1, 'status'), 'IN_FLIGHT'],
      [key(2, 'status'), 'PENDING'],
    ]);
    // The applied one converged on the server's echo; the other two still show the user's edits.
    expect((await store.getFacet(key(0, 'status')))!.pending_id).toBeNull();
    expect((await store.getFacet(key(1, 'status')))!.pending_id).not.toBeNull();
    expect((await store.getFacet(key(2, 'status')))!.pending_id).not.toBeNull();

    // Reload while IN_FLIGHT: the same client_id and the same events, byte for byte, before any Status.
    const reloaded = await openStore(db);
    const retry = await send(reloaded, 1);
    expect(retry.retry).toBe(true);
    expect(retry.clientId).toBe(clientIds[1]);
    expect(toBinary(PushRequestSchema, retry.request)).toEqual(inFlight[1]);
    await reloaded.recordPush(retry.clientId, appliedAll(retry.request.events));
    await reloaded.onStatus(status(T0), 0);
    const third = await send(reloaded, 1);
    expect(third.retry).toBe(false);
    expect(third.request.events.map((e) => e.facetKey)).toEqual([key(2, 'status')]);
  });

  it('resends a whole frozen batch unchanged after a reload, counting attempts', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'status', 'owned');
    await write(store, 0, 'note', 'boxed');
    await write(store, 1, 'wishability', 2);
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    const bytes = toBinary(PushRequestSchema, batch.request);
    expect(batch.request.events).toHaveLength(3);
    // Each edit carries its action's origin_trace, and the retry's bytes still match (LGMOB M2).
    expect(batch.request.events.map((e) => isTraceId(e.originTrace))).toEqual([true, true, true]);
    expect(batch.request.clientId).toBe(batch.clientId);

    // A newer local edit after the send does not touch the frozen batch.
    await write(store, 0, 'note', 'unboxed');

    const reloaded = await openStore(db);
    const again = await send(reloaded);
    expect(again.clientId).toBe(batch.clientId);
    expect(again.entryIds).toEqual(batch.entryIds);
    expect(toBinary(PushRequestSchema, again.request)).toEqual(bytes);
    const entries = await reloaded.listOutbox();
    expect(entries.slice(0, 3).map((e) => e.attempts)).toEqual([2, 2, 2]);
    expect(entries[3]).toMatchObject({ state: 'PENDING', attempts: 0 });
  });
});

describe('(c) and the rest of the client rule', () => {
  async function pushed(field: 'note' | 'status' = 'note') {
    const { db } = await freshDb();
    const store = await openStore(db);
    const edit =
      field === 'note' ? await write(store, 0, 'note', 'mine') : await write(store, 0, 'status', 'owned');
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    return { db, store, edit, batch, fk: key(0, field) };
  }

  it('(c) STALE adopts current whole: version, op and payload together', async () => {
    const { store, batch, fk } = await pushed();
    const winner = ev(fk, token(T0 + 5_000, 0, OTHER_DEVICE), 'delete');

    const [entry] = await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, winner)] });

    expect(entry).toMatchObject({ state: 'STALE', outcome: 'STALE' });
    const facet = await store.getFacet(fk);
    expect(facet!.value).toEqual({ version: winner.version, op: 'delete', payload: '' });
    expect(facet!.known).toEqual(facet!.value);
    expect(facet!.pending_id).toBeNull();
    expect(JSON.parse(facet!.overwritten!.payload).note).toBe('mine');
  });

  it('(c) STALE after the facet moved on applies current only if it is newer', async () => {
    const { store, batch, fk } = await pushed();
    const later = await write(store, 0, 'note', 'later');
    const older = ev(fk, token(T0 - 1_000, 0, OTHER_DEVICE), 'upsert', '{"note":"old"}');

    await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, older)] });

    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(later.version);
    expect(facet!.known!.version).toBe(older.version);
    expect(facet!.pending_id).toBe(later.outbox_id);
  });

  it('a newer current for a facet with a later pending edit goes to the replica; the edit still shows and is still sent', async () => {
    const { store, batch, fk } = await pushed();
    const later = await write(store, 0, 'note', 'later');
    const newest = ev(fk, token(T0 + 60_000, 0, OTHER_DEVICE), 'upsert', '{"note":"theirs"}');

    await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, newest)] });

    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(later.version);
    expect(facet!.known!.version).toBe(newest.version);
    expect(facet!.pending_id).toBe(later.outbox_id);
    expect(facet!.overwritten).toBeNull();
    const entries = await store.listOutbox();
    expect(entries.find((e) => e.id === later.outbox_id)).toMatchObject({ state: 'PENDING' });
    expect((await send(store)).entryIds).toEqual([later.outbox_id]);
  });

  it('APPLIED converges on the echo and clears pending', async () => {
    const { store, batch, fk, edit } = await pushed();
    await store.recordPush(batch.clientId, appliedAll(batch.request.events));
    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(edit.version);
    expect(facet!.known).toEqual(facet!.value);
    expect(facet!.pending_id).toBeNull();
    expect(facet!.overwritten).toBeNull();
  });

  it('REVIEW hands back an older current, and the local copy takes it', async () => {
    const { store, batch, fk } = await pushed();
    const kept = ev(fk, token(T0 - 60_000, 0, OTHER_DEVICE), 'upsert', '{"note":"kept"}');
    const [entry] = await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.REVIEW, kept)] });
    expect(entry.state).toBe('REVIEW');
    const facet = await store.getFacet(fk);
    expect(facet!.value).toEqual({ version: kept.version, op: 'upsert', payload: '{"note":"kept"}' });
    expect(facet!.overwritten).toBeNull();
  });

  it('REJECTED with no current drops the local value so a later Delta applies', async () => {
    const { store, batch, fk } = await pushed();
    const [entry] = await store.recordPush(batch.clientId, {
      results: [result(fk, PushOutcome.REJECTED, undefined, 'payload_invalid: note too long')],
    });
    expect(entry).toMatchObject({ state: 'REJECTED', reason: 'payload_invalid: note too long' });
    const facet = await store.getFacet(fk);
    expect(facet!.value).toBeNull();
    expect(facet!.pending_id).toBeNull();

    const report = await store.apply([ev(fk, token(T0 - 3_600_000, 0, OTHER_DEVICE))]);
    expect(report.applied).toBe(1);
  });

  it('a replay answers DUPLICATE with a re-read current and the device converges on it', async () => {
    const { store, batch, fk } = await pushed();
    // The first answer was lost; another device wrote since; the retry replays.
    const retry = await send(store);
    expect(retry.clientId).toBe(batch.clientId);
    const since = ev(fk, token(T0 + 30_000, 0, OTHER_DEVICE), 'upsert', '{"note":"theirs"}');

    const [entry] = await store.recordPush(retry.clientId, { results: [result(fk, PushOutcome.DUPLICATE, since)] });

    expect(entry).toMatchObject({ state: 'APPLIED', outcome: 'DUPLICATE' });
    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(since.version);
    expect(JSON.parse(facet!.overwritten!.payload).note).toBe('mine');
  });

  it('refuses a result whose facet_key echo does not match, and changes nothing', async () => {
    const { store, batch, fk } = await pushed();
    const wrong = ev(key(1, 'note'), batch.request.events[0].version);
    await expect(
      store.recordPush(batch.clientId, { results: [result(key(1, 'note'), PushOutcome.APPLIED, wrong)] }),
    ).rejects.toThrow(/facet_key/);
    await expect(store.recordPush(batch.clientId, { results: [] })).rejects.toThrow(/results/);
    expect((await store.listOutbox())[0].state).toBe('IN_FLIGHT');
    expect((await store.getFacet(fk))!.pending_id).not.toBeNull();
  });

  it('refuses a current outside the version grammar', async () => {
    const { store, batch, fk } = await pushed();
    const bad = ev(fk, '2026-09-26T12:00:00Z');
    await expect(store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.APPLIED, bad)] })).rejects.toThrow();
    expect((await store.listOutbox())[0].state).toBe('IN_FLIGHT');
  });

  it('records an answered batch once; a second answer is ignored', async () => {
    const { store, batch, fk } = await pushed();
    await store.recordPush(batch.clientId, appliedAll(batch.request.events));
    const winner = ev(fk, token(T0 + 5_000, 0, OTHER_DEVICE), 'delete');
    const again = await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, winner)] });
    expect(again[0].state).toBe('APPLIED');
    expect((await store.getFacet(fk))!.value!.op).toBe('upsert');
  });

  it('refuses an answer for a batch it never sent', async () => {
    const { store } = await pushed();
    await expect(store.recordPush('nope', { results: [] })).rejects.toThrow(/unknown batch/);
  });

  it('treats an outcome it does not know as REJECTED', async () => {
    const { store, batch, fk, edit } = await pushed();
    const echo = ev(fk, edit.version, 'upsert', batch.request.events[0].payload);
    const [entry] = await store.recordPush(batch.clientId, { results: [result(fk, 9 as PushOutcome, echo)] });
    expect(entry).toMatchObject({ state: 'REJECTED', outcome: 'UNKNOWN_9', reason: 'unknown_outcome' });
  });
});

describe('batches', () => {
  it('needs the first Status of the session before it forms a new batch', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'status', 'owned');
    expect(await store.nextBatch()).toEqual({ kind: 'status_required' });
    await store.onStatus(status(T0), 0);
    expect((await send(store)).request.events).toHaveLength(1);
  });

  it('is empty with nothing queued', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.onStatus(status(T0), 0);
    expect(await store.nextBatch()).toEqual({ kind: 'empty' });
  });

  it('takes the oldest entries first, up to the limit, as SyncEvents in order', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const a = await write(store, 0, 'status', 'owned');
    const b = await write(store, 0, 'status', null);
    await write(store, 1, 'status', 'owned');
    await store.onStatus(status(T0), 0);

    const batch = await send(store, 2);

    expect(batch.entryIds).toEqual([a.outbox_id, b.outbox_id]);
    expect(batch.request.events.map((e) => [e.facetKey, e.version, e.op, e.payload === ''])).toEqual([
      [key(0, 'status'), a.version, 1, false],
      [key(0, 'status'), b.version, 2, true],
    ]);
    expect(batch.request.events[0].version.endsWith(DEVICE)).toBe(true);
    const states = (await store.listOutbox()).map((e) => [e.state, e.batch_pos ?? null, e.attempts]);
    expect(states).toEqual([
      ['IN_FLIGHT', 0, 1],
      ['IN_FLIGHT', 1, 1],
      ['PENDING', null, 0],
    ]);
  });
});

describe('origin_trace: one random id per user action, kept on its queued edits (LGMOB M2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setDiagIds(diagIdsDefault());
  });

  const traces = async (store: UserStore) => (await store.listOutbox()).map((e) => e.origin_trace);
  const pushes = (r: Awaited<ReturnType<typeof rig>>) => r.server.calls.filter((c) => c.rpc === 'push').map((c) => c.request as PushRequest);

  it('gives every row of one engine.write the same trace across its groups, and the next write another', async () => {
    const r = await rig();
    await r.engine.write(async (s) => {
      await write(s, 0, 'note', 'a');
      await write(s, 1, 'status', 'owned');
    });
    await r.engine.write((s) => write(s, 2, 'note', 'b'));
    const rows = await r.store.listOutbox();
    expect(rows).toHaveLength(3);
    expect(rows[0].group).not.toBe(rows[1].group);
    expect(isTraceId(rows[0].origin_trace)).toBe(true);
    expect(rows[1].origin_trace).toBe(rows[0].origin_trace);
    expect(isTraceId(rows[2].origin_trace)).toBe(true);
    expect(rows[2].origin_trace).not.toBe(rows[0].origin_trace);
  });

  it('outside an action, each store intent is its own action: a fresh trace per intent, shared by its rows', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'a');
    await write(store, 1, 'note', 'b');
    await store.createCopy(HEAD[2], 'owned');
    const rows = await store.listOutbox();
    expect(rows).toHaveLength(4);
    expect(rows.every((e) => isTraceId(e.origin_trace))).toBe(true);
    expect(rows[0].origin_trace).not.toBe(rows[1].origin_trace);
    // createCopy writes the head and the status as one group, one action.
    expect(rows[2].group).toBe(rows[3].group);
    expect(rows[3].origin_trace).toBe(rows[2].origin_trace);
    expect(rows[2].origin_trace).not.toBe(rows[1].origin_trace);
  });

  it('stamps an id drawn from the CSPRNG alone: newTraceId takes no input, and stubbed random bytes give exactly that id', async () => {
    expect(newTraceId.length).toBe(0);
    const r = await rig();
    const csprng = vi.spyOn(crypto, 'getRandomValues').mockImplementation((bytes) => {
      (bytes as Uint8Array).fill(0xab);
      return bytes;
    });
    await r.engine.write((s) => write(s, 0, 'note', 'a'));
    await write(r.store, 1, 'note', 'b');
    csprng.mockRestore();
    // Not created_at, the sub, the device or a client id: the same bytes give the same id whatever they are.
    expect(await traces(r.store)).toEqual(['ab'.repeat(16), 'ab'.repeat(16)]);
  });

  it('keeps each of two interleaved writes on its own trace (no trace shared through the store)', async () => {
    const r = await rig();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const a = r.engine.write(async (s) => {
      await write(s, 0, 'note', 'a1');
      await gate;
      await write(s, 1, 'note', 'a2');
    });
    const b = r.engine.write(async (s) => {
      await write(s, 2, 'note', 'b1');
      release();
      await write(s, 0, 'score', 1);
    });
    await Promise.all([a, b]);
    const byKey = new Map((await r.store.listOutbox()).map((e) => [e.facet_key, e.origin_trace]));
    const [a1, a2, b1, b2] = [key(0, 'note'), key(1, 'note'), key(2, 'note'), key(0, 'score')].map((k) => byKey.get(k));
    expect(isTraceId(a1)).toBe(true);
    expect(isTraceId(b1)).toBe(true);
    expect(a2).toBe(a1);
    expect(b2).toBe(b1);
    expect(b1).not.toBe(a1);
    // The store itself holds no action trace: a plain write after both gets a fresh one.
    await write(r.store, 1, 'score', 2);
    const last = (await r.store.listOutbox()).at(-1)!.origin_trace;
    expect([a1, b1]).not.toContain(last);
  });

  it("sends a row's trace as its event's originTrace, in the JSON the transport sends, and leaves it unset on a row without one", async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const trace = newTraceId();
    await store.withAction(trace).writeFacet(key(0, 'note'), { note: 'a' });
    setDiagIds(false);
    await write(store, 1, 'note', 'b');
    setDiagIds(true);
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    expect(batch.request.events.map((e) => e.originTrace)).toEqual([trace, undefined]);
    const json = toJson(PushRequestSchema, batch.request) as { events: Record<string, unknown>[] };
    expect(json.events[0].originTrace).toBe(trace);
    expect('originTrace' in json.events[1]).toBe(false);
  });

  it('a rebase re-versions a queued edit in place and keeps its trace', async () => {
    const { db } = await freshDb();
    const s1 = await openStore(db, { clock: new FakeClock(T0 + DAY) });
    const trace = newTraceId();
    const edit = await s1.withAction(trace).writeFacet(key(0, 'note'), { note: 'ahead' });
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 1_000, 50) });
    const report = await s2.onStatus(status(T0 + 1_000), 0);
    expect(report.rebased).toBe(true);
    const [row] = await s2.listOutbox();
    expect(row.edit_version).not.toBe(edit.version);
    expect(row.origin_trace).toBe(trace);
    expect((await send(s2)).request.events[0].originTrace).toBe(trace);
  });

  describe('a re-mint after REJECTED version_future', () => {
    async function rejectedFuture(tracedAtMint = true) {
      const { db } = await freshDb();
      const clock = new FakeClock(T0);
      const store = await openStore(db, { clock });
      const known = ev(key(0, 'note'), token(T0 - HOUR, 0, OTHER_DEVICE), 'upsert', '{"note":"server"}');
      await store.apply([known]);
      await store.onStatus(status(T0), 0);
      clock.wall += DAY;
      const trace = newTraceId();
      setDiagIds(tracedAtMint);
      const edit = await store.withAction(trace).writeFacet(key(0, 'note'), { note: 'future' });
      setDiagIds(true);
      const batch = await send(store);
      await store.recordPush(batch.clientId, { results: [result(key(0, 'note'), PushOutcome.REJECTED, known, 'version_future')] });
      clock.advance(5_000);
      return { store, edit, trace };
    }

    it("carries the original edit's trace onto the new row", async () => {
      const { store, edit, trace } = await rejectedFuture();
      expect((await store.onStatus(status(T0 + 5_000), 0)).reminted).toBe(1);
      const rows = await store.listOutbox();
      const again = rows.find((e) => e.id === rows.find((o) => o.id === edit.outbox_id)!.reminted_as)!;
      expect(again).toMatchObject({ state: 'PENDING', origin_trace: trace });
      expect((await send(store)).request.events.map((e) => e.originTrace)).toEqual([trace]);
    });

    it('carries none for an edit minted without one, with the switch on again (no backfill)', async () => {
      const { store, edit } = await rejectedFuture(false);
      expect((await store.onStatus(status(T0 + 5_000), 0)).reminted).toBe(1);
      const rows = await store.listOutbox();
      const again = rows.find((e) => e.id === rows.find((o) => o.id === edit.outbox_id)!.reminted_as)!;
      expect(again.state).toBe('PENDING');
      expect('origin_trace' in again).toBe(false);
      expect((await send(store)).request.events.map((e) => e.originTrace)).toEqual([undefined]);
    });

    it('carries none while the switch is off', async () => {
      const { store, edit } = await rejectedFuture();
      setDiagIds(false);
      await store.onStatus(status(T0 + 5_000), 0);
      const rows = await store.listOutbox();
      const again = rows.find((e) => e.id === rows.find((o) => o.id === edit.outbox_id)!.reminted_as)!;
      expect(again.state).toBe('PENDING');
      expect('origin_trace' in again).toBe(false);
    });
  });

  describe('the Diagnostic ids switch', () => {
    it('off at mint: a new edit carries no trace, through an action or not', async () => {
      const r = await rig();
      setDiagIds(false);
      await r.engine.write((s) => write(s, 0, 'note', 'a'));
      await write(r.store, 1, 'note', 'b');
      expect((await r.store.listOutbox()).map((e) => 'origin_trace' in e)).toEqual([false, false]);
    });

    it('off clears every row but a sent batch, whose retry stays byte-identical; on again backfills nothing; the server never refuses', async () => {
      const r = await rig();
      await r.engine.write((s) => write(s, 0, 'note', 'answered'));
      await r.engine.trigger('start');
      await r.engine.write((s) => write(s, 1, 'note', 'flying'));
      r.server.fault('push', { kind: 'drop' });
      await r.engine.trigger('manual');
      const sent = pushes(r).at(-1)!;
      const sentBytes = toBinary(PushRequestSchema, sent);
      expect(isTraceId(sent.events[0].originTrace)).toBe(true);
      await r.engine.write((s) => write(s, 2, 'note', 'queued'));
      expect((await r.store.listOutbox()).map((e) => [e.state, isTraceId(e.origin_trace)])).toEqual([
        ['APPLIED', true],
        ['IN_FLIGHT', true],
        ['PENDING', true],
      ]);

      setDiagIds(false);
      await r.engine.clearOriginTraces();
      const cleared = await r.store.listOutbox();
      expect(cleared.map((e) => [e.state, 'origin_trace' in e])).toEqual([
        ['APPLIED', false],
        ['IN_FLIGHT', true],
        ['PENDING', false],
      ]);
      expect(cleared[1].origin_trace).toBe(sent.events[0].originTrace);

      setDiagIds(true);
      await r.engine.write((s) => write(s, 0, 'score', 5));
      const after = await r.store.listOutbox();
      expect(after.map((e) => 'origin_trace' in e)).toEqual([false, true, false, true]);

      const before = pushes(r).length;
      await r.engine.trigger('manual');
      const [retry, next] = pushes(r).slice(before);
      expect(toBinary(PushRequestSchema, retry)).toEqual(sentBytes);
      expect(next.events.map((e) => [e.facetKey, e.originTrace])).toEqual([
        [key(2, 'note'), undefined],
        [key(0, 'score'), after[3].origin_trace],
      ]);
      expect(r.engine.state.value.lastError).toBeNull();
      expect((await r.store.listOutbox()).map((e) => [e.state, e.outcome])).toEqual([
        ['APPLIED', 'APPLIED'],
        ['APPLIED', 'DUPLICATE'],
        ['APPLIED', 'APPLIED'],
        ['APPLIED', 'APPLIED'],
      ]);
    });

    it('a queued edit that still holds a trace when the switch is off (the clear never ran) is frozen without it; its retry is byte-identical', async () => {
      const { db } = await freshDb();
      const store = await openStore(db);
      await write(store, 0, 'note', 'a');
      setDiagIds(false);
      await store.onStatus(status(T0), 0);
      const batch = await send(store);
      expect(batch.request.events[0].originTrace).toBeUndefined();
      expect('origin_trace' in (await store.listOutbox())[0]).toBe(false);
      setDiagIds(true);
      const again = await send(store);
      expect(again.retry).toBe(true);
      expect(toBinary(PushRequestSchema, again.request)).toEqual(toBinary(PushRequestSchema, batch.request));
    });

    it("clears only this account's rows", async () => {
      const { db } = await freshDb();
      const mine = await openStore(db);
      const theirs = await openStore(db, { sub: 'user-b' });
      await write(mine, 0, 'note', 'a');
      await write(theirs, 0, 'note', 'b');
      setDiagIds(false);
      await write(mine, 1, 'note', 'never traced');
      await mine.clearOriginTraces();
      expect((await db.getAll('outbox')).map((e) => [e.sub, isTraceId(e.origin_trace)])).toEqual([
        ['user-a', false],
        ['user-b', true],
        ['user-a', false],
      ]);
    });

    it('clears in one transaction: a failed write leaves every trace as it was', async () => {
      const { db } = await freshDb();
      const store = await openStore(db);
      await write(store, 0, 'note', 'a');
      await write(store, 1, 'note', 'b');
      const before = await traces(store);
      const realPut = IDBObjectStore.prototype.put;
      let puts = 0;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
        if (this.name === 'outbox' && ++puts === 2) throw new DOMException('quota', 'QuotaExceededError');
        return realPut.apply(this, args as Parameters<typeof realPut>);
      });
      await expect(store.clearOriginTraces()).rejects.toMatchObject({ name: 'LocalWriteError', quota: true });
      vi.restoreAllMocks();
      expect(await traces(store)).toEqual(before);
      expect(before.every(isTraceId)).toBe(true);
    });
  });

  it('the fake coordinator, like C3, leaves origin_trace out of replay identity: a resend that adds, changes or drops it is a replay', async () => {
    const r = await rig();
    await r.engine.write((s) => write(s, 0, 'note', 'a'));
    await r.store.onStatus(status(T0), 0);
    const batch = await send(r.store);
    const event = batch.request.events[0];
    await r.server.sync.push(batch.request);
    for (const originTrace of [undefined, newTraceId()]) {
      const resent = create(PushRequestSchema, { clientId: batch.clientId, events: [{ ...event, originTrace }] });
      const res = await r.server.sync.push(resent).catch((e: unknown) => e);
      expect(res).not.toBeInstanceOf(ConnectError);
      expect((res as PushResponse).results.map((x) => x.outcome)).toEqual([PushOutcome.DUPLICATE]);
    }
    const changed = create(PushRequestSchema, { clientId: batch.clientId, events: [{ ...event, payload: '{"note":"b"}' }] });
    await expect(r.server.sync.push(changed)).rejects.toMatchObject({ code: Code.InvalidArgument });
  });
});
