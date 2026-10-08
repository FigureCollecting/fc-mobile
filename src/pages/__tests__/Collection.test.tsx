// The Collection screen on the local store (WK-15): the whole collection with no cap, the four
// tabs over the default collections, xN stacks, one sync badge per item, LastSynced from sync_meta,
// and bulk 'Move N copies to…'.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { Code, ConnectError } from '@connectrpc/connect';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { shownCopies } from '../../sync/occurrences';

afterEach(() => {
  localSession.value = undefined;
});

const tiles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.jrows__item')];

describe('Collection page', () => {
  it('asks a signed-out visitor to sign in', async () => {
    await localRig({ status: 'signed-out' });
    renderWithProviders(<Collection />, { initialPath: '/' });
    expect(await screen.findByText('Sign in to see your collection')).toBeInTheDocument();
  });

  it('shows the shelf skeleton until the session is known', () => {
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    expect(container.querySelector('.skeleton-shelves')).not.toBeNull();
  });

  it('renders the whole collection, 45 figures, with no page cap', async () => {
    const r = await localRig();
    await seedFigures(r, Array.from({ length: 45 }, (_, i) => ({ title: `Figure ${i}` })));
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await waitFor(() => expect(tiles(container)).toHaveLength(45));
    expect(screen.getByText('Collection (45)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Figure 44' })).toBeInTheDocument();
  });

  it('shows four tabs with their counts, Owned first, and switches tab in the URL', async () => {
    const r = await localRig();
    await seedFigures(r, [
      { title: 'A owned', status: 'owned' },
      { title: 'B owned', status: 'owned' },
      { title: 'C ordered', status: 'ordered' },
      { title: 'D wished', status: 'wished' },
      { title: 'E sold', status: 'former', disposal: { reason: 'sold' } },
    ]);
    const user = userEvent.setup();
    const { container, currentPath } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    const tabs = await screen.findByRole('tablist', { name: 'Collections' });
    await waitFor(() =>
      expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Owned (2)', 'Ordered (1)', 'Wished (1)', 'No longer owned (1)']),
    );
    expect(within(tabs).getByRole('tab', { name: 'Owned (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(tiles(container).map((t) => t.getAttribute('aria-label') ?? t.textContent)).toHaveLength(2);
    await user.click(within(tabs).getByRole('tab', { name: 'Wished (1)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'D wished' })).toBeInTheDocument());
    expect(currentPath()).toContain('tab=wished');
    expect(screen.queryByRole('button', { name: 'A owned' })).toBeNull();
  });

  it('stacks copies of one figure: a tile with xN', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Triple', copies: 3 }, { title: 'Single' }]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await waitFor(() => expect(tiles(container)).toHaveLength(2));
    const triple = screen.getByRole('button', { name: 'Triple' });
    expect(within(triple).getByText('×3')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Single' })).queryByText(/×/)).toBeNull();
  });

  it('draws a placeholder plate with the name for every figure, never an image', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Plate me', manufacturer: 'Alter' }]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await waitFor(() => expect(tiles(container)).toHaveLength(1));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.jrows__plate')).toHaveTextContent('Plate meAlter');
  });

  it('badges each item: known, pending after a local edit, offline-stale with as-of and LastSynced while out of reach', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'One' }, { title: 'Two' }]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await waitFor(() => expect(tiles(container).map((t) => t.dataset['sync'])).toEqual(['known', 'known']));
    await act(async () => {
      await r.engine.write((s) => s.createCopy(headOf(1), 'owned'));
    });
    await waitFor(() => expect(tiles(container).map((t) => t.dataset['sync'])).toEqual(['known', 'pending']));
    expect(within(screen.getByRole('button', { name: 'Two' })).getByText('Pending')).toBeInTheDocument();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await act(() => r.engine.trigger('manual'));
    await waitFor(() => expect(tiles(container).map((t) => t.dataset['sync'])).toEqual(['offline-stale', 'pending']));
    expect(within(screen.getByRole('button', { name: 'One' })).getByText(/^as of .+ [A-Z][A-Za-z0-9+:-]*$/)).toBeInTheDocument();
    expect(screen.getByText(/^Last synced/)).toBeInTheDocument();
  });

  it('shows what each tab holds when it is empty', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Only owned' }]);
    renderWithProviders(<Collection />, { initialPath: '/?layout=rows&tab=ordered' });
    expect(await screen.findByText('Nothing ordered yet.')).toBeInTheDocument();
  });

  it('lists no-longer-owned copies with their disposal: reason, date, note, counterparty and price', async () => {
    const r = await localRig();
    await seedFigures(r, [
      { title: 'Sold one', status: 'former', disposal: { reason: 'sold', on: '2026-10-01', note: 'box dented', counterparty: 'Kai', price: { amount: '120.50', currency: 'USD' } } },
      { title: 'Gifted one', status: 'former', disposal: { reason: 'gifted' } },
    ]);
    renderWithProviders(<Collection />, { initialPath: '/?tab=former' });
    const list = await screen.findByRole('list', { name: 'No longer owned' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sold one');
    expect(items[0]).toHaveTextContent('Sold');
    expect(items[0]).toHaveTextContent('Oct 1, 2026');
    expect(items[0]).toHaveTextContent('box dented');
    expect(items[0]).toHaveTextContent('Kai');
    expect(items[0]).toHaveTextContent('$120.50');
    expect(items[1]).toHaveTextContent('Gifted');
  });

  it('moves the copies of the selected items to another tab in one batch: Move N copies to…', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Pair', copies: 2, status: 'wished' }, { title: 'Solo', status: 'wished' }, { title: 'Stay', status: 'wished' }]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/?layout=rows&tab=wished' });
    await screen.findByRole('button', { name: 'Pair' });
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    await user.click(screen.getByRole('button', { name: 'Solo' }));
    await user.click(screen.getByRole('button', { name: 'Move 3 copies to…' }));
    await user.click(await screen.findByRole('button', { name: 'Ordered' }));
    await waitFor(async () =>
      expect(shownCopies(await r.store.getView()).map((c) => c.status).sort()).toEqual(['ordered', 'ordered', 'ordered', 'wished']),
    );
    const outbox = await r.store.listOutbox();
    expect(new Set(outbox.map((e) => e.group)).size).toBe(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pair' })).toBeNull());
  });

  it('shows the error state when the local store cannot be read', async () => {
    const r = await localRig();
    vi.spyOn(r.engine, 'read').mockRejectedValue(new Error('closed'));
    renderWithProviders(<Collection />, { initialPath: '/' });
    expect(await screen.findByText("Couldn't load your collection")).toBeInTheDocument();
  });
});
