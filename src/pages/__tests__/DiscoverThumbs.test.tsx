// SEARCH-THUMB-1 (Ross 10-31: "figure search needs thumbnail (full view but very small) to tell entries apart"; seven rows of
// "Tokisaki Kurumi" told apart only by maker): each search row, local and catalog, starts with its figure's photo, whole
// (contained, never cropped), small, lazy-loaded, in a box of fixed size that holds its place before the photo comes (a
// neutral placeholder, or the photo's dominant colour), the photo the case shows (the user's choice too), and the rows of a
// search ask the coordinator once, not once a row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema, ProductCardSchema, ProductImageSchema, SearchProductsResponseSchema } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Discover } from '../Discover';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, rememberImages } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';

const D = 'https://images.figurecollecting.com/d';
const photo = (i: number, n: number) => `${D}/${(i * 10 + n).toString(16).padStart(64, '0')}`;
let storage: FakeCaches;

type Row = MessageInitShape<typeof ProductImageSchema>;
const rowsOf = (i: number): Row[] => [
  { role: 'gallery', primary: true, url: photo(i, 1), width: 550, height: 800, dominantColor: '#8a9bb0' },
  { role: 'gallery', primary: false, url: photo(i, 2), width: 600, height: 800 },
];
function answerLists(r: LocalRig, rows: (i: number) => Row[] = rowsOf) {
  r.clients.getProductImages.mockImplementation(async (req: { headIds: string[]; pageSize?: number; pageToken?: string }) => {
    const all = req.headIds.flatMap((h) => rows(Number.parseInt(h.slice(-6), 16)).map((row) => ({ headId: h, row })));
    const size = req.pageSize || 50;
    const at = req.pageToken ? Number(req.pageToken) : 0;
    const products: { headId: string; images: Row[] }[] = [];
    for (const { headId, row } of all.slice(at, at + size)) {
      const last = products[products.length - 1];
      if (last?.headId === headId) last.images.push(row);
      else products.push({ headId, images: [row] });
    }
    return create(GetProductImagesResponseSchema, { products, nextPageToken: at + size < all.length ? String(at + size) : '' });
  });
}

async function searchFor(q: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/search your figures/i), q);
}
const rows = async () => within(await screen.findByRole('list', { name: 'Search results' })).getAllByRole('listitem');
const thumbOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.search-thumb');
const imgOf = (row: HTMLElement) => row.querySelector<HTMLImageElement>('img.search-thumb__img');

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localSession.value = undefined;
});

describe('Discover: each row starts with its figure\'s photo', () => {
  it('a kept figure: the photo the case draws, whole, small, lazy-loaded, before the name, with no request', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Tokisaki Kurumi', manufacturer: 'Kadokawa' }]);
    await rememberImages(headOf(0), [{ url: photo(0, 1), width: 550, height: 800, role: 'gallery', primary: true }], storage);
    await (await storage.open(OWNED_MEDIA_CACHE)).put(photo(0, 1), new Response('img'));
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const [row] = await rows();
    await waitFor(() => expect(imgOf(row!)).not.toBeNull());
    const img = imgOf(row!)!;
    expect(img).toHaveAttribute('src', photo(0, 1));
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('crossorigin', 'anonymous');
    expect(img).toHaveAttribute('alt', '');
    // the box comes first in the row's open button, before the name; the button is still named by the figure
    const open = within(row!).getByRole('button', { name: 'Tokisaki Kurumi' });
    expect(open.firstElementChild).toBe(thumbOf(row!));
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('the photo the user chose, as the case shows it', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Tokisaki Kurumi' }]);
    await rememberImages(
      headOf(0),
      [
        { url: photo(0, 1), width: 550, height: 800, role: 'gallery', primary: true },
        { url: photo(0, 3), width: 500, height: 700, role: 'gallery', primary: false },
      ],
      storage,
    );
    const media = await storage.open(OWNED_MEDIA_CACHE);
    await media.put(photo(0, 1), new Response('img'));
    await media.put(photo(0, 3), new Response('img'));
    setPhotoChoice('user-a', headOf(0), photo(0, 3));
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const [row] = await rows();
    await waitFor(() => expect(imgOf(row!)).toHaveAttribute('src', photo(0, 3)));
  });

  it('twenty rows the device keeps nothing for ask GetProductImages ONCE, and each row shows its own figure', async () => {
    const r = await localRig();
    await seedFigures(r, Array.from({ length: 20 }, (_, i) => ({ title: `Tokisaki Kurumi ${i}`, status: 'former' as const })));
    answerLists(r);
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const all = await rows();
    expect(all).toHaveLength(20);
    await waitFor(() => expect(all.every((row) => imgOf(row) !== null)).toBe(true));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    const shown = all.map((row) => imgOf(row)!.getAttribute('src'));
    expect(new Set(shown).size).toBe(20);
    expect(shown).toContain(photo(7, 1));
  });

  it('holds its place before the photo comes: a neutral box, its dominant colour while the photo loads, a neutral one after', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Tokisaki Kurumi', status: 'former' }, { title: 'Kurumi Ebisuzawa', status: 'former' }]);
    answerLists(r, (i) => (i === 0 ? rowsOf(0) : []));
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const [withPhoto, without] = await rows();
    // a figure with no photo: the box alone, its place kept
    expect(thumbOf(without!)).not.toBeNull();
    await waitFor(() => expect(imgOf(withPhoto!)).not.toBeNull());
    expect(imgOf(without!)).toBeNull();
    expect(thumbOf(without!)!.style.backgroundColor).toBe('');
    expect(thumbOf(withPhoto!)!.style.backgroundColor).toBe('rgb(138, 155, 176)');
    fireEvent.load(imgOf(withPhoto!)!);
    expect(thumbOf(withPhoto!)!.style.backgroundColor).toBe('');
  });

  it('a photo that fails to load leaves the box as its placeholder, never a broken image', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Tokisaki Kurumi', status: 'former' }]);
    answerLists(r);
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const [row] = await rows();
    await waitFor(() => expect(imgOf(row!)).not.toBeNull());
    fireEvent.error(imgOf(row!)!);
    expect(imgOf(row!)).toBeNull();
    expect(thumbOf(row!)).not.toBeNull();
  });

  it('the catalog\'s rows too, in one more call for all of them', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Tokisaki Kurumi', status: 'former' }]);
    answerLists(r);
    r.clients.searchProducts.mockResolvedValue(
      create(SearchProductsResponseSchema, {
        products: [21, 22, 23].map((i) => create(ProductCardSchema, { headId: headOf(i), title: { value: `Kurumi catalog ${i}`, asOf: '2026-10-01T00:00:00Z' } })),
        nextPageToken: '',
      }),
    );
    renderWithProviders(<Discover />);
    await searchFor('kurumi');
    const catalog = within(await screen.findByRole('list', { name: 'Catalog results' })).getAllByRole('listitem');
    expect(catalog).toHaveLength(3);
    await waitFor(() => expect(catalog.map((row) => imgOf(row)?.getAttribute('src'))).toEqual([photo(21, 1), photo(22, 1), photo(23, 1)]));
    expect(catalog[0]!.querySelector('.discover-results__open')!.firstElementChild).toBe(thumbOf(catalog[0]!));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
  });
});
