// ADDR-1: the owned figures' images, kept for the offline case view. Online and signed in, the hook
// brings the caches to the owned figures (src/media/ownedImages.ts) and answers each figure's
// primary; offline it answers from what was kept, asking nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useOwnedImages } from '../useOwnedImages';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, rememberImages, syncOwnedImages } from '../../media/ownedImages';
import { installFakeLocks } from '../../test/fakeLocks';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
let storage: FakeCaches;

/** A figure's list and its primary's bytes, as the last sync left them. */
async function keep(head: string, c: string, bytes = true): Promise<void> {
  await rememberImages(head, [{ url: url(c), width: 1, height: 1, role: 'gallery', primary: true }], storage);
  if (bytes) await (await storage.open(OWNED_MEDIA_CACHE)).put(url(c), new Response('bytes'));
}
const settle = () => new Promise((res) => setTimeout(res, 50));

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
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
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)], pageSize: 200 }, { signal: expect.any(AbortSignal), timeoutMs: 20_000 });
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
      await keep(headOf(0), 'b');
      const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
      await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
      expect(r.clients.getProductImages).not.toHaveBeenCalled();
    } finally {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('online, but the coordinator answers UNAVAILABLE: still shows what the last sync kept', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keep(headOf(0), 'b');
    r.clients.getProductImages.mockRejectedValue(new ConnectError('display restrictions are unavailable', Code.Unavailable));
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
  });

  it('online, but the server out of reach (the sync engine\'s probe failed): asks nothing and shows what was kept with its bytes', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned, bytes never kept' }]);
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('manual');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    await keep(headOf(0), 'b');
    await keep(headOf(1), 'c', false);
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
    expect(result.current.has(headOf(1))).toBe(false);
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('answers no image for a figure whose bytes are not on the device, so the case draws its plate', async () => {
    storage = fakeCaches(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: url('a'), width: 600, height: 800 }] }],
      }),
    );
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    await keep(headOf(1), 'c', false);
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await settle();
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([]);
    expect(result.current.size).toBe(0);
  });

  it('cancels its sync when the case view goes away: the call in flight is aborted, nothing more is asked', async () => {
    const r = await localRig();
    let seen: AbortSignal | undefined;
    r.clients.getProductImages.mockImplementation((_req: unknown, opts?: { signal?: AbortSignal }) => {
      seen = opts?.signal;
      return new Promise(() => {});
    });
    await seedFigures(r, [{ title: 'Owned' }]);
    const { unmount } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
    expect(seen?.aborted).toBe(false);
    unmount();
    await waitFor(() => expect(seen?.aborted).toBe(true));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  it('cancels its sync when the case view goes away: an image fetch in flight is aborted too, so the sync lets go of the lock', async () => {
    const uninstall = installFakeLocks();
    try {
      // An image link that never answers: only an abort of the request's own signal ends the fetch.
      storage = fakeCaches((req) => new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason))));
      vi.stubGlobal('caches', storage);
      vi.stubGlobal('fetch', storage.fetch);
      const r = await localRig();
      r.clients.getProductImages.mockResolvedValue(
        create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), role: 'gallery', primary: true, url: url('a'), width: 1, height: 1 }] }] }),
      );
      await seedFigures(r, [{ title: 'Owned' }]);
      const { unmount } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
      await waitFor(() => expect(storage.added).toHaveLength(1));
      const fetching = storage.added[0]!.signal;
      expect(fetching.aborted).toBe(false);
      unmount();
      await waitFor(() => expect(fetching.aborted).toBe(true));
      // The lock is free: the next sync (another document's) runs at once.
      const next = await syncOwnedImages([headOf(0)], async () => new Map(), { storage, lockWaitMs: 100 }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
      expect(next).toBe('synced');
    } finally {
      uninstall();
    }
  });

  it('answers nothing while signed out', async () => {
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.size).toBe(0);
  });
});
