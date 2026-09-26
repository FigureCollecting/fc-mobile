// One signed-in user's view of the v2 local store. Every key starts with the
// sub bound here, so nothing this object does can read or write another
// user's rows. Network-free: Status and Push answers are handed in.
import { create } from '@bufbuild/protobuf';
import {
  Hlc,
  PushOutcome,
  PushRequestSchema,
  SyncEventSchema,
  SyncOp,
  compareVersion,
  normaliseDeviceId,
  userFacetKey,
  type HlcClock,
  type ProductCard,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type StatusResponse,
  type UserFacetField,
} from '@figurecollecting/fc-api-contract';
import type { LocalDb } from './localDb';
import type { FacetRecord, FacetValue, OutboxEntry, OutboxState, ProductRecord, SyncMeta } from './records';
import { runTx, type WriteTx } from './tx';
import { buildPayload, deviceTimeZone, type FieldValues } from '../sync/payload';
import { emptyFacet, isNewer, mergeRemote, toFacetValue, type RemoteEvent } from '../sync/facetMerge';
import { ZERO_HLC, isPast, maxHlc, toHlcRecord, toHlcState } from '../sync/hlcState';

export { LocalWriteError } from './tx';
export type { RemoteEvent } from '../sync/facetMerge';

export interface UserStoreOptions {
  sub: string;
  /** The DPoP-enrolled device's uuid (dashed or not); the HLC suffix of every edit. */
  deviceId: string;
  clock?: HlcClock;
  timeZone?: () => string | undefined;
  newClientId?: () => string;
}

export interface WriteResult {
  facet_key: string;
  version: string;
  outbox_id: number;
}

export interface ApplyReport {
  applied: number;
  dropped: number;
  /** Events this client cannot order or read (out-of-grammar version, unknown op); never stored. */
  refused: RemoteEvent[];
}

export interface Batch {
  clientId: string;
  request: PushRequest;
  entryIds: number[];
  /** A frozen batch sent before and not yet answered. */
  retry: boolean;
}

export type NextBatch = { kind: 'send'; batch: Batch } | { kind: 'empty' } | { kind: 'status_required' };

export interface StatusReport {
  rebased: boolean;
  reminted: number;
}

export interface HoldingView {
  head_id: string;
  status: FacetRecord;
  count?: FacetRecord;
  score?: FacetRecord;
  note?: FacetRecord;
}

/** A Push answer that does not match the batch it claims to answer; nothing of it was applied. */
export class PushAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushAnswerError';
  }
}

/** removeLocalData refused: this many of the user's edits have not reached the server. */
export class UnsyncedEditsError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`${count} edit(s) not yet synced`);
    this.name = 'UnsyncedEditsError';
    this.count = count;
  }
}

const systemClock: HlcClock = { wallMs: () => Date.now(), monoMs: () => performance.now() };

const STATE_FOR: Partial<Record<PushOutcome, OutboxState>> = {
  [PushOutcome.APPLIED]: 'APPLIED',
  [PushOutcome.DUPLICATE]: 'APPLIED',
  [PushOutcome.STALE]: 'STALE',
  [PushOutcome.REVIEW]: 'REVIEW',
  [PushOutcome.REJECTED]: 'REJECTED',
};

const CARD_TEXTS = ['title', 'manufacturer', 'series', 'character', 'scale', 'releaseYm', 'contentLevel'] as const;

const isLive = (rec: FacetRecord | undefined): rec is FacetRecord => rec?.value?.op === 'upsert';

type Stores = WriteTx<('facets' | 'outbox' | 'sync_meta')[]>;

export class UserStore {
  readonly sub: string;
  private readonly db: LocalDb;
  private readonly hlc: Hlc;
  private readonly clock: HlcClock;
  private readonly timeZone?: () => string | undefined;
  private readonly newClientId: () => string;
  private statusSeen = false;
  // rebase() lowers the in-memory clock at once. Until a Status transaction that
  // carries it commits, its re-mint and exact save stay owed, so an abort cannot drop them.
  private rebaseUnsaved = false;

  private constructor(db: LocalDb, opts: UserStoreOptions, meta: SyncMeta) {
    this.db = db;
    this.sub = opts.sub;
    this.clock = opts.clock ?? systemClock;
    this.timeZone = opts.timeZone;
    this.newClientId = opts.newClientId ?? (() => crypto.randomUUID());
    // Restored so a reload keeps minting above every version already issued.
    this.hlc = new Hlc({ deviceId: meta.device_id, clock: this.clock, state: toHlcState(meta.hlc), offsetMs: meta.offset_ms });
  }

