// ADDR-1: the owned figures' images, kept for the offline case view. Online and signed in, the hook
// brings the caches to the owned figures (src/media/ownedImages.ts) and answers each figure's
// primary; offline it answers from what was kept, asking nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useOwnedImages } from '../useOwnedImages';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, rememberImages } from '../../media/ownedImages';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
let storage: FakeCaches;

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localSession.value = undefined;
});

describe('useOwnedImages', () => {
  it('online: caches the owned figures\' images, never a wished one\'s, and answers each primary', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: url('a'), width: 600, height: 800 }] }],
      }),
    );
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Wished', status: 'wished' }]);
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)] });
    expect(result.current.has(headOf(1))).toBe(false);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
  });

  it('offline: answers from the kept lists and asks the coordinator nothing', async () => {
    renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    try {
      const r = await localRig();
      await seedFigures(r, [{ title: 'Owned' }]);
      await rememberImages(headOf(0), [{ url: url('b'), width: 1, height: 1, role: 'gallery', primary: true }], storage);
      const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
      await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
      expect(r.clients.getProductImages).not.toHaveBeenCalled();
    } finally {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('answers nothing while signed out', async () => {
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.size).toBe(0);
  });
});
