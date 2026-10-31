// The Diagnostic ids switch going off (LGMOB M2): origin_trace leaves every outbox row on this device,
// whatever account wrote it, except a batch sent and unanswered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTraceId } from '@figurecollecting/fc-api-contract';
import { diagIdsDefault, setDiagIds } from '../../auth/diagIds';
import { clearOriginTraces } from '../originTraces';
import type { OutboxEntry } from '../records';
import { freshDb, openStore, status, T0, write } from '../../sync/__tests__/harness';

afterEach(() => {
  vi.restoreAllMocks();
  setDiagIds(diagIdsDefault());
});

const withoutTrace = ({ origin_trace: _dropped, ...rest }: OutboxEntry) => rest;

async function device() {
  const { db } = await freshDb();
  const mine = await openStore(db);
  const theirs = await openStore(db, { sub: 'user-b' });
  await write(mine, 0, 'note', 'sent');
  await mine.onStatus(status(T0), 0);
  const sent = await mine.nextBatch();
  if (sent.kind !== 'send') throw new Error(sent.kind);
  await write(mine, 1, 'note', 'queued');
  await write(theirs, 0, 'note', 'theirs');
  setDiagIds(false);
  await write(mine, 2, 'note', 'never traced');
  setDiagIds(true);
  return { db, mine, theirs };
}

describe('clearOriginTraces (the whole device, one transaction)', () => {
  it("takes the id off every account's rows but IN_FLIGHT ones, and changes nothing else", async () => {
    const { db } = await device();
    const before = await db.getAll('outbox');
    expect(before.map((e) => [e.sub, e.state, isTraceId(e.origin_trace)])).toEqual([
      ['user-a', 'IN_FLIGHT', true],
      ['user-a', 'PENDING', true],
      ['user-b', 'PENDING', true],
      ['user-a', 'PENDING', false],
    ]);
    await clearOriginTraces(db);
    const after = await db.getAll('outbox');
    expect(after).toEqual(before.map((e) => (e.state === 'IN_FLIGHT' ? e : withoutTrace(e))));
  });

  it('a failed write leaves every id where it was', async () => {
    const { db } = await device();
    const before = await db.getAll('outbox');
    const realPut = IDBObjectStore.prototype.put;
    let puts = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'outbox' && ++puts === 2) throw new DOMException('quota', 'QuotaExceededError');
      return realPut.apply(this, args as Parameters<typeof realPut>);
    });
    await expect(clearOriginTraces(db)).rejects.toMatchObject({ name: 'LocalWriteError', quota: true });
    vi.restoreAllMocks();
    expect(await db.getAll('outbox')).toEqual(before);
  });

  it('is a no-op on an empty device', async () => {
    const { db } = await freshDb();
    await clearOriginTraces(db);
    expect(await db.getAll('outbox')).toEqual([]);
  });
});