  static async open(db: LocalDb, opts: UserStoreOptions): Promise<UserStore> {
    const deviceId = normaliseDeviceId(opts.deviceId);
    const meta = await runTx(db, ['sync_meta'], async (tx) => {
      const found = await tx.objectStore('sync_meta').get(opts.sub);
      const next: SyncMeta = found
        ? { ...found, device_id: deviceId }
        : { sub: opts.sub, device_id: deviceId, cursor: '', hlc: ZERO_HLC, offset_ms: 0, rejected_past: null };
      await tx.objectStore('sync_meta').put(next);
      return next;
    });
    return new UserStore(db, opts, meta);
  }

  // ---------------------------------------------------------------- writes

  // The facet, its outbox entry and the HLC state commit together: a reload never
  // sees one without the others, and a failure (quota included) leaves no edit
  // that looks applied.
  async writeFacet<F extends UserFacetField>(headId: string, field: F, value: FieldValues[F] | null): Promise<WriteResult> {
    const facetKey = userFacetKey(headId, field);
    const at = new Date(this.clock.wallMs());
    const op = value === null ? 'delete' : 'upsert';
    const payload = value === null ? '' : buildPayload(field, value, at, deviceTimeZone(this.timeZone));
    return runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const meta = await this.readMeta(tx);
      const rec = (await tx.objectStore('facets').get([this.sub, facetKey])) ?? emptyFacet(this.sub, facetKey);
      const base = rec.value?.version;
      // The facet floor: the edit lands above the version it was made on.
      const version = this.hlc.tick(base);
      const id = await tx.objectStore('outbox').add({
        sub: this.sub,
        facet_key: facetKey,
        op,
        payload,
        edit_version: version,
        base_version: base ?? null,
        state: 'PENDING',
        attempts: 0,
        created_at: at.getTime(),
      });
      rec.value = { version, op, payload };
      rec.pending_id = id;
      rec.overwritten = null;
      await tx.objectStore('facets').put(rec);
      await this.saveClock(tx, meta);
      return { facet_key: facetKey, version, outbox_id: id };
    });
  }

  /** Apply a Delta page and, when given, its cursor in one transaction. */
  async apply(events: RemoteEvent[], opts: { cursor?: string } = {}): Promise<ApplyReport> {
    return runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const meta = await this.readMeta(tx);
      const report: ApplyReport = { applied: 0, dropped: 0, refused: [] };
      for (const event of events) {
        const value = toFacetValue(event);
        if (value === undefined) {
          report.refused.push(event);
          continue;
        }
        this.hlc.observe(value.version);
        const applied = await this.mergeInto(tx, event.facetKey, value);
        if (applied) report.applied += 1;
        else report.dropped += 1;
      }
      if (opts.cursor !== undefined) meta.cursor = opts.cursor;
      await this.saveClock(tx, meta);
      return report;
    });
  }

  // ---------------------------------------------------------------- outbox

  // An unanswered frozen batch always comes back first, same client_id and events.
  // A new batch waits for the session's first Status and for the fresh Status
  // owed after a REJECTED.
  async nextBatch(max = 100): Promise<NextBatch> {
    return runTx(this.db, ['outbox', 'sync_meta'], async (tx) => {
      const outbox = tx.objectStore('outbox');
      const flying = await outbox.index('by_sub_state').get(this.stateRange('IN_FLIGHT'));
      if (flying) {
        const entries = await outbox.index('by_sub_client').getAll(this.clientRange(flying.client_id!));
        for (const e of entries) {
          e.attempts += 1;
          await outbox.put(e);
        }
        return { kind: 'send', batch: this.toBatch(flying.client_id!, entries, true) };
      }
      const pending = await outbox.index('by_sub_state').getAll(this.stateRange('PENDING'), max);
      if (pending.length === 0) return { kind: 'empty' };
      const meta = (await tx.objectStore('sync_meta').get(this.sub))!;
      if (!this.statusSeen || meta.rejected_past !== null) return { kind: 'status_required' };
      const clientId = this.newClientId();
      for (const [i, e] of pending.entries()) {
        Object.assign(e, { state: 'IN_FLIGHT', client_id: clientId, batch_pos: i, attempts: e.attempts + 1 });
        await outbox.put(e);
      }
      return { kind: 'send', batch: this.toBatch(clientId, pending, false) };
    });
  }

  // Adopt each result's current whole (sync.proto PushResult): over the edit it
  // answers while the facet still holds that edit, else only when newer. A
  // REJECTED owes a fresh Status; an answered batch is never answered twice.
  async recordPush(clientId: string, response: Pick<PushResponse, 'results'>): Promise<OutboxEntry[]> {
    return runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const entries = await tx.objectStore('outbox').index('by_sub_client').getAll(this.clientRange(clientId));
      if (entries.length === 0) throw new PushAnswerError(`unknown batch: ${clientId}`);
      if (entries[0].state !== 'IN_FLIGHT') return entries;
      const { results } = response;
      if (results.length !== entries.length) {
        throw new PushAnswerError(`batch ${clientId} has ${entries.length} events but ${results.length} results`);
      }
      const currents = results.map((r, i) => {
        if (r.facetKey !== entries[i].facet_key) {
          throw new PushAnswerError(`result ${i} facet_key ${r.facetKey} does not echo ${entries[i].facet_key}`);
        }
        if (r.current === undefined) return null;
        const value = toFacetValue(r.current);
        if (value === undefined) throw new PushAnswerError(`result ${i} carries an unreadable current`);
        return value;
      });
      const meta = await this.readMeta(tx);
      for (const [i, entry] of entries.entries()) {
        await this.answer(tx, meta, entry, results[i], currents[i]);
      }
      await this.saveClock(tx, meta);
      return entries;
    });
  }

  // Anchor the clock; rebase on the session's first Status or when a REJECTED edit
  // lies past the sample; then re-mint every unpushed edit past the new present
  // and any REJECTED version_future edit (sync.proto rule 5).
  async onStatus(status: Pick<StatusResponse, 'cursor' | 'serverNowIso' | 'pendingReview'>, rttMs: number): Promise<StatusReport> {
    this.hlc.measure(status.serverNowIso, rttMs);
    const report = await runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const meta = await this.readMeta(tx);
      const rejectedPast = meta.rejected_past !== null && compareVersion(meta.rejected_past, status.serverNowIso) > 0;
      this.rebaseUnsaved = ((!this.statusSeen || rejectedPast) && this.hlc.rebase()) || this.rebaseUnsaved;
      const rebased = this.rebaseUnsaved;
      const reminted = await this.remint(tx, rebased);
      Object.assign(meta, {
        rejected_past: null,
        server_cursor: status.cursor,
        pending_review: Number(status.pendingReview),
        status_at: this.clock.wallMs(),
      });
      await this.saveClock(tx, meta, rebased);
      return { rebased, reminted };
    });
    this.rebaseUnsaved = false;
    this.statusSeen = true;
    return report;
  }

  // ---------------------------------------------------------------- reads

  getFacet(facetKey: string): Promise<FacetRecord | undefined> {
    return this.db.get('facets', [this.sub, facetKey]);
  }

  listFacets(): Promise<FacetRecord[]> {
    return this.db.getAll('facets', this.subRange());
  }

  /** A holding exists while its status is live; count, score and note show only beside it. */
  async getHolding(headId: string): Promise<HoldingView | undefined> {
    const rows = await this.db.getAllFromIndex('facets', 'by_head', IDBKeyRange.only([this.sub, headId]));
    return toHolding(headId, rows);
  }

  async listHoldings(): Promise<HoldingView[]> {
    const rows = await this.db.getAllFromIndex('facets', 'by_head', this.subRange());
    const byHead = new Map<string, FacetRecord[]>();
    for (const r of rows) byHead.set(r.head_id!, [...(byHead.get(r.head_id!) ?? []), r]);
    return [...byHead].flatMap(([head, group]) => toHolding(head, group) ?? []);
  }

  listOutbox(): Promise<OutboxEntry[]> {
    return this.db.getAllFromIndex('outbox', 'by_sub', this.subRange());
  }

  async getMeta(): Promise<SyncMeta> {
    return (await this.db.get('sync_meta', this.sub))!;
  }

  async putProducts(cards: ProductCard[]): Promise<void> {
    const fetchedAt = this.clock.wallMs();
    await runTx(this.db, ['products'], async (tx) => {
      for (const card of cards) {
        const stamps = CARD_TEXTS.map((f) => card[f]?.asOf ?? '').filter(Boolean).sort();
        await tx.objectStore('products').put({ sub: this.sub, head_id: card.headId, card, as_of: stamps.at(-1) ?? null, fetched_at: fetchedAt });
      }
    });
  }

  getProduct(headId: string): Promise<ProductRecord | undefined> {
    return this.db.get('products', [this.sub, headId]);
  }

  listProducts(): Promise<ProductRecord[]> {
    return this.db.getAll('products', this.subRange());
  }

  // Refuses while any edit is unsynced: this device holds its only copy. The auth
  // rows and legacy_pending are not per-sub and stay; this store is spent after.
  async removeLocalData(): Promise<void> {
    await runTx(this.db, ['facets', 'outbox', 'products', 'sync_meta', 'device_key'], async (tx) => {
      const outbox = tx.objectStore('outbox');
      const index = outbox.index('by_sub_state');
      const awaiting = (await index.getAll(this.stateRange('REJECTED'))).filter((e) => e.remint === 'awaiting');
      const unsynced =
        (await index.count(this.stateRange('PENDING'))) + (await index.count(this.stateRange('IN_FLIGHT'))) + awaiting.length;
      if (unsynced > 0) throw new UnsyncedEditsError(unsynced);
      for (const id of await outbox.index('by_sub').getAllKeys(this.subRange())) await outbox.delete(id);
      await tx.objectStore('facets').delete(this.subRange());
      await tx.objectStore('products').delete(this.subRange());
      await tx.objectStore('sync_meta').delete(this.sub);
      await tx.objectStore('device_key').delete(this.sub);
    });
  }

  // ---------------------------------------------------------------- internals

  private subRange(): IDBKeyRange {
    return IDBKeyRange.bound([this.sub], [this.sub, []]);
  }

  private stateRange(state: OutboxState): IDBKeyRange {
    return IDBKeyRange.bound([this.sub, state], [this.sub, state, []]);
  }

  private clientRange(clientId: string): IDBKeyRange {
    return IDBKeyRange.bound([this.sub, clientId], [this.sub, clientId, []]);
  }

  private async readMeta(tx: WriteTx<('sync_meta' | 'facets' | 'outbox')[]>): Promise<SyncMeta> {
    return (await tx.objectStore('sync_meta').get(this.sub))!;
  }

  // Persist the clock with the write it served. A rebase lowers it on purpose;
  // otherwise never below what another tab of this user already stored.
  private async saveClock(tx: WriteTx<('sync_meta' | 'facets' | 'outbox')[]>, meta: SyncMeta, exact = false): Promise<void> {
    const now = toHlcRecord(this.hlc.snapshot());
    meta.hlc = exact ? now : maxHlc(meta.hlc, now);
    meta.offset_ms = this.hlc.offsetMs;
    await tx.objectStore('sync_meta').put(meta);
  }

  private async facet(tx: Stores, facetKey: string): Promise<FacetRecord> {
    return (await tx.objectStore('facets').get([this.sub, facetKey])) ?? emptyFacet(this.sub, facetKey);
  }

  private async mergeInto(tx: Stores, facetKey: string, value: FacetValue): Promise<boolean> {
    const rec = await this.facet(tx, facetKey);
    const { applied, superseded } = mergeRemote(rec, value);
    if (superseded) await this.supersede(tx, facetKey);
    await tx.objectStore('facets').put(rec);
    return applied;
  }

  // A newer remote value replaced the facet's unanswered edits: an unsent one is
  // STALE and never sent; a sent one stays in its frozen batch, flagged.
  private async supersede(tx: Stores, facetKey: string): Promise<void> {
    const outbox = tx.objectStore('outbox');
    for (const state of ['PENDING', 'IN_FLIGHT'] as const) {
      for (const e of await outbox.index('by_sub_state').getAll(this.stateRange(state))) {
        if (e.facet_key !== facetKey) continue;
        e.superseded = true;
        if (state === 'PENDING') e.state = 'STALE';
        await outbox.put(e);
      }
    }
  }

  private async answer(tx: Stores, meta: SyncMeta, entry: OutboxEntry, result: PushResult, current: FacetValue | null): Promise<void> {
    const rec = await this.facet(tx, entry.facet_key);
    const state = STATE_FOR[result.outcome] ?? 'REJECTED';
    const holds = rec.value?.version === entry.edit_version;
    if (current) this.hlc.observe(current.version);
    if (holds) {
      if (current && isNewer(current, rec.known)) rec.known = current;
      // The server holds another write than this edit: it was overwritten.
      if (current && current.version !== entry.edit_version && (state === 'APPLIED' || state === 'STALE')) {
        rec.overwritten = rec.value;
      }
      rec.value = current;
      rec.pending_id = null;
      await tx.objectStore('facets').put(rec);
    } else if (current) {
      await this.mergeInto(tx, entry.facet_key, current);
    }

    entry.state = state;
    entry.outcome = PushOutcome[result.outcome] ?? `UNKNOWN_${result.outcome}`;
    if (result.reason) entry.reason = result.reason;
    if (state === 'REJECTED') {
      if (STATE_FOR[result.outcome] === undefined) entry.reason = 'unknown_outcome';
      if (meta.rejected_past === null || compareVersion(entry.edit_version, meta.rejected_past) > 0) {
        meta.rejected_past = entry.edit_version;
      }
      if (holds && result.reason.split(':')[0].trim() === 'version_future') {
        entry.remint = 'awaiting';
        entry.adopted_version = current?.version ?? null;
      }
    }
    await tx.objectStore('outbox').put(entry);
  }

  // `chain` keeps each facet's latest unanswered version so later edits stay above
  // it. Edits chained on an unanswered push go last: their ticks lift the clock to
  // that push's version, which must not carry the other re-mints past the bound.
  private async remint(tx: Stores, rebased: boolean): Promise<number> {
    const outbox = tx.objectStore('outbox');
    const index = outbox.index('by_sub_state');
    const rejected = (await index.getAll(this.stateRange('REJECTED'))).filter((e) => e.remint === 'awaiting');
    if (rejected.length === 0 && !rebased) return 0;
    const flying = await index.getAll(this.stateRange('IN_FLIGHT'));
    const pending = await index.getAll(this.stateRange('PENDING'));
    const present = toHlcRecord(this.hlc.snapshot());
    const chain = new Map(flying.map((e) => [e.facet_key, e.edit_version]));
    const chainedLast = (e: OutboxEntry) => (chain.has(e.facet_key) ? 1 : 0);
    const order = [...rejected, ...pending].sort((a, b) => chainedLast(a) - chainedLast(b) || a.id! - b.id!);
    let count = 0;
    for (const e of order) {
      const rec = await this.facet(tx, e.facet_key);
      const base = chain.get(e.facet_key) ?? rec.known?.version;
      if (e.state === 'REJECTED') {
        // Re-made only while it is still the facet's latest intent over the adopted current.
        if (rec.pending_id !== null || (rec.value?.version ?? null) !== e.adopted_version) {
          e.remint = 'skipped';
        } else {
          const version = this.hlc.tick(base);
          const id = await outbox.add({
            sub: this.sub,
            facet_key: e.facet_key,
            op: e.op,
            payload: e.payload,
            edit_version: version,
            base_version: base ?? null,
            state: 'PENDING',
            attempts: 0,
            created_at: this.clock.wallMs(),
          });
          rec.value = { version, op: e.op, payload: e.payload };
          rec.pending_id = id;
          await tx.objectStore('facets').put(rec);
          Object.assign(e, { remint: 'done', reminted_as: id });
          chain.set(e.facet_key, version);
          count += 1;
        }
        await outbox.put(e);
        continue;
      }
      // Each edit was minted above its predecessor, so a successor of a past edit is past too.
      if (rebased && isPast(e.edit_version, present)) {
        const version = this.hlc.tick(base);
        if (rec.value?.version === e.edit_version) {
          rec.value = { ...rec.value, version };
          await tx.objectStore('facets').put(rec);
        }
        Object.assign(e, { edit_version: version, base_version: base ?? null });
        await outbox.put(e);
        count += 1;
      }
      chain.set(e.facet_key, e.edit_version);
    }
    return count;
  }

  private toBatch(clientId: string, entries: OutboxEntry[], retry: boolean): Batch {
    const events = entries.map((e) =>
      create(SyncEventSchema, {
        facetKey: e.facet_key,
        version: e.edit_version,
        op: e.op === 'upsert' ? SyncOp.UPSERT : SyncOp.DELETE,
        payload: e.payload,
      }),
    );
    return { clientId, request: create(PushRequestSchema, { clientId, events }), entryIds: entries.map((e) => e.id!), retry };
  }
}

function toHolding(headId: string, rows: FacetRecord[]): HoldingView | undefined {
  const by = new Map(rows.map((r) => [r.field, r]));
  const status = by.get('status');
  if (!isLive(status)) return undefined;
  const view: HoldingView = { head_id: headId, status };
  for (const field of ['count', 'score', 'note'] as const) {
    const rec = by.get(field);
    if (isLive(rec)) view[field] = rec;
  }
  return view;
}
