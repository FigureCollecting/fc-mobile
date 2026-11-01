/**
 * FETCH-FIRST (10-31, the stack's slow link: with the case arranged by series, its default, the first figure in view stood
 * as its plate for about a minute; by date added, 2 s): the image sync fetched in head-id order, whatever the case showed.
 * The Collection page has it fetch the pictures of the figures the case draws first, then the rest as the case stands them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema, ProductCardSchema, SyncOp, occFacetKey } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';
import { setFetchOrder } from '../../hooks/useCollectionImages';
import { STAMP, headOf, serverVersion, uuid } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { CASE_PREFS_KEY } from '../../components/display/casePrefs';

const D = 'https://images.figurecollecting.com/d';
const FIGURES = 60;
/** Figure i's photo: its index, as the address's last 64 hex digits. */
const photo = (i: number) => `${D}/${i.toString(16).padStart(64, '0')}`;
/** The figure a head id names (engineSupport's headOf). */
const indexOf = (head: string) => Number.parseInt(head.slice(1, 8), 16);
let storage: FakeCaches;

/** Owned copies of figures [0, n) on the server, with their cards: named so the case stands them last head id first. */
function owned(r: LocalRig, n: number): void {
  let counter = 0;
  const events: Parameters<LocalRig['server']['write']>[0] = [];
  for (let i = 0; i < n; i++) {
    const occ = uuid(2000 + i, 'b');
    events.push({ facetKey: occFacetKey(occ, 'head'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(i), ...STAMP }) });
    events.push({ facetKey: occFacetKey(occ, 'status'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ status: 'owned', ...STAMP }) });
    r.server.products.set(headOf(i), create(ProductCardSchema, { headId: headOf(i), requestedAs: [{ ref: { case: 'headId', value: headOf(i) } }], title: { value: `Figure ${String(n - i).padStart(3, '0')}` } }));
  }
  r.server.write(events);
}

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  localSession.value = undefined;
  setFetchOrder([]);
});

describe('FETCH-FIRST: the Collection page fetches the pictures of the figures its case draws first', () => {
  it('then those of every other figure, in the order the case stands them', async () => {
    // one cabinet in view, so most of the wall is out of it
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view: 'cabinet' }));
    const r = await localRig();
    // the lists answer once the case has drawn its first view, as on a phone, where reading them takes a while
    let answer!: () => void;
    const drawn = new Promise<void>((res) => (answer = res));
    r.clients.getProductImages.mockImplementation(async (req: { headIds: string[] }) => {
      await drawn;
      return create(GetProductImagesResponseSchema, {
        products: req.headIds.map((h) => ({ headId: h, images: [{ derivativeId: photo(indexOf(h)).slice(-64), role: 'gallery', url: photo(indexOf(h)), width: 600, height: 800 }] })),
      });
    });
    owned(r, FIGURES);
    await r.engine.trigger('manual');
    renderWithProviders(<Collection />, { initialPath: '/' });
    const ids = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).map((b) => b.dataset.figureId!);
    await waitFor(() => expect(ids('.cabinet-scene button.cab-figure').length).toBeGreaterThan(0), { timeout: 4000 });
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const inView = ids('.cabinet-scene button.cab-figure');
    const standing = (JSON.parse(host.dataset.order!) as string[][]).flat();
    expect(standing).toHaveLength(FIGURES);
    expect(standing[0]).toBe(headOf(FIGURES - 1));
    expect(inView.length).toBeLessThan(FIGURES);
    answer();

    await waitFor(() => expect(storage.added).toHaveLength(FIGURES), { timeout: 4000 });
    const fetched = storage.added.map((q) => q.url);
    expect(fetched).toEqual([...inView, ...standing.filter((id) => !inView.includes(id))].map((id) => photo(indexOf(id))));
  });
});
