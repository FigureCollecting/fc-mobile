// One signed-in user's view of the v3 local store. Every key starts with the
// sub bound here, so nothing this object does can read or write another
// user's rows. Network-free: Status and Push answers are handed in.
import { create } from '@bufbuild/protobuf';
import {
  Hlc,
  PushOutcome,
  PushRequestSchema,
  SyncEventSchema,
  SyncOp,
  collNameKey,
  compareVersion,
  normaliseDeviceId,
  occFacetKey,
  occTagKey,
  parseCollectionRef,
  parseUserFacetKey,
  tagNameKey,
  ufKindTagKey,
  ufTagKey,
  type CollectionKind,
  type HlcClock,
  type OccurrenceStatus,
  type ProductCard,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type StatusResponse,
} from '@figurecollecting/fc-api-contract';
import type { LocalDb } from './localDb';
import type { FacetRecord, FacetValue, OutboxEntry, OutboxState, ProductRecord, SyncMeta } from './records';
import { readTx, runTx, type WriteTx } from './tx';
import { buildPayload, deviceTimeZone } from '../sync/payload';
import { emptyFacet, floorOf, isNewer, mergeRemote, show, toFacetValue, type RemoteEvent } from '../sync/facetMerge';
import { indexFacet } from '../sync/facetIndex';
import { ZERO_HLC, isPast, maxHlc, toHlcRecord, toHlcState } from '../sync/hlcState';
import { buildView, pickCopy, shownCopies, type CopyView, type LocalView } from '../sync/occurrences';

export { LocalWriteError } from './tx';
export type { RemoteEvent } from '../sync/facetMerge';

export interface UserStoreOptions {
  sub: string;
  /** The DPoP-enrolled device's uuid (dashed or not); the HLC suffix of every edit. */
  deviceId: string;
  clock?: HlcClock;
  timeZone?: () => string | undefined;
  newClientId?: () => string;
  /** Mints occurrence, collection and tag ids: lowercase dashed uuids. */
  newId?: () => string;
}

/** One facet write of an intent: the payload's own fields, or null for a tombstone. */
export interface FacetWrite {
  key: string;
  fields: Record<string, unknown> | null;
}

/** A copy named by its id, or one of a figure's identical copies of a kind, optionally where it is shown. */
/** Why and when a copy left (occ-disposal.schema.json); edited_at and tz are the store's to stamp. */
export interface Disposal {
  reason: 'sold' | 'traded' | 'gifted' | 'damaged' | 'lost' | 'stolen' | 'other';
  on?: string;
  note?: string;
  counterparty?: string;
  price?: { amount: string; currency: string };
}

export type CopyTarget = { occ_id: string } | { head_id: string; kind: OccurrenceStatus; shown_in?: string };

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

export type IntentErrorCode = 'no_copy' | 'kind_mismatch' | 'no_collection' | 'no_tag';

/** An intent this store's view cannot carry out; nothing of it was written. */
export class IntentError extends Error {
  readonly code: IntentErrorCode;

  constructor(code: IntentErrorCode, message: string) {
    super(message);
    this.name = 'IntentError';
    this.code = code;
  }
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

// A collection a copy of `kind` may be filed in: one that exists and holds that kind.
function checkFiling(view: LocalView, ref: string, kind: OccurrenceStatus): void {
  const parsed = parseCollectionRef(ref);
  if (parsed !== undefined && parsed.kind !== kind) throw new IntentError('kind_mismatch', `${ref} does not hold ${kind} copies`);
  if (parsed === undefined || !view.collections.some((c) => c.ref === ref)) throw new IntentError('no_collection', `no collection ${ref}`);
}

const shownCopy = (view: LocalView, occId: string): CopyView | undefined =>
  view.copies.find((c) => c.occ_id === occId && c.shown_in !== null);

function knownCopy(view: LocalView, occId: string): CopyView {
  const copy = view.copies.find((c) => c.occ_id === occId);
  if (copy === undefined) throw new IntentError('no_copy', `no copy ${occId}`);
  return copy;
}

function needTag(view: LocalView, tagId: string, on: boolean): void {
  if (on && !view.tags.has(tagId)) throw new IntentError('no_tag', `no tag ${tagId}`);
}

// The writes that give a copy `status`: the status, and the filing whenever the kind changes
// (a removed copy's kind is its filing's, so an undo restores it whole) or a filing is asked for.
function statusWrites(view: LocalView, copy: CopyView, status: OccurrenceStatus, collection?: string): FacetWrite[] {
  const writes: FacetWrite[] = [{ key: occFacetKey(copy.occ_id, 'status'), fields: { status } }];
  const was = copy.status ?? (copy.filed === null ? null : parseCollectionRef(copy.filed)!.kind);
  if (collection !== undefined) checkFiling(view, collection, status);
  if (collection !== undefined || was !== status) {
    writes.push({ key: occFacetKey(copy.occ_id, 'collection'), fields: { collection: collection ?? `${status}/default` } });
  }
  return writes;
}

type Stores = WriteTx<('facets' | 'outbox' | 'sync_meta')[]>;

export class UserStore {
  readonly sub: string;
  readonly deviceId: string;
  private readonly db: LocalDb;
  private readonly hlc: Hlc;
  private readonly clock: HlcClock;
  private readonly timeZone?: () => string | undefined;
  private readonly newClientId: () => string;
  private readonly newId: () => string;
  private statusSeen = false;
  // rebase() lowers the in-memory clock at once. Until a Status transaction that
  // carries it commits, its re-mint and exact save stay owed, so an abort cannot drop them.
  private rebaseUnsaved = false;

