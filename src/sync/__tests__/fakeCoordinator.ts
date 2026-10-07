// An in-memory coordinator.v1 SyncService and CatalogService for the engine tests, after the
// contract's server model: per-facet LWW on the bytewise version order, one feed transaction per
// Push whose last event carries commit_cursor (rule 7), receipts that answer a replayed client_id
// with the recorded outcomes (APPLIED as DUPLICATE), basis required, version_future past now + 5 min.
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  DeltaResponseSchema,
  GetProductsResponseSchema,
  MAX_FUTURE_SKEW_MS,
  ProductCardSchema,
  PushOutcome,
  PushResponseSchema,
  PushResultSchema,
  StatusResponseSchema,
  SyncEventSchema,
  SyncOp,
  compareVersion,
  parseVersion,
  type DeltaResponse,
  type GetProductsResponse,
  type ProductCard,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type StatusResponse,
  type SyncEvent,
} from '@figurecollecting/fc-api-contract';
import type { CatalogCalls, SyncCalls } from '../engine';
import { iso } from './harness';

interface Stored {
  facetKey: string;
  version: string;
  op: SyncOp;
  payload: string;
}

interface FeedRow extends Stored {
  seq: number;
  commits: boolean;
}

type Rpc = 'status' | 'delta' | 'push' | 'getProducts';

/** What the next call of an rpc does instead of answering. */
export type Fault =
  /** Answer normally (a placeholder to fault a later call). */
  | { kind: 'pass' }
  | { kind: 'throw'; error: unknown }
  /** The server does the work, then the reply is lost (a dropped response). */
  | { kind: 'drop' }
  /** The call never answers until its signal aborts. */
  | { kind: 'hang' };

export interface CallLog {
  rpc: Rpc;
  request: unknown;
}

const encode = (seq: number): string => `c${seq}`;

function decode(cursor: string): number | undefined {
  if (cursor === '') return 0;
  const m = /^c(\d+)$/.exec(cursor);
  return m === null ? undefined : Number(m[1]);
}

const toEvent = (s: Stored, commitCursor = ''): SyncEvent =>
  create(SyncEventSchema, { facetKey: s.facetKey, version: s.version, op: s.op, payload: s.payload, commitCursor });

function aborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new ConnectError('the call was aborted', Code.Canceled));
    if (signal?.aborted) fail();
    signal?.addEventListener('abort', fail, { once: true });
  });
}

export class FakeCoordinator {
  /** Server wall clock (ms); every Status samples it. */
  now: number;
  readonly facets = new Map<string, Stored>();
  readonly feed: FeedRow[] = [];
  readonly receipts = new Map<string, { events: string; results: PushResult[] }>();
  readonly calls: CallLog[] = [];
  readonly products = new Map<string, ProductCard>();
  /** Redirects: a merged head id answers with its survivor's card. */
  readonly redirects = new Map<string, string>();
  private readonly faults = new Map<Rpc, Fault[]>();

  constructor(now: number) {
    this.now = now;
  }

  /** Queue a fault for the next call(s) of `rpc`, in order. */
  fault(rpc: Rpc, ...faults: Fault[]): void {
    this.faults.set(rpc, [...(this.faults.get(rpc) ?? []), ...faults]);
  }

  seedProducts(heads: string[]): void {
    for (const h of heads) {
      this.products.set(h, create(ProductCardSchema, { headId: h, requestedAs: [{ ref: { case: 'headId', value: h } }], title: { value: `Figure ${h.slice(0, 8)}`, asOf: iso(this.now) } }));
    }
  }

  /** A server transaction of its own (another device, the import): applied by LWW, one commit marker. */
  write(events: Stored[]): void {
    const rows: Stored[] = [];
    for (const e of events) if (this.lww(e)) rows.push(e);
    this.append(rows);
  }

  count(rpc: Rpc): number {
    return this.calls.filter((c) => c.rpc === rpc).length;
  }

  readonly sync: SyncCalls = {
    status: (req, opts) => this.call('status', req, opts?.signal, () => this.status()),
    delta: (req, opts) => this.call('delta', req, opts?.signal, () => this.delta(req.cursor ?? '', req.limit ?? 0)),
    push: (req, opts) => this.call('push', req, opts?.signal, () => this.push(req as PushRequest)),
  };

  readonly catalog: CatalogCalls = {
    getProducts: (req, opts) =>
      this.call('getProducts', req, opts?.signal, () => this.getProducts((req.refs ?? []).map((r) => (r.ref as { value: string }).value))),
  };

