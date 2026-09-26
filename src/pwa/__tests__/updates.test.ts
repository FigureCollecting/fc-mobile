import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { applyUpdate, startServiceWorker, updateReady, UPDATE_CHECK_MS } from '../updates';

type Registration = Pick<ServiceWorkerRegistration, 'installing' | 'update'>;

function fakeRegister() {
  const apply = vi.fn(async () => undefined);
  let options: RegisterSWOptions = {};
  const register = vi.fn((o: RegisterSWOptions) => {
    options = o;
    return apply;
  });
  return { register, apply, options: () => options };
}

function registration(over: Partial<Registration> = {}): Registration & { update: ReturnType<typeof vi.fn> } {
  return { installing: null, update: vi.fn(async () => undefined), ...over } as never;
}

const ok = () => vi.fn(async () => ({ status: 200, redirected: false }) as Response);

beforeEach(() => {
  vi.useFakeTimers();
  updateReady.value = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startServiceWorker', () => {
  it('registers at once, in prompt mode (never reloads by itself)', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true });
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(f.options().immediate).toBe(true);
    expect(f.options().onNeedReload).toBeUndefined();
  });

  it('does nothing where service workers are unsupported', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, supported: false });
    expect(f.register).not.toHaveBeenCalled();
  });

  it('raises the prompt when a new worker is waiting', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true });
    expect(updateReady.value).toBe(false);
    f.options().onNeedRefresh?.();
    expect(updateReady.value).toBe(true);
  });

  it('applyUpdate asks the waiting worker to take over and reload the page', async () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true });
    await applyUpdate();
    expect(f.apply).toHaveBeenCalledWith(true);
  });

  it('reports a failed registration without throwing', () => {
    const f = fakeRegister();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true });
    f.options().onRegisterError?.(new Error('boom'));
    expect(warn).toHaveBeenCalled();
  });
});

describe('update checks', () => {
  function started(fetchImpl = ok(), reg = registration()) {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl, supported: true });
    f.options().onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    return { reg, fetchImpl };
  }

  it('checks hourly, fetching sw.js past every cache first', async () => {
    const { reg, fetchImpl } = started();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(fetchImpl).toHaveBeenCalledWith('/sw.js', expect.objectContaining({ cache: 'no-store' }));
    expect(reg.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('checks when the connection comes back and when the app returns to the foreground', async () => {
    const { reg } = started();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('ignores hiding the app', async () => {
    const { reg } = started();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.update).not.toHaveBeenCalled();
  });

  it('skips the check offline, while a worker is installing, or when sw.js is not a plain 200', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(false);
    const offline = started();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(offline.fetchImpl).not.toHaveBeenCalled();

    const installing = started(ok(), registration({ installing: {} as ServiceWorker }));
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(installing.reg.update).not.toHaveBeenCalled();

    const down = started(vi.fn(async () => ({ status: 503, redirected: false }) as Response));
    const redirected = started(vi.fn(async () => ({ status: 200, redirected: true }) as Response));
    const unreachable = started(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(down.reg.update).not.toHaveBeenCalled();
    expect(redirected.reg.update).not.toHaveBeenCalled();
    expect(unreachable.reg.update).not.toHaveBeenCalled();
  });

  it('swallows a failed update() (the next check retries)', async () => {
    const reg = registration({ update: vi.fn(async () => Promise.reject(new Error('network'))) });
    started(ok(), reg);
    await expect(vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)).resolves.not.toThrow();
  });

  it('does not watch without a registration', () => {
    const f = fakeRegister();
    const fetchImpl = ok();
    startServiceWorker({ register: f.register, fetchImpl, supported: true });
    f.options().onRegisteredSW?.('/sw.js', undefined);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('defaults', () => {
  it('detects support from navigator.serviceWorker', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register });
    expect(f.register).toHaveBeenCalledTimes('serviceWorker' in navigator ? 1 : 0);
  });
});
