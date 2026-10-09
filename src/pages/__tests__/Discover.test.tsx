// Search and add (WK-15): on-device search over the user's figures (offline too), 'add to
// collection' from a result, and a barcode lookup through Compare, which is online only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { CompareResponseSchema, ProductCardSchema, SearchProductsResponseSchema, occFacetKey, type ProductCard } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Discover } from '../Discover';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { shownCopies } from '../../sync/occurrences';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { toGtin14 } from '../../hooks/useBarcodeLookup';
import { toasts } from '../../stores/toast';

const toasted = () => toasts.value.map((t) => `${t.type}: ${t.message}`);

afterEach(() => {
  localSession.value = undefined;
});

async function seeded(): Promise<LocalRig> {
  const r = await localRig();
  await seedFigures(r, [
    { title: 'Hatsune Miku: Deep Sea Girl', manufacturer: 'Good Smile Company', character: '初音ミク', gtin: '04580416940986' },
    { title: 'Spike Spiegel', manufacturer: 'Bandai Spirits', status: 'wished' },
  ]);
  return r;
}

async function searchFor(q: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/search your figures/i), q);
  return user;
}

const kinds = async (r: LocalRig, head: string) =>
  shownCopies(await r.store.getView())
    .filter((c) => c.head_id === head)
    .map((c) => c.status)
    .sort();

function goOffline() {
  renderHook(() => useOnlineStatus());
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
}

function goOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}

describe('Discover: search on the device', () => {
  it('shows the search field and what it searches', async () => {
    await seeded();
    renderWithProviders(<Discover />);
    expect(screen.getByPlaceholderText(/search your figures/i)).toBeInTheDocument();
    expect(screen.getByText(/search your collection by name, maker, character, series or JAN/i)).toBeInTheDocument();
  });

  it('lists local hits, each with what the user holds of it, and makes no request', async () => {
    const r = await seeded();
    const calls = r.server.calls.length;
    renderWithProviders(<Discover />);
    await searchFor('miku');
    const results = await screen.findByRole('list', { name: 'Search results' });
    const items = within(results).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Hatsune Miku: Deep Sea Girl');
    expect(items[0]).toHaveTextContent('Owned ×1');
    expect(r.server.calls.length).toBe(calls);
  });

  it('searches offline', async () => {
    await seeded();
    goOffline();
    try {
      renderWithProviders(<Discover />);
      await searchFor('spiegel');
      expect(await screen.findByText('Spike Spiegel')).toBeInTheDocument();
    } finally {
      goOnline();
    }
  });

  it('says so when nothing matches', async () => {
    await seeded();
    renderWithProviders(<Discover />);
    await searchFor('zzzz');
    expect(await screen.findByText(/no figure in your collection matches/i)).toBeInTheDocument();
  });

  it('adds another copy to a tab from a search result', async () => {
    const r = await seeded();
    renderWithProviders(<Discover />);
    const user = await searchFor('spike');
    const item = (await screen.findByText('Spike Spiegel')).closest('li')!;
    await user.click(within(item).getByRole('button', { name: 'Add to collection' }));
    await user.click(await screen.findByRole('button', { name: 'Add to Owned' }));
    await waitFor(async () => expect(await kinds(r, headOf(1))).toEqual(['owned', 'wished']));
  });

  it('opens a result in the full detail', async () => {
    await seeded();
    const { currentPath } = renderWithProviders(<Discover />);
    const user = await searchFor('spike');
    await user.click(await screen.findByRole('button', { name: 'Spike Spiegel' }));
    expect(currentPath()).toBe(`/figure/${headOf(1)}`);
    expect(JSON.parse(localStorage.getItem('fc-recent-searches') ?? '[]')).toContain('spike');
  });
});

const CARD_AS_OF = '2026-10-02T00:00:00.000000Z';

/** A catalog hit as SearchProducts returns it: only the fields given are present (the rest absent or redacted). */
function catalogCard(i: number, fields: Partial<Record<'title' | 'manufacturer' | 'scale' | 'releaseYm' | 'series' | 'character', string>> = {}): ProductCard {
  const texts = Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value, asOf: CARD_AS_OF }]));
  return create(ProductCardSchema, { headId: headOf(i), ...texts });
}

const catalogPage = (cards: ProductCard[], nextPageToken = '') => create(SearchProductsResponseSchema, { products: cards, nextPageToken });

const catalogList = () => screen.findByRole('list', { name: 'Catalog results' });

