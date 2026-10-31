/**
 * NEWHOLD-IMG-1 (Ross 10-31, Fold8, Free camera, case view): 90 copies another device pushed reached the phone by Delta
 * and stood in the case as plates (no picture), while the figures held before them showed theirs. A figure that becomes
 * held after the device's earlier syncs must show its first photo in the case once the next sync brings it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/preact';
import { Code, ConnectError } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema, ProductCardSchema, SyncOp, occFacetKey } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';
import { STAMP, headOf, serverVersion, uuid } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { CASE_PREFS_KEY } from '../../components/display/casePrefs';

const D = 'https://images.figurecollecting.com/d';
/** Figure i's first photo (the coordinator marks none primary: no product has primary_image_id). */
const photo = (i: number) => `${D}/${i.toString(16).padStart(64, '0')}`;
let storage: FakeCaches;
let counter = 0;

/** Copies of figures [from, to) written on the server by another device, with their cards: a Push from another device. */
function pushedFromAnotherDevice(r: LocalRig, from: number, to: number): void {
  const events: Parameters<LocalRig['server']['write']>[0] = [];
  for (let i = from; i < to; i++) {
    const occ = uuid(1000 + i, 'a');
    events.push({ facetKey: occFacetKey(occ, 'head'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(i), ...STAMP }) });
    events.push({ facetKey: occFacetKey(occ, 'status'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ status: 'owned', ...STAMP }) });
    r.server.products.set(headOf(i), create(ProductCardSchema, { headId: headOf(i), requestedAs: [{ ref: { case: 'headId', value: headOf(i) } }], title: { value: `Figure ${i}` } }));
  }
  r.server.write(events);
}

/** The coordinator's image lists: every figure has two gallery photos, none marked primary. */
function answerImages(r: LocalRig): void {
  r.clients.getProductImages.mockImplementation(async (req: { headIds: string[] }) =>
    create(GetProductImagesResponseSchema, {
      products: req.headIds.map((h) => {
        const i = Number.parseInt(h.slice(1, 8), 16);
        return {
          headId: h,
          images: [
            { derivativeId: photo(i).slice(-64), role: 'gallery', url: photo(i), width: 600, height: 800 },
            { derivativeId: 'f'.repeat(64), role: 'gallery', url: `${D}/${'f'.repeat(63)}${i % 10}`, width: 600, height: 800 },
          ],
        };
      }),
    }),
  );
}

/** What the case draws for figure i: its picture's address, or 'plate'. */
const artOf = (i: number): string | undefined => {
  const button = document.querySelector<HTMLElement>(`.cab-figure[aria-label="Figure ${i}"]`);
  if (button === null) return undefined;
  return button.dataset.art === 'plate' ? 'plate' : (button.querySelector('img')?.getAttribute('src') ?? button.dataset.art);
};

beforeEach(() => {
  counter = 0;
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  localSession.value = undefined;
});

describe('NEWHOLD-IMG-1: a figure held after the device\'s earlier syncs shows its first photo in the case', () => {
  it('copies pushed from another device, pulled by the next sync while the case is open, draw their first photo', async () => {
    const r = await localRig();
    answerImages(r);
    pushedFromAnotherDevice(r, 0, 3);
    await r.engine.trigger('manual');
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect([0, 1, 2].map(artOf)).toEqual([0, 1, 2].map(photo)), { timeout: 4000 });

    pushedFromAnotherDevice(r, 3, 6);
    await r.engine.trigger('poll');
    await waitFor(() => expect([3, 4, 5].map(artOf)).toEqual([3, 4, 5].map(photo)), { timeout: 4000 });
    expect([0, 1, 2].map(artOf)).toEqual([0, 1, 2].map(photo));
  });

  // The coordinator answered one GetProductImages 503 (UNAVAILABLE) during the jog; the server stayed in reach throughout.
  it('the image sync that brings them fails once (UNAVAILABLE) with the server still in reach: the next sync pass syncs the images again and they draw', async () => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: true }));
    const r = await localRig();
    answerImages(r);
    pushedFromAnotherDevice(r, 0, 3);
    await r.engine.trigger('manual');
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect([0, 1, 2].map(artOf)).toEqual([0, 1, 2].map(photo)), { timeout: 4000 });
    // as on Ross's Fold8: the Free camera
    expect(document.querySelector('.cabinet-scene')).toHaveAttribute('data-free-camera', '1');
    const asked = r.clients.getProductImages.mock.calls.length;

    pushedFromAnotherDevice(r, 3, 6);
    r.clients.getProductImages.mockRejectedValueOnce(new ConnectError('display restrictions are unavailable', Code.Unavailable));
    await r.engine.trigger('poll');
    await waitFor(() => expect(r.clients.getProductImages.mock.calls.length).toBe(asked + 1));
    await act(() => new Promise((res) => setTimeout(res, 50)));
    // the figures held before show theirs; the new ones stand as plates for now
    expect([0, 1, 2].map(artOf)).toEqual([0, 1, 2].map(photo));
    expect([3, 4, 5].map(artOf)).toEqual(['plate', 'plate', 'plate']);
    expect(r.engine.state.value.reachability).toBe('reachable');

    // the engine's next pass (its idle poll, a minute on), the server answering as before
    r.clock.advance(60_000);
    await r.engine.trigger('poll');
    await waitFor(() => expect([3, 4, 5].map(artOf)).toEqual([3, 4, 5].map(photo)), { timeout: 4000 });
    expect([0, 1, 2].map(artOf)).toEqual([0, 1, 2].map(photo));
  });
});
