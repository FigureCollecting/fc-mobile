// Catalog-wide search in the client (WK-17 B2): CatalogService.SearchProducts through a real Connect
// client over an in-memory router transport (the coordinator's pass-through is built in parallel).
// Debounced, one search in flight (a newer query or going offline cancels it), the query in the
// spine's form (NFKC, then trimmed of Unicode White_Space) and bounds, pages of at most 50, a stale
// page token restarting from page one, and the quiet failures that hide the section.
import { afterEach, describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createClient, createRouterTransport, type HandlerContext } from '@connectrpc/connect';
import {
  CatalogService,
  ProductCardSchema,
  SearchProductsResponseSchema,
  type ProductCard,
  type SearchProductsRequest,
  type SearchProductsResponse,
} from '@figurecollecting/fc-api-contract';
import { CATALOG_DEBOUNCE_MS, CATALOG_PAGE_SIZE, CATALOG_QUERY_MAX, CATALOG_TIMEOUT_MS, CatalogSearch, catalogQuery, type CatalogView } from '../catalogSearch';
import { ManualTimers, headOf } from '../../sync/__tests__/engineSupport';

interface Pending {
  req: SearchProductsRequest;
  signal: AbortSignal;
  answer: (res: SearchProductsResponse) => void;
  fail: (err: unknown) => void;
}

/** A coordinator whose SearchProducts answers when the test says so. */
function fakeCatalog() {
  const pending: Pending[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(CatalogService, {
      searchProducts: (req: SearchProductsRequest, ctx: HandlerContext) =>
        new Promise<SearchProductsResponse>((answer, fail) => {
          pending.push({ req, signal: ctx.signal, answer, fail });
        }),
    });
  });
  return { pending, client: createClient(CatalogService, transport) };
}

const card = (i: number, title = `Figure ${i}`): ProductCard => create(ProductCardSchema, { headId: headOf(i), title: { value: title, asOf: '' } });
const page = (cards: ProductCard[], nextPageToken = '') => create(SearchProductsResponseSchema, { products: cards, nextPageToken });

let live: CatalogSearch | undefined;
afterEach(() => live?.dispose());

