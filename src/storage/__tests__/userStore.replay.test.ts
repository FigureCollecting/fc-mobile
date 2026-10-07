import { describe, expect, it } from 'vitest';
import { PushOutcome, ufFacetKey } from '@figurecollecting/fc-api-contract';
import { HEAD, SyncOp, T0, ev, freshDb, key, openStore, result, status, token, write, OTHER_DEVICE } from '../../sync/__tests__/harness';

describe('replaceReplica: a replay from an empty cursor onto an empty replica', () => {
  it('keeps exactly what the replay gives by LWW, drops what it does not carry, and keeps unanswered edits shown', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([ev(key(0, 'note'), token(T0, 1, OTHER_DEVICE)), ev(key(1, 'note'), token(T0, 2, OTHER_DEVICE))], { cursor: 'c2' });
    await write(store, 2, 'note', 'pending');
    const report = await store.replaceReplica(
      [
        ev(key(0, 'note'), token(T0, 1, OTHER_DEVICE)),
        ev(key(0, 'note'), token(T0 - 1, 9, OTHER_DEVICE)), // lower: dropped
        ev(key(2, 'note'), token(T0, 3, OTHER_DEVICE)),
        ev(key(0, 'score'), token(T0, 4, OTHER_DEVICE)), // new to this device
        { facetKey: key(1, 'score'), version: 'not a version', op: SyncOp.UPSERT, payload: '{}' },
      ],
      'c9',
    );
    expect(report).toMatchObject({ applied: 3, dropped: 1 });
    expect(report.refused.map((e) => e.version)).toEqual(['not a version']);
    expect((await store.getFacet(key(0, 'note')))!.value!.version).toBe(token(T0, 1, OTHER_DEVICE));
    // Not in the replay: the server no longer has it.
    expect(await store.getFacet(key(1, 'note'))).toMatchObject({ known: null, value: null });
    // The unanswered edit stays laid over the replayed replica.
    const pending = (await store.getFacet(key(2, 'note')))!;
    expect(pending.known!.version).toBe(token(T0, 3, OTHER_DEVICE));
    expect(JSON.parse(pending.value!.payload).note).toBe('pending');
    expect(await store.getFacet(key(0, 'score'))).toMatchObject({ known: { version: token(T0, 4, OTHER_DEVICE) }, value: { version: token(T0, 4, OTHER_DEVICE) }, head_id: HEAD[0] });
    expect((await store.getMeta()).cursor).toBe('c9');
    // The replayed versions are folded into the clock: the next edit lands above them.
    const next = await store.writeFacet(ufFacetKey(HEAD[0], 'score'), { score: 3 });
    expect(next.version > token(T0, 4, OTHER_DEVICE)).toBe(true);
  });
});

describe('dismissRejected', () => {
  it('marks only this user REJECTED edits dismissed and keeps them', async () => {
    const { db } = await freshDb();
    const a = await openStore(db);
    const b = await openStore(db, { sub: 'user-b' });
    await write(a, 0, 'note', 'x');
    await write(a, 1, 'note', 'y');
    await write(b, 0, 'note', 'z');
    await a.onStatus(status(T0), 10);
    await b.onStatus(status(T0), 10);
    const batch = await a.nextBatch();
    if (batch.kind !== 'send') throw new Error('expected a batch');
    await a.recordPush(batch.batch.clientId, {
      results: [result(key(0, 'note'), PushOutcome.REJECTED, undefined, 'payload_invalid'), result(key(1, 'note'), PushOutcome.APPLIED, batch.batch.request.events[1])],
    });
    const [rejected, applied] = await a.listOutbox();
    const [other] = await b.listOutbox();
    await a.dismissRejected([rejected!.id!, applied!.id!, other!.id!, 9999]);
    expect((await a.listOutbox()).map((e) => [e.state, e.dismissed ?? false])).toEqual([
      ['REJECTED', true],
      ['APPLIED', false],
    ]);
    expect((await b.listOutbox())[0]!.dismissed).toBeUndefined();
  });
});