  private async call<T>(rpc: Rpc, request: unknown, signal: AbortSignal | undefined, answer: () => T): Promise<T> {
    this.calls.push({ rpc, request });
    await Promise.resolve();
    const fault = this.faults.get(rpc)?.shift();
    if (fault?.kind === 'hang') return aborted(signal);
    if (fault?.kind === 'throw') throw fault.error;
    const out = answer();
    if (fault?.kind === 'drop') throw new ConnectError('connection reset after the server answered', Code.Unavailable);
    return out;
  }

  private status(): StatusResponse {
    return create(StatusResponseSchema, { cursor: encode(this.feed.at(-1)?.seq ?? 0), serverNowIso: iso(this.now), pendingReview: 0n });
  }

  private delta(cursor: string, limit: number): DeltaResponse {
    const after = decode(cursor);
    if (after === undefined || after > (this.feed.at(-1)?.seq ?? 0)) {
      throw new ConnectError('unreadable cursor: replay from an empty cursor', Code.InvalidArgument);
    }
    const size = limit === 0 ? 500 : limit;
    const rest = this.feed.filter((r) => r.seq > after);
    const page = rest.slice(0, size);
    return create(DeltaResponseSchema, {
      events: page.map((r) => toEvent(r, r.commits ? encode(r.seq) : '')),
      nextCursor: encode(page.at(-1)?.seq ?? after),
      hasMore: rest.length > page.length,
    });
  }

  private push(req: PushRequest): PushResponse {
    const fingerprint = JSON.stringify(req.events.map((e) => [e.facetKey, e.version, e.op, e.payload, e.basis ?? null]));
    const receipt = this.receipts.get(req.clientId);
    if (receipt !== undefined) {
      if (receipt.events !== fingerprint) throw new ConnectError('client_id was already used for a different batch', Code.InvalidArgument);
      return create(PushResponseSchema, {
        results: receipt.results.map((r) => {
          const current = this.facets.get(r.facetKey);
          return create(PushResultSchema, {
            facetKey: r.facetKey,
            outcome: r.outcome === PushOutcome.APPLIED ? PushOutcome.DUPLICATE : r.outcome,
            reason: r.reason,
            version: current?.version ?? '',
            ...(current === undefined ? {} : { current: toEvent(current) }),
          });
        }),
      });
    }
    const results: PushResult[] = [];
    const rows: Stored[] = [];
    const bound = this.now + MAX_FUTURE_SKEW_MS;
    for (const e of req.events) {
      const stored: Stored = { facetKey: e.facetKey, version: e.version, op: e.op, payload: e.payload };
      const at = parseVersion(e.version);
      let reason = '';
      if (at === undefined || at.deviceId === null) reason = 'version_malformed';
      else if (Number(at.micros / 1000n) > bound) reason = 'version_future';
      else if (e.basis === undefined) reason = 'basis_missing';
      let outcome: PushOutcome;
      if (reason !== '') outcome = PushOutcome.REJECTED;
      else if (this.lww(stored)) {
        outcome = PushOutcome.APPLIED;
        rows.push(stored);
      } else outcome = PushOutcome.STALE;
      const current = this.facets.get(e.facetKey);
      results.push(
        create(PushResultSchema, {
          facetKey: e.facetKey,
          outcome,
          reason,
          version: current?.version ?? '',
          ...(current === undefined ? {} : { current: toEvent(current) }),
        }),
      );
    }
    this.append(rows);
    this.receipts.set(req.clientId, { events: fingerprint, results });
    return create(PushResponseSchema, { results });
  }

  private getProducts(heads: string[]): GetProductsResponse {
    if (heads.length > 200) throw new ConnectError('at most 200 refs per call', Code.InvalidArgument);
    const products: ProductCard[] = [];
    const unresolved = [];
    for (const h of heads) {
      const card = this.products.get(this.redirects.get(h) ?? h);
      if (card === undefined) unresolved.push({ ref: { case: 'headId' as const, value: h } });
      else
        products.push(
          create(ProductCardSchema, { ...card, requestedAs: [...card.requestedAs, ...(card.headId === h ? [] : [{ ref: { case: 'headId' as const, value: h } }])] }),
        );
    }
    return create(GetProductsResponseSchema, { products, unresolved });
  }

  private lww(e: Stored): boolean {
    const held = this.facets.get(e.facetKey);
    if (held !== undefined && compareVersion(e.version, held.version) <= 0) return false;
    this.facets.set(e.facetKey, e);
    return true;
  }

  private append(rows: Stored[]): void {
    let seq = this.feed.at(-1)?.seq ?? 0;
    rows.forEach((r, i) => this.feed.push({ ...r, seq: ++seq, commits: i === rows.length - 1 }));
  }
}