function setup() {
  const fake = fakeCatalog();
  const timers = new ManualTimers();
  const views: CatalogView[] = [];
  const search = new CatalogSearch({ search: (req, opts) => fake.client.searchProducts(req, opts), timers });
  search.subscribe((v) => views.push(v));
  live = search;
  /** Fire the pending timers of one delay (the debounce or the request timeout). */
  const fire = (ms: number) => {
    for (const [id, t] of [...timers.pending]) {
      if (t.ms !== ms) continue;
      timers.pending.delete(id);
      t.fn();
    }
  };
  /** Wait until `n` searches reached the fake server. */
  const reached = async (n: number) => {
    for (let i = 0; i < 50 && fake.pending.length < n; i++) await new Promise((r) => setTimeout(r, 0));
    expect(fake.pending).toHaveLength(n);
    return fake.pending[n - 1]!;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { ...fake, timers, views, search, fire, reached, settle };
}

const heads = (v: CatalogView) => (v.kind === 'hits' ? v.hits.map((h) => h.headId) : []);

describe('catalogQuery: the spine form and bounds', () => {
  it('NFKC-normalizes, then trims Unicode White_Space (U+0085 included, U+FEFF kept)', () => {
    expect(catalogQuery('　ｎｅｎｄｏｒｏｉｄ　ミク\u0085 ')).toBe('nendoroid ミク');
    expect(catalogQuery('﻿miku')).toBe('﻿miku');
  });

  it('answers null for one Latin character, a blank query, or over 256 code points', () => {
    expect(catalogQuery('m')).toBeNull();
    expect(catalogQuery(' \u0085 ')).toBeNull();
    expect(catalogQuery('初')).toBe('初');
    expect(catalogQuery('mi')).toBe('mi');
    const emoji = '🎎'.repeat(CATALOG_QUERY_MAX);
    expect(catalogQuery(emoji)).toBe(emoji);
    expect(catalogQuery(`${emoji}x`)).toBeNull();
    expect(catalogQuery(` ${'a'.repeat(CATALOG_QUERY_MAX)} `)).toBe('a'.repeat(CATALOG_QUERY_MAX));
  });
});

describe('CatalogSearch', () => {
  it('waits for the debounce, then sends one search of the latest query at the page cap', async () => {
    const t = setup();
    t.search.set('mi', true);
    t.search.set('mik', true);
    t.search.set(' miku ', true);
    expect(t.search.view).toEqual({ kind: 'searching', query: 'miku' });
    expect(t.timers.delays()).toEqual([CATALOG_DEBOUNCE_MS]);
    await t.settle();
    expect(t.pending).toHaveLength(0);
    t.fire(CATALOG_DEBOUNCE_MS);
    const p = await t.reached(1);
    expect(p.req).toMatchObject({ query: 'miku', pageSize: CATALOG_PAGE_SIZE, pageToken: '' });
    expect(CATALOG_PAGE_SIZE).toBe(50);
  });

  it('shows a page of hits, at most 50 and each figure once, and whether there are more', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    const cards = Array.from({ length: 60 }, (_, i) => card(i));
    (await t.reached(1)).answer(page([card(0), ...cards], 'p2'));
    await t.settle();
    expect(t.search.view).toMatchObject({ kind: 'hits', query: 'miku', more: true, loadingMore: false, moreFailed: false });
    expect(heads(t.search.view)).toEqual(cards.slice(0, 50).map((c) => c.headId));
  });

  it('says there are no more on the last page', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([]));
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'hits', query: 'miku', hits: [], more: false, loadingMore: false, moreFailed: false });
  });

  it('follows next_page_token with the same query, appending new figures only', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(0), card(1)], 'p2'));
    await t.settle();
    t.search.more();
    expect(t.search.view).toMatchObject({ kind: 'hits', loadingMore: true });
    const second = await t.reached(2);
    expect(second.req).toMatchObject({ query: 'miku', pageSize: 50, pageToken: 'p2' });
    t.search.more();
    await t.settle();
    expect(t.pending).toHaveLength(2);
    second.answer(page([card(1), card(2)]));
    await t.settle();
    expect(heads(t.search.view)).toEqual([headOf(0), headOf(1), headOf(2)]);
    expect(t.search.view).toMatchObject({ more: false, loadingMore: false });
    t.search.more();
    await t.settle();
    expect(t.pending).toHaveLength(2);
  });

  it('cancels the search in flight when the query changes, and never shows its late answer', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    const first = await t.reached(1);
    t.search.set('nendoroid', true);
    expect(first.signal.aborted).toBe(true);
    first.answer(page([card(9)]));
    t.fire(CATALOG_DEBOUNCE_MS);
    const second = await t.reached(2);
    expect(second.req.query).toBe('nendoroid');
    second.answer(page([card(1)]));
    await t.settle();
    expect(heads(t.search.view)).toEqual([headOf(1)]);
    expect(t.views.some((v) => heads(v).includes(headOf(9)))).toBe(false);
  });

  it('does nothing when neither the query nor the connection changed', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(1)]));
    await t.settle();
    t.search.set('miku ', true);
    expect(t.timers.pending.size).toBe(0);
    expect(heads(t.search.view)).toEqual([headOf(1)]);
  });

  it('sends nothing for a query too short or too long, and hides the section', async () => {
    const t = setup();
    t.search.set('m', true);
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'idle' });
    t.search.set('a'.repeat(CATALOG_QUERY_MAX + 1), true);
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'idle' });
    expect(t.timers.pending.size).toBe(0);
  });

  it('hides the section offline without a request, cancels one in flight, and searches again online', async () => {
    const t = setup();
    t.search.set('miku', false);
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'offline' });
    expect(t.timers.pending.size).toBe(0);
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    const first = await t.reached(1);
    t.search.set('miku', false);
    expect(first.signal.aborted).toBe(true);
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'offline' });
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(2)).answer(page([card(3)]));
    await t.settle();
    expect(heads(t.search.view)).toEqual([headOf(3)]);
  });

  it.each([Code.Unavailable, Code.Unimplemented, Code.Unauthenticated, Code.FailedPrecondition, Code.DeadlineExceeded])(
    'hides the section quietly when the catalog cannot answer (code %s)',
    async (code) => {
      const t = setup();
      t.search.set('miku', true);
      t.fire(CATALOG_DEBOUNCE_MS);
      (await t.reached(1)).fail(new ConnectError('no', code));
      await t.settle();
      expect(t.search.view).toEqual({ kind: 'hidden', reason: 'unavailable' });
    },
  );

  it('says a search failed for any other error, and retries it', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).fail(new ConnectError('boom', Code.Internal));
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'failed', query: 'miku' });
    t.search.retry();
    expect(t.search.view).toEqual({ kind: 'searching', query: 'miku' });
    const again = await t.reached(2);
    expect(again.req).toMatchObject({ query: 'miku', pageToken: '' });
    again.answer(page([card(4)]));
    await t.settle();
    expect(heads(t.search.view)).toEqual([headOf(4)]);
  });

  it('retry does nothing unless a search failed', async () => {
    const t = setup();
    t.search.retry();
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'idle' });
    t.search.set('miku', true);
    t.search.retry();
    expect(t.timers.pending.size).toBe(1);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(1)]));
    await t.settle();
    t.search.retry();
    await t.settle();
    expect(t.pending).toHaveLength(1);
    expect(heads(t.search.view)).toEqual([headOf(1)]);
  });

  it('counts its own timeout as the catalog being too slow, whatever error the aborted call raises', async () => {
    const timers = new ManualTimers();
    const search = new CatalogSearch({
      timers,
      search: (_req, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    live = search;
    search.set('miku', true);
    timers.fireAll();
    await Promise.resolve();
    expect(timers.delays()).toEqual([CATALOG_TIMEOUT_MS]);
    timers.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    expect(search.view).toEqual({ kind: 'hidden', reason: 'unavailable' });
  });

  it('gives up on a search that does not answer in time, quietly', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    const p = await t.reached(1);
    expect(t.timers.delays()).toEqual([CATALOG_TIMEOUT_MS]);
    t.fire(CATALOG_TIMEOUT_MS);
    expect(p.signal.aborted).toBe(true);
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'hidden', reason: 'unavailable' });
  });

  it('restarts from page one when the page token is stale, replacing the hits', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(0)], 'p2'));
    await t.settle();
    t.search.more();
    (await t.reached(2)).fail(new ConnectError('TOKEN_EXPIRED_OR_REBASED', Code.InvalidArgument));
    const restart = await t.reached(3);
    expect(restart.req).toMatchObject({ query: 'miku', pageToken: '' });
    expect(t.search.view).toMatchObject({ kind: 'hits', loadingMore: true });
    restart.answer(page([card(5), card(0)], 'p2b'));
    await t.settle();
    expect(heads(t.search.view)).toEqual([headOf(5), headOf(0)]);
    expect(t.search.view).toMatchObject({ more: true, loadingMore: false, moreFailed: false });
  });

  it('drops a restart from page one that a newer query cancelled', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(0)], 'p2'));
    await t.settle();
    t.search.more();
    (await t.reached(2)).fail(new ConnectError('stale', Code.InvalidArgument));
    const restart = await t.reached(3);
    t.search.set('nendo', true);
    expect(restart.signal.aborted).toBe(true);
    restart.answer(page([card(7)]));
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'searching', query: 'nendo' });
  });

  it('says a search failed when the restart from page one fails', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(0)], 'p2'));
    await t.settle();
    t.search.more();
    (await t.reached(2)).fail(new ConnectError('stale', Code.InvalidArgument));
    (await t.reached(3)).fail(new ConnectError('stale again', Code.InvalidArgument));
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'failed', query: 'miku' });
  });

  it('says a search failed when page one is refused too', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).fail(new ConnectError('bad query', Code.InvalidArgument));
    await t.settle();
    expect(t.search.view).toEqual({ kind: 'failed', query: 'miku' });
  });

  it('keeps the hits it has when a further page fails, and lets the user try again', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    (await t.reached(1)).answer(page([card(0)], 'p2'));
    await t.settle();
    t.search.more();
    (await t.reached(2)).fail(new ConnectError('down', Code.Unavailable));
    await t.settle();
    expect(t.search.view).toMatchObject({ kind: 'hits', more: true, loadingMore: false, moreFailed: true });
    expect(heads(t.search.view)).toEqual([headOf(0)]);
    t.search.more();
    const again = await t.reached(3);
    expect(again.req.pageToken).toBe('p2');
    expect(t.search.view).toMatchObject({ loadingMore: true, moreFailed: false });
  });

  it('stops listening and cancels its search when disposed', async () => {
    const t = setup();
    t.search.set('miku', true);
    t.fire(CATALOG_DEBOUNCE_MS);
    const p = await t.reached(1);
    const seen = t.views.length;
    t.search.dispose();
    expect(p.signal.aborted).toBe(true);
    expect(t.timers.pending.size).toBe(0);
    t.search.set('nendo', true);
    expect(t.views).toHaveLength(seen);
    expect(t.timers.pending.size).toBe(0);
  });

  it('lets a listener unsubscribe', () => {
    const t = setup();
    const seen: CatalogView[] = [];
    const off = t.search.subscribe((v) => seen.push(v));
    t.search.set('miku', false);
    off();
    t.search.set('nendo', true);
    expect(seen).toEqual([{ kind: 'hidden', reason: 'offline' }]);
  });
});