  private constructor(db: LocalDb, opts: UserStoreOptions, meta: SyncMeta) {
    this.db = db;
    this.sub = opts.sub;
    this.deviceId = meta.device_id;
    this.clock = opts.clock ?? systemClock;
    this.timeZone = opts.timeZone;
    this.newClientId = opts.newClientId ?? (() => crypto.randomUUID());
    this.newId = opts.newId ?? (() => crypto.randomUUID());
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

  /** Write one user-owned facet: the payload's own fields, or null for a tombstone. */
  async writeFacet(facetKey: string, fields: Record<string, unknown> | null): Promise<WriteResult> {
    const [res] = await this.mutate(() => [{ key: facetKey, fields }]);
    return res;
  }

  // ---------------------------------------------------------------- intents
  // Each intent reads the view and writes in one transaction, as one outbox group
  // that one Push batch carries whole. Picks go by occurrence id alone.

  /** A new copy: its head written with its first status, and its filing when one is given. */
  async createCopy(headId: string, status: OccurrenceStatus, opts: { collection?: string } = {}): Promise<string> {
    const occ = this.newId();
    await this.mutate((view) => {
      const writes: FacetWrite[] = [
        { key: occFacetKey(occ, 'head'), fields: { head_id: headId } },
        { key: occFacetKey(occ, 'status'), fields: { status } },
      ];
      if (opts.collection !== undefined) {
        checkFiling(view, opts.collection, status);
        writes.push({ key: occFacetKey(occ, 'collection'), fields: { collection: opts.collection } });
      }
      return writes;
    });
    return occ;
  }

  /** Remove a copy (soft: its status is tombstoned; head and filing stay for an undo). The highest of N. */
  async removeCopy(target: CopyTarget): Promise<string | undefined> {
    let picked: string | undefined;
    await this.mutate((view) => {
      const copy = 'occ_id' in target ? shownCopy(view, target.occ_id) : pickCopy(view, target, 'remove');
      picked = copy?.occ_id;
      return copy === undefined ? [] : [{ key: occFacetKey(copy.occ_id, 'status'), fields: null }];
    });
    return picked;
  }

  /** Give a copy a status (an undo of a removal included), with its filing when the kind changes. */
  async setStatus(occId: string, status: OccurrenceStatus, opts: { collection?: string } = {}): Promise<void> {
    await this.mutate((view) => {
      const copy = knownCopy(view, occId);
      if (copy.hidden !== null || copy.head_id === null) throw new IntentError('no_copy', `copy ${occId} is not shown`);
      return statusWrites(view, copy, status, opts.collection);
    });
  }

  /** An ordered copy arrived: status owned and its filing, in one batch. The lowest of N. */
  async markArrived(target: { occ_id: string } | { head_id: string; shown_in?: string }, opts: { collection?: string } = {}): Promise<string | undefined> {
    let picked: string | undefined;
    await this.mutate((view) => {
      let copy: CopyView | undefined;
      if ('occ_id' in target) {
        copy = shownCopy(view, target.occ_id);
        if (copy === undefined) throw new IntentError('no_copy', `no copy ${target.occ_id}`);
        if (copy.status !== 'ordered') throw new IntentError('kind_mismatch', `copy ${target.occ_id} is ${copy.status}, not ordered`);
      } else {
        copy = pickCopy(view, { ...target, kind: 'ordered' }, 'receive');
      }
      picked = copy?.occ_id;
      return copy === undefined ? [] : statusWrites(view, copy, 'owned', opts.collection);
    });
    return picked;
  }

  /** File a shown copy in another collection of its kind. */
  async moveCopy(occId: string, collection: string): Promise<void> {
    await this.mutate((view) => {
      const copy = shownCopy(view, occId);
      if (copy === undefined) throw new IntentError('no_copy', `copy ${occId} is not shown`);
      checkFiling(view, collection, copy.status!);
      return [{ key: occFacetKey(occId, 'collection'), fields: { collection } }];
    });
  }

  /** Bulk 'Move N copies to…': file each shown copy in `collection`, changing its status when the kind differs. */
  async moveCopies(occIds: string[], collection: string): Promise<void> {
    await this.mutate((view) => {
      const kind = parseCollectionRef(collection)?.kind;
      if (kind === undefined) throw new IntentError('no_collection', `no collection ${collection}`);
      checkFiling(view, collection, kind);
      return occIds.flatMap((occId) => {
        const copy = shownCopy(view, occId);
        if (copy === undefined) throw new IntentError('no_copy', `copy ${occId} is not shown`);
        return copy.status === kind ? [{ key: occFacetKey(occId, 'collection'), fields: { collection } }] : statusWrites(view, copy, kind, collection);
      });
    });
  }

  /** 'Mark sold/traded/gifted/…': status former, its filing and the disposal of each shown copy. */
  async markFormer(occIds: string[], disposal: Disposal): Promise<void> {
    await this.mutate((view) =>
      occIds.flatMap((occId) => {
        const copy = shownCopy(view, occId);
        if (copy === undefined) throw new IntentError('no_copy', `copy ${occId} is not shown`);
        return [...statusWrites(view, copy, 'former'), { key: occFacetKey(occId, 'disposal'), fields: { ...disposal } }];
      }),
    );
  }

  /** Dedupe: remove every shown copy of a figure and kind but the lowest (the one PICKS keeps). */
  async dedupe(headId: string, kind: OccurrenceStatus): Promise<string[]> {
    let removed: string[] = [];
    await this.mutate((view) => {
      removed = shownCopies(view, { head_id: headId, kind })
        .slice(1)
        .map((c) => c.occ_id);
      return removed.map((occ) => ({ key: occFacetKey(occ, 'status'), fields: null }));
    });
    return removed;
  }

  /** Point a copy at another figure (a wrong-variant fix, an un-merge) with one write of its head. */
  async repointCopy(occId: string, headId: string): Promise<void> {
    await this.mutate((view) => {
      knownCopy(view, occId);
      return [{ key: occFacetKey(occId, 'head'), fields: { head_id: headId } }];
    });
  }

  /** A new user collection of a kind. */
  async createCollection(kind: CollectionKind, name: string): Promise<string> {
    const id = this.newId();
    await this.writeFacet(collNameKey(kind, id), { name });
    return id;
  }

  /** A new tag. */
  async createTag(name: string): Promise<string> {
    const id = this.newId();
    await this.writeFacet(tagNameKey(id), { name });
    return id;
  }

  /** Tag (or untag) one copy. */
  async tagCopy(occId: string, tagId: string, on = true): Promise<void> {
    await this.mutate((view) => {
      knownCopy(view, occId);
      needTag(view, tagId, on);
      return [{ key: occTagKey(occId, tagId), fields: on ? {} : null }];
    });
  }

  /** Tag (or untag) a figure as a whole, with or without copies. */
  async tagFigure(headId: string, tagId: string, on = true): Promise<void> {
    await this.mutate((view) => {
      needTag(view, tagId, on);
      return [{ key: ufTagKey(headId, tagId), fields: on ? {} : null }];
    });
  }

  /** Tag (or untag) every copy of a figure whose status is `kind`, evaluated when read. */
  async tagFigureKind(headId: string, kind: CollectionKind, tagId: string, on = true): Promise<void> {
    await this.mutate((view) => {
      needTag(view, tagId, on);
      return [{ key: ufKindTagKey(headId, kind, tagId), fields: on ? {} : null }];
    });
  }

  /** The user has seen the 'replaced by another device' notice on this facet. */
  async dismissReplaced(facetKey: string): Promise<void> {
    await runTx(this.db, ['facets'], async (tx) => {
      const rec = await tx.objectStore('facets').get([this.sub, facetKey]);
      if (rec === undefined) return;
      rec.overwritten = null;
      await tx.objectStore('facets').put(rec);
    });
  }

  // The facets, their outbox entries (one group) and the HLC state commit together:
  // a reload never sees one without the others, and a failure (quota, a refused
  // payload or intent included) leaves no edit that looks applied.
  private async mutate(plan: (view: LocalView) => FacetWrite[]): Promise<WriteResult[]> {
    const at = new Date(this.clock.wallMs());
    const tz = deviceTimeZone(this.timeZone);
    return runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const meta = await this.readMeta(tx);
      // A plain write needs no view; an intent reads every row of this user.
      const rows = plan.length === 0 ? [] : await tx.objectStore('facets').getAll(this.subRange());
      const writes = plan(buildView(rows));
      const out: WriteResult[] = [];
      let group: number | undefined;
      for (const { key, fields } of writes) {
        const parsed = parseUserFacetKey(key);
        if (parsed === undefined) throw new TypeError(`not a user-owned facet key: ${JSON.stringify(key)}`);
        const op = fields === null ? 'delete' : 'upsert';
        const payload = fields === null ? '' : buildPayload(parsed.family, fields, at, tz);
        const rec = await this.facet(tx, key);
        const base = floorOf(rec);
        // The facet floor: the edit lands above every version this device holds for it.
        const version = this.hlc.tick(base);
        const entry: OutboxEntry = {
          sub: this.sub,
          facet_key: key,
          op,
          payload,
          edit_version: version,
          base_version: base ?? null,
          basis: meta.cursor,
          state: 'PENDING',
          attempts: 0,
          created_at: at.getTime(),
          ...(group !== undefined && { group }),
        };
        const id = await tx.objectStore('outbox').add(entry);
        if (group === undefined) {
          group = id;
          await tx.objectStore('outbox').put({ ...entry, id, group });
        }
        rec.value = { version, op, payload };
        rec.pending_id = id;
        rec.overwritten = null;
        await tx.objectStore('facets').put(indexFacet(rec));
        out.push({ facet_key: key, version, outbox_id: id });
      }
      await this.saveClock(tx, meta);
      return out;
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

  /**
   * A replay from an empty cursor (sync.proto rule 7: the recovery for an unreadable cursor): the
   * replica becomes exactly what the replayed events give by LWW over nothing, a facet the replay
   * does not carry holds nothing, and every unanswered edit stays laid over it. One transaction, so
   * nothing in between is ever shown; a replay presents nothing again, so it records no notice.
   */
  async replaceReplica(events: RemoteEvent[], cursor: string): Promise<ApplyReport> {
    return runTx(this.db, ['facets', 'outbox', 'sync_meta'], async (tx) => {
      const meta = await this.readMeta(tx);
      const report: ApplyReport = { applied: 0, dropped: 0, refused: [] };
      const replica = new Map<string, FacetValue>();
      for (const event of events) {
        const value = toFacetValue(event);
        if (value === undefined) {
          report.refused.push(event);
          continue;
        }
        this.hlc.observe(value.version);
        if (isNewer(value, replica.get(event.facetKey) ?? null)) {
          replica.set(event.facetKey, value);
          report.applied += 1;
        } else {
          report.dropped += 1;
        }
      }
      const facets = tx.objectStore('facets');
      for (const rec of await facets.getAll(this.subRange())) {
        rec.known = replica.get(rec.facet_key) ?? null;
        replica.delete(rec.facet_key);
        if (rec.pending_id === null) rec.value = rec.known;
        await facets.put(indexFacet(rec));
      }
      for (const [facetKey, value] of replica) {
        await facets.put(indexFacet({ ...emptyFacet(this.sub, facetKey), known: value, value }));
      }
      meta.cursor = cursor;
      await this.saveClock(tx, meta);
      return report;
    });
  }

  // ---------------------------------------------------------------- outbox

  /** The user has seen these REJECTED edits: they stay in the outbox, marked dismissed. */
  async dismissRejected(ids: number[]): Promise<void> {
    await runTx(this.db, ['outbox'], async (tx) => {
      const outbox = tx.objectStore('outbox');
      for (const id of ids) {
        const entry = await outbox.get(id);
        if (entry?.sub !== this.sub || entry.state !== 'REJECTED') continue;
        entry.dismissed = true;
        await outbox.put(entry);
      }
    });
  }

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
      const queued = await outbox.index('by_sub_state').getAll(this.stateRange('PENDING'));
      if (queued.length === 0) return { kind: 'empty' };
      const meta = (await tx.objectStore('sync_meta').get(this.sub))!;
      if (!this.statusSeen || meta.rejected_past !== null) return { kind: 'status_required' };
      const pending = queued.slice(0, batchEnd(queued, max));
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
    return readTx(this.db, ['facets'], (tx) => tx.objectStore('facets').get([this.sub, facetKey]));
  }

  listFacets(): Promise<FacetRecord[]> {
    return readTx(this.db, ['facets'], (tx) => tx.objectStore('facets').getAll(this.subRange()));
  }

  /** The derived view (occurrences, collections, tags, library) over what the UI shows. */
  async getView(): Promise<LocalView> {
    return buildView(await this.listFacets());
  }

  listOutbox(): Promise<OutboxEntry[]> {
    return readTx(this.db, ['outbox'], (tx) => tx.objectStore('outbox').index('by_sub').getAll(this.subRange()));
  }

  async getMeta(): Promise<SyncMeta> {
    return (await readTx(this.db, ['sync_meta'], (tx) => tx.objectStore('sync_meta').get(this.sub)))!;
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
    return readTx(this.db, ['products'], (tx) => tx.objectStore('products').get([this.sub, headId]));
  }

  listProducts(): Promise<ProductRecord[]> {
    return readTx(this.db, ['products'], (tx) => tx.objectStore('products').getAll(this.subRange()));
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

  // A newer remote value goes to the replica; an unanswered edit on the facet stays
  // shown and is still pushed, for the server to decide (sync.proto rule 6).
  private async mergeInto(tx: Stores, facetKey: string, value: FacetValue): Promise<boolean> {
    const rec = await this.facet(tx, facetKey);
    const applied = mergeRemote(rec, value, this.deviceId);
    await tx.objectStore('facets').put(rec);
    return applied;
  }

  private async answer(tx: Stores, meta: SyncMeta, entry: OutboxEntry, result: PushResult, current: FacetValue | null): Promise<void> {
    const rec = await this.facet(tx, entry.facet_key);
    const state = STATE_FOR[result.outcome] ?? 'REJECTED';
    const holds = rec.value?.version === entry.edit_version;
    if (current) this.hlc.observe(current.version);
    if (holds) {
      // The answered edit leaves the overlay: the display is the replica, `current` folded in.
      if (current && isNewer(current, rec.known)) rec.known = current;
      rec.pending_id = null;
      // A REVIEW or REJECTED edit was not lost to another device: no notice.
      if (state === 'APPLIED' || state === 'STALE') {
        show(rec, rec.known, this.deviceId);
      } else {
        rec.value = rec.known;
        indexFacet(rec);
      }
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
    // A re-minted intent stays one group (a kind change keeps its filing in its batch): each
    // original group maps to the id of its first re-mint.
    const regrouped = new Map<number, number>();
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
          const origin = e.group ?? e.id!;
          const group = regrouped.get(origin);
          const entry: OutboxEntry = {
            sub: this.sub,
            facet_key: e.facet_key,
            op: e.op,
            payload: e.payload,
            edit_version: version,
            base_version: base ?? null,
            // The basis the edit was made on, whatever was pulled since.
            basis: e.basis,
            state: 'PENDING',
            attempts: 0,
            created_at: this.clock.wallMs(),
            ...(group !== undefined && { group }),
          };
          const id = await outbox.add(entry);
          if (group === undefined) {
            regrouped.set(origin, id);
            await outbox.put({ ...entry, id, group: id });
          }
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
        basis: e.basis,
      }),
    );
    return { clientId, request: create(PushRequestSchema, { clientId, events }), entryIds: entries.map((e) => e.id!), retry };
  }
}

// How many queued entries the next batch takes: up to `max`, never splitting a group. A
// group the limit would cut goes to the next batch, or whole and alone when it is first.
function batchEnd(queued: OutboxEntry[], max: number): number {
  let end = Math.min(max, queued.length);
  const group = queued[end]?.group;
  if (group === undefined) return end;
  while (end > 0 && queued[end - 1].group === group) end -= 1;
  if (end > 0) return end;
  while (end < queued.length && queued[end].group === group) end += 1;
  return end;
}
