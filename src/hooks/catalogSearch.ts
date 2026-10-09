// Catalog-wide search in the client (WK-17 B2): CatalogService.SearchProducts, one search at a time.
// A query is sent in the spine's form (NFKC, then trimmed of Unicode White_Space; 2 to 256 code
// points, or one CJK character) once typing pauses; a newer query, going offline or disposing
// cancels the search in flight, and its late answer is never shown. Pages hold at most 50 figures;
// next_page_token is followed on request, and a refused token (the spine's
// TOKEN_EXPIRED_OR_REBASED) restarts from page one. A catalog that cannot answer (unreachable, not
// served yet, signed out, too slow) hides the section without a message; only another error says
// the search failed.
import { Code, ConnectError } from '@connectrpc/connect';
import type { ProductCard, SearchProductsResponse } from '@figurecollecting/fc-api-contract';

export const CATALOG_DEBOUNCE_MS = 300;
/** The contract's cap on a page. */
export const CATALOG_PAGE_SIZE = 50;
/** The spine's bound on a query, in code points of its normalized form. */
export const CATALOG_QUERY_MAX = 256;
export const CATALOG_TIMEOUT_MS = 15_000;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const EDGE_SPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
/** Codes that mean the catalog cannot answer now: the section hides, without a message. */
const QUIET = new Set([Code.Unavailable, Code.Unimplemented, Code.Unauthenticated, Code.FailedPrecondition, Code.DeadlineExceeded]);

/** The query as the spine reads it, or null when it is not one to send. */
export function catalogQuery(input: string): string | null {
  const q = input.normalize('NFKC').replace(EDGE_SPACE, '');
  const points = [...q].length;
  if (points > CATALOG_QUERY_MAX) return null;
  return points >= 2 || CJK.test(q) ? q : null;
}

export type CatalogView =
  | { kind: 'hidden'; reason: 'idle' | 'offline' | 'unavailable' }
  | { kind: 'searching'; query: string }
  | { kind: 'hits'; query: string; hits: ProductCard[]; more: boolean; loadingMore: boolean; moreFailed: boolean }
  | { kind: 'failed'; query: string };

export interface CatalogSearchDeps {
  search(req: { query: string; pageSize: number; pageToken: string }, opts: { signal: AbortSignal }): Promise<SearchProductsResponse>;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

type Outcome = { ok: true; page: SearchProductsResponse } | { ok: false; code: Code };

const realTimers = { setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as number) };

/** At most a page's worth of the figures not already listed, each once. */
function fresh(have: readonly ProductCard[], cards: readonly ProductCard[]): ProductCard[] {
  const seen = new Set(have.map((c) => c.headId));
  const out: ProductCard[] = [];
  for (const c of cards) {
    if (out.length === CATALOG_PAGE_SIZE) break;
    if (seen.has(c.headId)) continue;
    seen.add(c.headId);
    out.push(c);
  }
  return out;
}

export class CatalogSearch {
  #view: CatalogView = { kind: 'hidden', reason: 'idle' };
  readonly #listeners = new Set<(view: CatalogView) => void>();
  readonly #deps: CatalogSearchDeps;
  readonly #timers: NonNullable<CatalogSearchDeps['timers']>;
  #key: string | undefined;
  #token = '';
  #debounce: unknown;
  #inFlight: { abort: AbortController; timeout: unknown } | undefined;
  #disposed = false;

  constructor(deps: CatalogSearchDeps) {
    this.#deps = deps;
    this.#timers = deps.timers ?? realTimers;
  }

  get view(): CatalogView {
    return this.#view;
  }

  subscribe(listener: (view: CatalogView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The text in the search field and whether the catalog can be reached. */
  set(input: string, online: boolean): void {
    if (this.#disposed) return;
    const query = catalogQuery(input);
    const key = `${online ? 1 : 0}${query ?? ''}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#cancel();
    if (query === null) return this.#show({ kind: 'hidden', reason: 'idle' });
    if (!online) return this.#show({ kind: 'hidden', reason: 'offline' });
    this.#show({ kind: 'searching', query });
    this.#debounce = this.#timers.setTimeout(() => {
      this.#debounce = undefined;
      void this.#first(query);
    }, CATALOG_DEBOUNCE_MS);
  }

  /** The next page, when the last one said there are more. */
  more(): void {
    const v = this.#view;
    if (v.kind !== 'hits' || !v.more || v.loadingMore) return;
    this.#show({ ...v, loadingMore: true, moreFailed: false });
    void this.#next(v.query);
  }

  /** Search again after a failure. */
  retry(): void {
    const v = this.#view;
    if (v.kind !== 'failed') return;
    this.#show({ kind: 'searching', query: v.query });
    void this.#first(v.query);
  }

  dispose(): void {
    this.#disposed = true;
    this.#cancel();
    this.#listeners.clear();
  }

  async #first(query: string): Promise<void> {
    const got = await this.#fetch(query, '');
    if (got === undefined) return;
    if (!got.ok) return this.#show(QUIET.has(got.code) ? { kind: 'hidden', reason: 'unavailable' } : { kind: 'failed', query });
    this.#page(query, [], got.page);
  }

  async #next(query: string): Promise<void> {
    const got = await this.#fetch(query, this.#token);
    if (got === undefined) return;
    const v = this.#view as Extract<CatalogView, { kind: 'hits' }>;
    if (got.ok) return this.#page(query, v.hits, got.page);
    if (got.code !== Code.InvalidArgument) return this.#show({ ...v, loadingMore: false, moreFailed: true });
    // The token is stale (the spine's keyset was rebased): start again from page one.
    const restart = await this.#fetch(query, '');
    if (restart === undefined) return;
    if (!restart.ok) return this.#show({ kind: 'failed', query });
    this.#page(query, [], restart.page);
  }

  #page(query: string, have: ProductCard[], page: SearchProductsResponse): void {
    this.#token = page.nextPageToken;
    this.#show({ kind: 'hits', query, hits: [...have, ...fresh(have, page.products)], more: page.nextPageToken !== '', loadingMore: false, moreFailed: false });
  }

  /** One request; undefined when it was cancelled (a newer query, offline, disposed). */
  async #fetch(query: string, pageToken: string): Promise<Outcome | undefined> {
    const abort = new AbortController();
    const timeout = this.#timers.setTimeout(() => abort.abort(new ConnectError('catalog search timed out', Code.DeadlineExceeded)), CATALOG_TIMEOUT_MS);
    const mine = { abort, timeout };
    this.#inFlight = mine;
    let outcome: Outcome;
    try {
      outcome = { ok: true, page: await this.#deps.search({ query, pageSize: CATALOG_PAGE_SIZE, pageToken }, { signal: abort.signal }) };
    } catch (err) {
      outcome = { ok: false, code: ConnectError.from(err).code };
    }
    this.#timers.clearTimeout(timeout);
    if (this.#inFlight !== mine) return undefined;
    this.#inFlight = undefined;
    // Our own timeout aborted it: the catalog was too slow, which hides the section quietly.
    if (abort.signal.aborted) return { ok: false, code: Code.DeadlineExceeded };
    return outcome;
  }

  #cancel(): void {
    if (this.#debounce !== undefined) this.#timers.clearTimeout(this.#debounce);
    this.#debounce = undefined;
    const flight = this.#inFlight;
    this.#inFlight = undefined;
    if (flight === undefined) return;
    this.#timers.clearTimeout(flight.timeout);
    flight.abort.abort();
  }

  #show(view: CatalogView): void {
    this.#view = view;
    for (const l of this.#listeners) l(view);
  }
}