describe('Discover: catalog search (online)', () => {
  it('lists the catalog hits below the local ones, without the figures already listed, after one debounced request', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockResolvedValue(
      catalogPage([
        catalogCard(0, { title: 'Hatsune Miku: Deep Sea Girl' }),
        catalogCard(20, { title: 'Nendoroid Hatsune Miku', manufacturer: 'Good Smile Company', scale: 'Non-scale', releaseYm: '2026-12' }),
      ]),
    );
    renderWithProviders(<Discover />);
    await searchFor('miku');
    const catalog = await catalogList();
    const local = screen.getByRole('list', { name: 'Search results' });
    expect(local.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const items = within(catalog).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Nendoroid Hatsune Miku');
    expect(items[0]).toHaveTextContent('Good Smile Company · Non-scale · 2026-12');
    expect(items[0]).not.toHaveTextContent('In your collection');
    expect(within(items[0]!).getByRole('button', { name: 'Add to Owned' })).toBeInTheDocument();
    expect(r.clients.searchProducts).toHaveBeenCalledTimes(1);
    expect(r.clients.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'miku', pageSize: 50, pageToken: '' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("adds a catalog hit as an owned copy through the local store, which syncs APPLIED and moves it to the local hits", async () => {
    const r = await seeded();
    const head = headOf(20);
    r.server.products.set(head, catalogCard(20, { title: 'Nendoroid Hatsune Miku' }));
    r.clients.searchProducts.mockResolvedValue(catalogPage([catalogCard(20, { title: 'Nendoroid Hatsune Miku' })]));
    renderWithProviders(<Discover />);
    const user = await searchFor('miku');
    const catalog = await catalogList();
    await user.click(within(catalog).getByRole('button', { name: 'Add to Owned' }));
    await waitFor(async () => expect(await kinds(r, head)).toEqual(['owned']));
    expect((await r.store.getProduct(head))?.card.title?.value).toBe('Nendoroid Hatsune Miku');
    await waitFor(() => expect(toasted()).toContain('success: Added to Owned'));
    const local = screen.getByRole('list', { name: 'Search results' });
    const added = (await within(local).findByText('Nendoroid Hatsune Miku')).closest('li')!;
    expect(added.querySelector('[data-sync]')?.getAttribute('data-sync')).toBe('pending');
    expect(screen.queryByRole('list', { name: 'Catalog results' })).toBeNull();

    await r.engine.trigger('write');
    const copy = shownCopies(await r.store.getView()).find((c) => c.head_id === head)!;
    const status = r.server.facets.get(occFacetKey(copy.occ_id, 'status'));
    expect(JSON.parse(status!.payload)).toMatchObject({ status: 'owned' });
    expect(r.engine.state.value.pending).toBe(0);
    await waitFor(() => expect(added.querySelector('[data-sync]')?.getAttribute('data-sync')).toBe('known'));
  });

  it('leaves out a catalog hit merged into a figure the local hits list (named in requested_as)', async () => {
    const r = await seeded();
    const merged = create(ProductCardSchema, { headId: headOf(30), requestedAs: [{ ref: { case: 'headId', value: headOf(0) } }], title: { value: 'Hatsune Miku: Deep Sea Girl (survivor)', asOf: CARD_AS_OF } });
    r.clients.searchProducts.mockResolvedValue(catalogPage([merged, catalogCard(21, { title: 'Racing Miku 2026' })]));
    renderWithProviders(<Discover />);
    await searchFor('miku');
    const items = within(await catalogList()).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('.discover-results__name')?.textContent)).toEqual(['Racing Miku 2026']);
  });

  it('shows what the user holds of a catalog hit the local search did not match', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockResolvedValue(catalogPage([catalogCard(1, { title: 'Spike Spiegel' })]));
    renderWithProviders(<Discover />);
    await searchFor('cowboy');
    const item = within(await catalogList()).getByRole('listitem');
    expect(item).toHaveTextContent('In your collection: Wished ×1');
  });

  it('renders redacted or absent fields as absent, never as a blank or "undefined"', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockResolvedValue(
      catalogPage([catalogCard(21, { title: 'Racing Miku 2026', manufacturer: '' }), catalogCard(22, { scale: '1/7' }), catalogCard(23, { title: '' })]),
    );
    renderWithProviders(<Discover />);
    await searchFor('racing');
    const [titled, untitled, blank] = within(await catalogList()).getAllByRole('listitem');
    expect(blank!.querySelector('.discover-results__name')?.textContent).toBe('Untitled figure');
    expect(titled!.querySelector('.discover-results__meta')).toBeNull();
    expect(titled).not.toHaveTextContent(/undefined|·/);
    expect(untitled).toHaveTextContent('Untitled figure');
    expect(untitled!.querySelector('.discover-results__meta')?.textContent).toBe('1/7');
  });

  it('follows the next page on request', async () => {
    const r = await seeded();
    r.clients.searchProducts
      .mockResolvedValueOnce(catalogPage([catalogCard(21, { title: 'Racing Miku 2026' })], 'p2'));
    renderWithProviders(<Discover />);
    const user = await searchFor('racing');
    await catalogList();
    expect(screen.queryByText('Could not load more.')).toBeNull();
    let answer!: (v: unknown) => void;
    r.clients.searchProducts.mockReturnValueOnce(new Promise((res) => (answer = res)));
    await user.click(screen.getByRole('button', { name: 'More results' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'More results' })).toBeDisabled());
    answer(catalogPage([catalogCard(22, { title: 'Racing Miku 2025' })]));
    await waitFor(async () => expect(within(await catalogList()).getAllByRole('listitem')).toHaveLength(2));
    expect(r.clients.searchProducts).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'racing', pageToken: 'p2' }), expect.anything());
    expect(screen.queryByRole('button', { name: 'More results' })).toBeNull();
  });

  it('says when a further page could not load', async () => {
    const r = await seeded();
    r.clients.searchProducts
      .mockResolvedValueOnce(catalogPage([catalogCard(21, { title: 'Racing Miku 2026' })], 'p2'))
      .mockRejectedValueOnce(new ConnectError('down', Code.Unavailable));
    renderWithProviders(<Discover />);
    const user = await searchFor('racing');
    await catalogList();
    await user.click(screen.getByRole('button', { name: 'More results' }));
    expect(await screen.findByText('Could not load more.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More results' })).toBeEnabled();
  });

  it('says so when the catalog has nothing else, below the local empty state', async () => {
    const r = await seeded();
    renderWithProviders(<Discover />);
    await searchFor('zzzz');
    expect(await screen.findByText('Nothing else in the catalog matches.')).toBeInTheDocument();
    expect(screen.getByText(/no figure in your collection matches/i)).toBeInTheDocument();
    expect(r.clients.searchProducts).toHaveBeenCalledTimes(1);
  });

  it('offers more rather than "nothing else" when a page held only figures already listed', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockResolvedValue(catalogPage([catalogCard(0, { title: 'Hatsune Miku: Deep Sea Girl' })], 'p2'));
    renderWithProviders(<Discover />);
    await searchFor('miku');
    expect(await screen.findByRole('button', { name: 'More results' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing else in the catalog matches.')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Catalog results' })).toBeNull();
  });

  it('cancels its catalog search when the screen goes away', async () => {
    const r = await seeded();
    let signal: AbortSignal | undefined;
    r.clients.searchProducts.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise(() => undefined);
    });
    const { unmount } = renderWithProviders(<Discover />);
    await searchFor('miku');
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('shows that it is searching the catalog', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<Discover />);
    await searchFor('miku');
    expect(await screen.findByRole('status', { name: 'Searching the catalog' })).toBeInTheDocument();
  });

  it('offline, hides the catalog section and sends nothing, with no error', async () => {
    const r = await seeded();
    goOffline();
    try {
      renderWithProviders(<Discover />);
      await searchFor('miku');
      expect(await screen.findByText('Hatsune Miku: Deep Sea Girl')).toBeInTheDocument();
      await new Promise((res) => setTimeout(res, 400));
      expect(r.clients.searchProducts).not.toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: 'In the catalog' })).toBeNull();
      expect(screen.queryByText(/catalog search failed/i)).toBeNull();
    } finally {
      goOnline();
    }
  });

  it('treats a sync engine that cannot reach the server as offline', async () => {
    const r = await seeded();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('unreachable', Code.Unavailable) });
    await r.engine.trigger('manual');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    renderWithProviders(<Discover />);
    await searchFor('miku');
    await new Promise((res) => setTimeout(res, 400));
    expect(r.clients.searchProducts).not.toHaveBeenCalled();
  });

  it('hides the section quietly when the catalog is unavailable', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockRejectedValue(new ConnectError('not served', Code.Unimplemented));
    renderWithProviders(<Discover />);
    await searchFor('miku');
    await waitFor(() => expect(r.clients.searchProducts).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In the catalog' })).toBeNull());
    expect(screen.queryByText(/catalog search failed/i)).toBeNull();
  });

  it('says a catalog search failed for another error, and tries again', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockRejectedValueOnce(new ConnectError('boom', Code.Internal)).mockResolvedValueOnce(catalogPage([catalogCard(21, { title: 'Racing Miku 2026' })]));
    renderWithProviders(<Discover />);
    const user = await searchFor('racing');
    expect(await screen.findByText('Catalog search failed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(within(await catalogList()).getByText('Racing Miku 2026')).toBeInTheDocument();
  });

  it('reports an add that failed', async () => {
    const r = await seeded();
    r.clients.searchProducts.mockResolvedValue(catalogPage([catalogCard(21, { title: 'Racing Miku 2026' })]));
    renderWithProviders(<Discover />);
    const user = await searchFor('racing');
    const catalog = await catalogList();
    vi.spyOn(r.engine, 'write').mockRejectedValueOnce(new Error('disk full'));
    await user.click(within(catalog).getByRole('button', { name: 'Add to Owned' }));
    await waitFor(() => expect(toasted()).toContain('error: Could not add: disk full'));
  });
});

