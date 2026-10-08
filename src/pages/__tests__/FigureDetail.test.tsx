// The figure detail on the local store (WK-15): ProductCard facts and a placeholder plate (a
// derivative only when GetProductImages returns one, never figure.imageUrl or a spine image claim),
// the user's copies with their actions, and the edit sheet. Every edit is a local write.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema, ProductCardSchema, ufFacetKey } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { FigureDetail } from '../FigureDetail';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures, type SeedFigure } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { shownCopies } from '../../sync/occurrences';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

afterEach(() => {
  localSession.value = undefined;
});

const MIKU: SeedFigure = { title: 'Hatsune Miku: Deep Sea Girl', manufacturer: 'Good Smile Company', character: '初音ミク', series: 'Vocaloid', gtin: '04580416940986' };

async function open(figs: SeedFigure[], path = `/figure/${headOf(0)}`): Promise<LocalRig> {
  const r = await localRig();
  await seedFigures(r, figs);
  renderWithProviders(<FigureDetail />, { initialPath: path });
  await screen.findByRole('heading', { level: 1 });
  return r;
}

const statuses = async (r: LocalRig) =>
  shownCopies(await r.store.getView())
    .map((c) => c.status)
    .sort();

describe('FigureDetail page', () => {
  it('shows the product card facts and a placeholder plate, with no image', async () => {
    const r = await open([MIKU]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hatsune Miku: Deep Sea Girl');
    expect(screen.getByText('Good Smile Company', { selector: '.figure-detail__manufacturer' })).toBeInTheDocument();
    expect(screen.getByText('初音ミク')).toBeInTheDocument();
    expect(screen.getByText('Vocaloid')).toBeInTheDocument();
    expect(screen.getByText('4580416940986')).toBeInTheDocument();
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)] }, expect.anything()));
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.figure-detail__plate')).toHaveTextContent('Hatsune Miku: Deep Sea Girl');
  });

  it('shows a derivative only when GetProductImages returns one', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [{ headId: headOf(0), images: [{ derivativeId: 'aa', primary: true, url: 'https://images.figurecollecting.com/d/aa.webp' }] }],
      }),
    );
    await seedFigures(r, [MIKU]);
    renderWithProviders(<FigureDetail />, { initialPath: `/figure/${headOf(0)}` });
    const img = await screen.findByRole('img', { name: 'Hatsune Miku: Deep Sea Girl' });
    expect(img).toHaveAttribute('src', 'https://images.figurecollecting.com/d/aa.webp');
  });

  it('asks for no image offline, and draws the plate', async () => {
    // The page's online signal follows the window's online and offline events.
    renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    try {
      const r = await open([MIKU]);
      await new Promise((res) => setTimeout(res, 20));
      expect(r.clients.getProductImages).not.toHaveBeenCalled();
      expect(document.querySelector('.figure-detail__plate')).not.toBeNull();
    } finally {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('says so for a figure the user holds no copy of', async () => {
    await localRig();
    renderWithProviders(<FigureDetail />, { initialPath: `/figure/${headOf(9)}` });
    expect(await screen.findByText('This figure is not in your collection.')).toBeInTheDocument();
  });

  it('lists the copies by kind, and marks an ordered one arrived', async () => {
    const r = await open([{ ...MIKU, status: 'ordered', copies: 2 }]);
    const copies = screen.getByRole('list', { name: 'Your copies' });
    expect(within(copies).getAllByRole('listitem')).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(within(copies).getAllByRole('button', { name: 'Mark arrived' })[0]!);
    await waitFor(async () => expect(await statuses(r)).toEqual(['ordered', 'owned']));
  });

  it('removes one copy', async () => {
    const r = await open([{ ...MIKU, copies: 2 }]);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Remove copy' })[1]!);
    await waitFor(async () => expect(await statuses(r)).toEqual(['owned']));
  });

  it('moves one copy to another tab', async () => {
    const r = await open([MIKU]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(await screen.findByRole('button', { name: 'Wished' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['wished']));
  });

  it('dedupes N identical copies down to one', async () => {
    const r = await open([{ ...MIKU, copies: 3 }]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Keep 1 of 3 owned' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['owned']));
  });

  it('dedupes the copies of every merged head the figure shows, down to one', async () => {
    const r = await localRig();
    await seedFigures(r, [{ ...MIKU, copies: 2 }, { title: 'Miku (other listing)', copies: 1 }]);
    // An ER merge: head 1's card answers for head 0 too, so the item shows all three copies.
    const merged = { ref: { case: 'headId' as const, value: headOf(0) } };
    await r.store.putProducts([create(ProductCardSchema, { headId: headOf(1), requestedAs: [merged, { ref: { case: 'headId', value: headOf(1) } }], title: { value: 'Miku merged', asOf: '2026-10-01T09:30:00.000000Z' } })]);
    renderWithProviders(<FigureDetail />, { initialPath: `/figure/${headOf(0)}` });
    await screen.findByRole('heading', { level: 1, name: 'Miku merged' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Keep 1 of 3 owned' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['owned']));
  });

  it('marks a copy sold with its disposal, in one batch', async () => {
    const r = await open([MIKU]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mark sold, traded, gifted…' }));
    const sheet = await screen.findByRole('form', { name: 'No longer owned' });
    await user.selectOptions(within(sheet).getByLabelText('How it left'), 'sold');
    await user.type(within(sheet).getByLabelText('Date'), '2026-10-01');
    await user.type(within(sheet).getByLabelText('To or from'), 'Kai');
    await user.type(within(sheet).getByLabelText('Price'), '120.50');
    await user.selectOptions(within(sheet).getByLabelText('Currency'), 'USD');
    await user.type(within(sheet).getByLabelText('Note'), 'box dented');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['former']));
    const copy = (await r.store.getView()).copies[0]!;
    expect(copy.disposal).toMatchObject({ reason: 'sold', on: '2026-10-01', counterparty: 'Kai', note: 'box dented', price: { amount: '120.50', currency: 'USD' } });
    const outbox = await r.store.listOutbox();
    expect(new Set(outbox.map((e) => e.group)).size).toBe(1);
  });

  it('opens the disposal sheet blank for the next copy, and saves only what was entered for it', async () => {
    const r = await open([{ ...MIKU, copies: 2 }]);
    const user = userEvent.setup();
    const fields = (sheet: HTMLElement) =>
      ['How it left', 'Date', 'To or from', 'Price', 'Currency', 'Note'].map((l) => (within(sheet).getByLabelText(l) as HTMLInputElement).value);
    await user.click(screen.getAllByRole('button', { name: 'Mark sold, traded, gifted…' })[0]!);
    let sheet = await screen.findByRole('form', { name: 'No longer owned' });
    await user.selectOptions(within(sheet).getByLabelText('How it left'), 'traded');
    await user.type(within(sheet).getByLabelText('Date'), '2026-10-01');
    await user.type(within(sheet).getByLabelText('To or from'), 'Kai');
    await user.type(within(sheet).getByLabelText('Price'), '120.50');
    await user.selectOptions(within(sheet).getByLabelText('Currency'), 'JPY');
    await user.type(within(sheet).getByLabelText('Note'), 'box dented');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['former', 'owned']));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'No longer owned' })).toBeNull());
    // The list shows the first copy as former: the one button left is the second copy's.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mark sold, traded, gifted…' })).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Mark sold, traded, gifted…' }));
    sheet = await screen.findByRole('form', { name: 'No longer owned' });
    expect(fields(sheet)).toEqual(['sold', '', '', '', 'USD', '']);
    await user.selectOptions(within(sheet).getByLabelText('How it left'), 'gifted');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['former', 'former']));
    const copies = shownCopies(await r.store.getView());
    const [a, b] = ['traded', 'gifted'].map((reason) => copies.find((c) => c.disposal?.['reason'] === reason));
    expect(a!.disposal).toMatchObject({ reason: 'traded', on: '2026-10-01', counterparty: 'Kai', note: 'box dented', price: { amount: '120.50', currency: 'JPY' } });
    expect(b!.disposal).toMatchObject({ reason: 'gifted' });
    for (const k of ['on', 'counterparty', 'price', 'note']) expect(b!.disposal).not.toHaveProperty(k);
  });

  it('edits status, count, score and note through the edit sheet', async () => {
    const r = await open([MIKU]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('form', { name: 'Edit figure' });
    await user.click(within(sheet).getByRole('button', { name: 'Ordered' }));
    await user.clear(within(sheet).getByLabelText('Copies'));
    await user.type(within(sheet).getByLabelText('Copies'), '2');
    await user.selectOptions(within(sheet).getByLabelText('Score'), '8');
    await user.type(within(sheet).getByLabelText('Notes'), 'pre-order bonus');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await statuses(r)).toEqual(['ordered', 'ordered']));
    const note = await r.store.getFacet(ufFacetKey(headOf(0), 'note'));
    expect(JSON.parse(note!.value!.payload)).toMatchObject({ note: 'pre-order bonus' });
    const score = await r.store.getFacet(ufFacetKey(headOf(0), 'score'));
    expect(JSON.parse(score!.value!.payload)).toMatchObject({ score: 8 });
  });

  it('badges the figure pending after an edit, and shows when its facts were current', async () => {
    const r = await open([MIKU]);
    expect(screen.getByText(/^Facts as of /)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove copy' }));
    await waitFor(() => expect(r.engine.state.value.pending).toBe(1));
  });
});
