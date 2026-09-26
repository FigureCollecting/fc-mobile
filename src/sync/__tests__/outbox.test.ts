import { describe, expect, it } from 'vitest';
import { toBinary } from '@bufbuild/protobuf';
import { PushRequestSchema, type PushRequest, type PushResponse } from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../../storage/userStore';
import {
  DEVICE,
  HEAD,
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
    await store.writeFacet(HEAD[0], 'status', 'owned');
    await store.writeFacet(HEAD[1], 'status', 'wished');
    await store.writeFacet(HEAD[2], 'status', 'ordered');
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
    await store.writeFacet(HEAD[0], 'status', 'owned');
    await store.writeFacet(HEAD[0], 'note', 'boxed');
    await store.writeFacet(HEAD[1], 'count', 2);
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    const bytes = toBinary(PushRequestSchema, batch.request);
    expect(batch.request.events).toHaveLength(3);
    expect(batch.request.clientId).toBe(batch.clientId);

    // A newer local edit after the send does not touch the frozen batch.
    await store.writeFacet(HEAD[0], 'note', 'unboxed');

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
      field === 'note' ? await store.writeFacet(HEAD[0], 'note', 'mine') : await store.writeFacet(HEAD[0], 'status', 'owned');
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
    const later = await store.writeFacet(HEAD[0], 'note', 'later');
    const older = ev(fk, token(T0 - 1_000, 0, OTHER_DEVICE), 'upsert', '{"note":"old"}');

    await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, older)] });

    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(later.version);
    expect(facet!.known!.version).toBe(older.version);
    expect(facet!.pending_id).toBe(later.outbox_id);
  });

  it('a result for a facet that moved on is applied as a Delta event when current is newer', async () => {
    const { store, batch, fk } = await pushed();
    const later = await store.writeFacet(HEAD[0], 'note', 'later');
    const newest = ev(fk, token(T0 + 60_000, 0, OTHER_DEVICE), 'upsert', '{"note":"theirs"}');

    await store.recordPush(batch.clientId, { results: [result(fk, PushOutcome.STALE, newest)] });

    const facet = await store.getFacet(fk);
    expect(facet!.value!.version).toBe(newest.version);
    expect(facet!.pending_id).toBeNull();
    expect(JSON.parse(facet!.overwritten!.payload).note).toBe('later');
    const entries = await store.listOutbox();
    expect(entries.find((e) => e.id === later.outbox_id)).toMatchObject({ state: 'STALE', superseded: true });
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
    await store.writeFacet(HEAD[0], 'status', 'owned');
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
    const a = await store.writeFacet(HEAD[0], 'status', 'owned');
    const b = await store.writeFacet(HEAD[0], 'status', null);
    await store.writeFacet(HEAD[1], 'status', 'owned');
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