describe('Discover: barcode lookup through Compare (online only)', () => {
  it('reads a JAN as a GTIN-14 and refuses what is not a barcode', () => {
    expect(toGtin14('4580416940986')).toBe('04580416940986');
    expect(toGtin14(' 4580-4169-40986 ')).toBe('04580416940986');
    expect(toGtin14('012345678905')).toBe('00012345678905');
    expect(toGtin14('96385074')).toBe('00000096385074');
    expect(toGtin14('04580416940986')).toBe('04580416940986');
    expect(toGtin14('12345')).toBeNull();
    expect(toGtin14('abc')).toBeNull();
  });

  it('finds the figure a barcode names and adds it, its card kept for offline', async () => {
    const r = await seeded();
    const head = headOf(7);
    r.server.seedProducts([head]);
    r.clients.compare.mockResolvedValue(create(CompareResponseSchema, { resultJson: JSON.stringify({ heads: [{ head }], related: [] }) }));
    renderWithProviders(<Discover />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Barcode'), '4580416940986');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const hit = await screen.findByRole('region', { name: 'Barcode result' });
    expect(r.clients.compare).toHaveBeenCalledWith(
      expect.objectContaining({ seed: { case: 'gtin14', value: '04580416940986' } }),
      expect.anything(),
    );
    expect(within(hit).getByText(`Figure ${head.slice(0, 8)}`)).toBeInTheDocument();
    await user.click(within(hit).getByRole('button', { name: 'Add to Ordered' }));
    await waitFor(async () => expect(await kinds(r, head)).toEqual(['ordered']));
    expect((await r.store.getProduct(head))?.card.title?.value).toBe(`Figure ${head.slice(0, 8)}`);
    expect(await within(hit).findByText('In your collection: Ordered ×1')).toBeInTheDocument();
  });

  it('says so when no figure carries the barcode', async () => {
    const r = await seeded();
    r.clients.compare.mockResolvedValue(create(CompareResponseSchema, { resultJson: JSON.stringify({ heads: [] }) }));
    renderWithProviders(<Discover />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Barcode'), '4580416940986');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('No figure carries this barcode.')).toBeInTheDocument();
    expect(r.clients.getProducts).not.toHaveBeenCalled();
  });

  it('reports a lookup that failed', async () => {
    const r = await seeded();
    r.clients.compare.mockRejectedValue(new Error('unavailable'));
    renderWithProviders(<Discover />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Barcode'), '4580416940986');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/lookup failed/i)).toBeInTheDocument();
  });

  it('asks for a barcode it can read', async () => {
    const r = await seeded();
    renderWithProviders(<Discover />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Barcode'), '123');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Enter the 8, 12, 13 or 14 digits under the barcode.')).toBeInTheDocument();
    expect(r.clients.compare).not.toHaveBeenCalled();
  });

  it('is off while offline', async () => {
    const r = await seeded();
    goOffline();
    try {
      renderWithProviders(<Discover />);
      expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
      expect(screen.getByText('Barcode lookup needs a connection.')).toBeInTheDocument();
      expect(r.clients.compare).not.toHaveBeenCalled();
    } finally {
      goOnline();
    }
  });
});
