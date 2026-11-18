import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';
import { usePushNotifications } from '../usePushNotifications';

// FLIP-LEGACY-REST: no server holds push subscriptions, so the hook asks the browser and nothing else. Every request
// it could send is caught here and answered 401, as the coordinator answers an unknown /api path at the apex, where
// the old REST client then sent the page to /login.
const sent: string[] = [];

class Xhr401 {
  status = 0;
  statusText = '';
  readyState = 0;
  response = '';
  responseText = '';
  responseURL = '';
  responseType = '';
  timeout = 0;
  withCredentials = false;
  onloadend: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private call = '';
  open(method: string, url: string) {
    this.call = `${method.toUpperCase()} ${url}`;
  }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return 'content-type: application/json\r\n';
  }
  abort() {}
  send() {
    sent.push(this.call);
    queueMicrotask(() => {
      Object.assign(this, { status: 401, statusText: 'Unauthorized', readyState: 4, response: '{}', responseText: '{}' });
      this.onloadend?.();
    });
  }
}

const assign = vi.fn();

interface FakeSubscription {
  endpoint: string;
  unsubscribe: ReturnType<typeof vi.fn>;
}

/** A service worker whose push manager holds `existing`, and a window that has push. */
function wirePush(existing: FakeSubscription | null) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/new' }),
  };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal('PushManager', function PushManager() {});
  return pushManager;
}

function answerPermission(answer: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue(answer);
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  return requestPermission;
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    sent.length = 0;
    assign.mockReset();
    vi.stubGlobal('XMLHttpRequest', Xhr401);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        sent.push(`FETCH ${String(input)}`);
        return new Response('{}', { status: 401 });
      }),
    );
    // The app at the apex, on a screen that is not /login.
    vi.stubGlobal('location', { origin: 'https://figurecollecting.com', href: 'https://figurecollecting.com/profile', pathname: '/profile', assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('reports the permission the browser holds, and no push where the browser has none', () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBe('default');
    expect(result.current.isSupported).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('reports default permission where the browser has no Notification at all', () => {
    vi.stubGlobal('Notification', undefined);
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBe('default');
  });

  it("reports a subscription the browser's push manager already holds", async () => {
    const pushManager = wirePush({ endpoint: 'https://push.example/abc', unsubscribe: vi.fn().mockResolvedValue(true) });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
    expect(result.current.isSupported).toBe(true);
    expect(pushManager.getSubscription).toHaveBeenCalledTimes(1);
  });

  it('stays unsubscribed when the service worker never becomes ready', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.reject(new Error('no worker')) } });
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.isSubscribed).toBe(false);
  });

  it('asks the browser for permission and sends nothing to any server: no request, no trip to /login', async () => {
    const pushManager = wirePush(null);
    const requestPermission = answerPermission('granted');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(pushManager.getSubscription).toHaveBeenCalled());

    await act(async () => {
      await result.current.requestPermission();
      // Past the old client's 401 handling, had it been called.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current.permission).toBe('granted');
    expect(assign).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    // No server key to subscribe with, so the browser is not subscribed either.
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('records a refusal', async () => {
    wirePush(null);
    answerPermission('denied');
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(result.current.permission).toBe('denied');
    expect(sent).toEqual([]);
  });

  it('requestPermission does nothing where the browser has no Notification', async () => {
    vi.stubGlobal('Notification', undefined);
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(result.current.permission).toBe('default');
  });

  it("unsubscribe drops the browser's subscription and sends nothing to any server", async () => {
    const existing = { endpoint: 'https://push.example/abc', unsubscribe: vi.fn().mockResolvedValue(true) };
    wirePush(existing);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));

    await act(async () => {
      await result.current.unsubscribe();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('unsubscribe with nothing subscribed leaves the hook unsubscribed', async () => {
    wirePush(null);
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribe does nothing where the browser has no service worker', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the subscription it reports when the browser fails to drop it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const existing = { endpoint: 'https://push.example/abc', unsubscribe: vi.fn().mockRejectedValue(new Error('refused')) };
    wirePush(existing);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(error).toHaveBeenCalledWith('[Push] Failed to unsubscribe:', expect.any(Error));
    error.mockRestore();
  });
});
