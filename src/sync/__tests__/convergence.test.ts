import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toBinary } from '@bufbuild/protobuf';
import { PushRequestSchema, compareVersion, type SyncEvent } from '@figurecollecting/fc-api-contract';
import vectorsText from '@figurecollecting/fc-api-contract/golden/version-vectors.json?raw';
import type { LocalDb } from '../../storage/localDb';
import {
  DEVICE,
  FakeClock,
  HEAD,
  OTHER_DEVICE,
  SERVER_DEVICE,
  SyncOp,
  T0,
  ev,
  freshDb,
  iso,
  key,
  openStore,
  status,
  token,
  write,
} from './harness';

interface Vectors {
  valid: { version: string }[];
  invalid: { version: string }[];
  order: { a: string; b: string; cmp: -1 | 0 | 1 }[];
  sorted: string[];
  collationTraps: { a: string; b: string }[];
}
const vectors = JSON.parse(vectorsText) as Vectors;

async function dump(db: LocalDb, sub = 'user-a') {
  const range = IDBKeyRange.bound([sub], [sub, []]);
  return {
    facets: await db.getAll('facets', range),
    outbox: await db.getAllFromIndex('outbox', 'by_sub', range),
    meta: await db.get('sync_meta', sub),
  };
}

const FACETS = [key(0, 'status'), key(0, 'note'), key(1, 'score'), `identity/${HEAD[2]}`];
const LOCAL_WALL = T0 + 2_500; // inside the remote version range, so some remotes win and some lose

// A remote version: second offset, counter, device; a null device is a bare instant.
const versionArb = fc
  .record({
    sec: fc.integer({ min: 0, max: 5 }),
    counter: fc.integer({ min: 0, max: 2 }),
    device: fc.constantFrom<string | null>(OTHER_DEVICE, SERVER_DEVICE, null),
  })
  .map(({ sec, counter, device }) => (device === null ? iso(T0 + sec * 1000) : token(T0 + sec * 1000, counter, device)));

