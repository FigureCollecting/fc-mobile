// Search and add (WK-15): on-device search over the user's figures (offline too), 'add to
// collection' from a result, and a barcode lookup through Compare, which is online only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { create } from '@bufbuild/protobuf';
import { CompareResponseSchema } from '@figurecollecting/fc-api-contract';

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
