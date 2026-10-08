import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { applyUpdate, reloadToLatest, startServiceWorker, updateReady, UPDATE_CHECK_MS } from '../updates';

type Registration = Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'update'>;

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
  return { active: null, installing: null, update: vi.fn(async () => undefined), ...over } as never;
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
  it('registers at once, in prompt mode', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true, container: new EventTarget() });
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(f.options().immediate).toBe(true);
  });

  it('does nothing where service workers are unsupported', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, supported: false });
    expect(f.register).not.toHaveBeenCalled();
  });

  it('raises the prompt when a new worker is waiting', () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true, container: new EventTarget() });
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

describe('taking the new build', () => {
  function started() {
    const f = fakeRegister();
    const container = new EventTarget();
    const reload = vi.fn();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true, container, reload });
    const takeOver = () => container.dispatchEvent(new Event('controllerchange'));
    return { f, reload, takeOver };
  }

  it('reloads once the waiting build controls the page, even a page that had no controller at load', () => {
    const { f, reload, takeOver } = started();
    f.options().onNeedRefresh?.();
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the first install claims the page (no build was waiting)', () => {
    const { reload, takeOver } = started();
    takeOver();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once, however often the prompt is raised or control changes', () => {
    const { f, reload, takeOver } = started();
    f.options().onNeedRefresh?.();
    f.options().onNeedRefresh?.();
    takeOver();
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on a change of controller in a page that registered over an active build (returning or hard-reloaded)', () => {
    const { f, reload, takeOver } = started();
    f.options().onRegisteredSW?.('/sw.js', registration({ active: {} as ServiceWorker }) as unknown as ServiceWorkerRegistration);
    takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not treat the first install as an update: no active build when the page registered', () => {
    const { f, reload, takeOver } = started();
    f.options().onRegisteredSW?.('/sw.js', registration({ installing: {} as ServiceWorker }) as unknown as ServiceWorkerRegistration);
    takeOver();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not treat another page's first install as an update: no prompt and no reload when it installs with no active build", () => {
    // The plugin raises onNeedRefresh for a worker another page registered (isExternal), even the
    // first one, which activates at once and claims this page: a sign-in callback reloaded mid-exchange.
    const { f, reload, takeOver } = started();
    const reg = registration({ installing: {} as ServiceWorker });
    f.options().onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    f.options().onNeedRefresh?.();
    takeOver();
    expect(updateReady.value).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('still takes a later build that waits behind the active one in the same page', () => {
    const { f, reload, takeOver } = started();
    const reg = registration({ installing: {} as ServiceWorker });
    f.options().onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    Object.assign(reg, { installing: null, active: {} as ServiceWorker });
    f.options().onNeedRefresh?.();
    takeOver();
    expect(updateReady.value).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('owns the reload: the plugin reloads only pages controlled at load, and never twice', () => {
    const { f, reload } = started();
    expect(f.options().onNeedReload).toBeTypeOf('function');
    f.options().onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();
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

describe('reloadToLatest', () => {
  it('hands control to a waiting build, whose takeover reloads the page, instead of reloading the old shell', async () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true, container: new EventTarget() });
    updateReady.value = true;
    const reload = vi.fn();
    await reloadToLatest(reload);
    expect(f.apply).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when no newer build is waiting', async () => {
    const f = fakeRegister();
    startServiceWorker({ register: f.register, fetchImpl: ok(), supported: true, container: new EventTarget() });
    const reload = vi.fn();
    await reloadToLatest(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(f.apply).not.toHaveBeenCalled();
  });
});
