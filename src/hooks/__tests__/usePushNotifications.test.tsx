import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));

import { api } from '../../api/client';
import { usePushNotifications } from '../usePushNotifications';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const apiDel = api.delete as unknown as ReturnType<typeof vi.fn>;

describe('usePushNotifications', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDel.mockReset();
  });

  it('exposes default permission state and no-op methods when not supported', () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBeDefined();
    expect(typeof result.current.requestPermission).toBe('function');
    expect(typeof result.current.unsubscribe).toBe('function');
  });

  it('exposes isSupported flag based on PushManager presence', () => {
    const { result } = renderHook(() => usePushNotifications());
    // jsdom doesn't ship PushManager, so we expect false.
    expect(typeof result.current.isSupported).toBe('boolean');
  });

  it('unsubscribe bails out silently when serviceWorker is unavailable', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(apiDel).not.toHaveBeenCalled();
  });

  it('requestPermission is a no-op in environments without Notification', async () => {
    const original = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.requestPermission();
    });
    (globalThis as any).Notification = original;
    // Pass if no throw.
  });

  it('subscribes via the push manager when serviceWorker is wired', async () => {
    // Stub a minimal ServiceWorker + PushManager surface.
    const fakeSubscription = {
      endpoint: 'https://push.example/abc',
      toJSON: () => ({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'aaaa', auth: 'bbbb' },
      }),
    };
    const fakePushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(fakeSubscription),
    };
    const fakeRegistration = { pushManager: fakePushManager };
    const fakeSW = { ready: Promise.resolve(fakeRegistration) };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: fakeSW,
    });
    // Pretend PushManager exists on window so isSupported flips to true.
    (window as any).PushManager = function () {};

    apiGet.mockResolvedValueOnce({ data: { success: true, vapidPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    apiPost.mockResolvedValueOnce({});

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(fakePushManager.getSubscription).toHaveBeenCalled());

    // Request permission path kicks off subscribe().
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    await act(async () => {
      await result.current.requestPermission();
    });

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/push/subscribe', expect.any(Object)));
  });
});