const eventSetArb = fc
  .array(
    fc.record({
      facet: fc.constantFrom(...FACETS),
      version: versionArb,
      op: fc.constantFrom<'upsert' | 'delete'>('upsert', 'delete'),
      text: fc.string({ maxLength: 8 }),
      copies: fc.integer({ min: 1, max: 3 }),
    }),
    { minLength: 1, maxLength: 14 },
  )
  // One event per (facet, version): an equal version names the same event.
  .map((xs) => {
    const seen = new Set<string>();
    return xs.filter((x) => {
      const id = `${x.facet} ${x.version}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });

const scenarioArb = fc
  .record({
    events: eventSetArb,
    localEdits: fc.subarray([0, 1, 2] as const),
    pages: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 20 }),
  })
  .chain(({ events, localEdits, pages }) => {
    const multiset = events.flatMap((e) => Array.from({ length: e.copies }, () => e));
    const perm = fc.shuffledSubarray(multiset, { minLength: multiset.length, maxLength: multiset.length });
    return fc.record({
      events: fc.constant(events),
      localEdits: fc.constant(localEdits),
      pages: fc.constant(pages),
      first: perm,
      second: perm,
    });
  });

type Gen = { facet: string; version: string; op: 'upsert' | 'delete'; text: string };
const toEvent = (g: Gen): SyncEvent => ev(g.facet, g.version, g.op, JSON.stringify({ note: g.text }));

async function replay(scenario: { localEdits: readonly (0 | 1 | 2)[]; pages: number[] }, order: Gen[]) {
  const { db } = await freshDb();
  const store = await openStore(db, { clock: new FakeClock(LOCAL_WALL) });
  for (const which of scenario.localEdits) {
    if (which === 0) await write(store, 0, 'status', 'owned');
    if (which === 1) await write(store, 0, 'note', 'mine');
    if (which === 2) await write(store, 1, 'score', 7);
  }
  let i = 0;
  let page = 0;
  while (i < order.length) {
    const size = scenario.pages[page++ % scenario.pages.length];
    const chunk = order.slice(i, i + size).map(toEvent);
    i += size;
    await store.apply(chunk, { cursor: i >= order.length ? 'end' : `p${page}` });
  }
  return { db, store };
}

describe('(a) apply is commutative and idempotent', () => {
  it('reaches the same store from any permutation of an event set, duplicates included', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const one = await replay(s, s.first);
        const two = await replay(s, s.second);
        const a = await dump(one.db);
        const b = await dump(two.db);
        expect(a).toEqual(b);

        // And it is the right store: the replica holds the highest remote version seen, and the
        // display lays the unanswered outbox over it (sync.proto rule 6, THE IMPORT, ON A CLIENT).
        for (const facet of FACETS) {
          const remote = s.events.filter((e) => e.facet === facet).map((e) => e.version);
          const local = a.outbox.filter((e) => e.facet_key === facet).map((e) => e.edit_version);
          const row = a.facets.find((f) => f.facet_key === facet);
          expect(row?.value?.version).toBe(local.at(-1) ?? remote.sort(compareVersion).at(-1));
          expect(row?.known?.version).toBe(remote.sort(compareVersion).at(-1));
        }

        // Applying everything again changes nothing.
        await one.store.apply(s.first.map(toEvent), { cursor: 'end' });
        expect(await dump(one.db)).toEqual(a);
        one.db.close();
        two.db.close();
      }),
      { numRuns: 200 },
    );
  });
});

describe('golden version vectors through apply', () => {
  const facet = key(0, 'note');

  it('stores every valid token and refuses every invalid one', async () => {
    for (const { version } of vectors.valid) {
      const { db } = await freshDb();
      const store = await openStore(db);
      const report = await store.apply([ev(facet, version)]);
      expect(report).toEqual({ applied: 1, dropped: 0, refused: [] });
      expect((await store.getFacet(facet))!.value!.version).toBe(version);
      db.close();
    }
    const { db } = await freshDb();
    const store = await openStore(db);
    const bad = [...vectors.invalid.map((v) => v.version), ...vectors.collationTraps.map((t) => t.b)];
    const report = await store.apply(bad.map((v) => ev(facet, v)));
    expect(report.applied).toBe(0);
    expect(report.refused.map((e) => e.version)).toEqual(bad);
    expect(await store.getFacet(facet)).toBeUndefined();
    expect((await store.getMeta()).hlc).toEqual({ micros: '0', counter: 0 });
  });

  it('keeps the last of the sorted list whatever order it arrives in', async () => {
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(vectors.sorted, { minLength: vectors.sorted.length }), async (order) => {
        const { db } = await freshDb();
        const store = await openStore(db);
        await store.apply(order.map((v) => ev(facet, v)));
        expect((await store.getFacet(facet))!.value!.version).toBe(vectors.sorted.at(-1));
        db.close();
      }),
      { numRuns: 25 },
    );
  });

  it('orders every golden pair as the vectors say', async () => {
    for (const { a, b, cmp } of vectors.order) {
      const { db } = await freshDb();
      const store = await openStore(db);
      await store.apply([ev(facet, a, 'upsert', '"a"')]);
      const report = await store.apply([ev(facet, b, 'upsert', '"b"')]);
      expect(report.applied).toBe(cmp < 0 ? 1 : 0);
      expect((await store.getFacet(facet))!.value!.payload).toBe(cmp < 0 ? '"b"' : '"a"');
      db.close();
    }
  });
});

describe('apply rule details', () => {
  it('drops an event at an equal or lower version and counts it', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const v = token(T0, 1, OTHER_DEVICE);
    await store.apply([ev(key(0, 'note'), v, 'upsert', '"x"')]);
    const report = await store.apply([
      ev(key(0, 'note'), v, 'upsert', '"x"'),
      ev(key(0, 'note'), token(T0, 0, OTHER_DEVICE), 'upsert', '"older"'),
    ]);
    expect(report).toEqual({ applied: 0, dropped: 2, refused: [] });
  });

  it('refuses an event whose op this client does not know', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const odd = { ...ev(key(0, 'note'), token(T0, 0, OTHER_DEVICE)), op: 7 as SyncOp };
    const unset = { ...ev(key(0, 'score'), token(T0, 0, OTHER_DEVICE)), op: SyncOp.UNSPECIFIED };
    const report = await store.apply([odd, unset]);
    expect(report.refused).toHaveLength(2);
    expect(await store.listFacets()).toEqual([]);
  });

  it('saves the cursor in the same transaction as the page', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([ev(key(0, 'note'), token(T0, 0, OTHER_DEVICE))], { cursor: 'c-1' });
    expect((await store.getMeta()).cursor).toBe('c-1');
    await store.apply([]);
    expect((await store.getMeta()).cursor).toBe('c-1');
  });

  it('folds remote versions into the clock so the next edit beats them', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const ahead = token(T0 + 60_000, 3, OTHER_DEVICE);
    await store.apply([ev(key(2, 'status'), ahead, 'upsert', '{"status":"owned"}')]);
    const mine = await write(store, 0, 'status', 'owned');
    expect(compareVersion(mine.version, ahead)).toBe(1);
  });

  it('keeps showing a pending edit a newer remote event beats, and still sends it: the server decides (0.3.0)', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const mine = await write(store, 0, 'note', 'mine');
    const theirs = token(T0 + 1_000, 0, OTHER_DEVICE);

    const report = await store.apply([ev(key(0, 'note'), theirs, 'upsert', '{"note":"theirs"}')]);

    expect(report.applied).toBe(1);
    const facet = await store.getFacet(key(0, 'note'));
    expect(facet!.value!.version).toBe(mine.version);
    expect(facet!.known).toEqual({ version: theirs, op: 'upsert', payload: '{"note":"theirs"}' });
    expect(facet!.pending_id).toBe(mine.outbox_id);
    expect(facet!.overwritten).toBeNull();
    const [entry] = await store.listOutbox();
    expect(entry.state).toBe('PENDING');
    await store.onStatus(status(T0), 0);
    const next = await store.nextBatch();
    expect(next.kind === 'send' && next.batch.entryIds).toEqual([mine.outbox_id]);
  });

  it('leaves an in-flight edit a newer remote event beats in its frozen batch, byte-identical', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'mine');
    await store.onStatus(status(T0), 0);
    const sent = await store.nextBatch();
    if (sent.kind !== 'send') throw new Error('expected a batch');
    const bytes = toBinary(PushRequestSchema, sent.batch.request);

    await store.apply([ev(key(0, 'note'), token(T0 + 1_000, 0, OTHER_DEVICE), 'upsert', '{"note":"theirs"}')]);

    const [entry] = await store.listOutbox();
    expect(entry.state).toBe('IN_FLIGHT');
    const again = await store.nextBatch();
    if (again.kind !== 'send') throw new Error('expected the frozen batch again');
    expect(toBinary(PushRequestSchema, again.batch.request)).toEqual(bytes);
  });

  it('never lets a device id outside the grammar reach the clock', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([ev(key(0, 'note'), token(T0 + 60_000, 0, DEVICE.toUpperCase()))]);
    expect((await store.getMeta()).hlc.micros).toBe('0');
  });
});
