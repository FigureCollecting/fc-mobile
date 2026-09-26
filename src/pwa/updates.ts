/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker registration with a prompt-style update. A new build waits
// until the user reloads; the old shell keeps its own precache meanwhile, and
// frequent checks keep it from running long against a newer API.
import { signal } from '@preact/signals';
import { registerSW, type RegisterSWOptions } from 'virtual:pwa-register';

export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** True once a new build is installed and waiting for the user. */
export const updateReady = signal(false);

let apply: ((reloadPage?: boolean) => Promise<void>) | undefined;

export interface StartOptions {
  register?: (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;
  fetchImpl?: typeof fetch;
  supported?: boolean;
}

export function startServiceWorker({
  register = registerSW,
  fetchImpl = (...args) => fetch(...args),
  supported = 'serviceWorker' in navigator,
}: StartOptions = {}): void {
  if (!supported) return;
  apply = register({
    immediate: true,
    onNeedRefresh() {
      updateReady.value = true;
    },
    onRegisteredSW(swUrl, registration) {
      if (registration !== undefined) watchForUpdates(swUrl, registration, fetchImpl);
    },
    onRegisterError(error) {
      console.warn('[sw] registration failed', error);
    },
  });
}

/** Hand control to the waiting build; the page reloads once it is in charge. */
export function applyUpdate(): Promise<void> {
  return apply?.(true) ?? Promise.resolve();
}

function watchForUpdates(
  swUrl: string,
  registration: Pick<ServiceWorkerRegistration, 'installing' | 'update'>,
  fetchImpl: typeof fetch,
): void {
  const check = async (): Promise<void> => {
    if (registration.installing !== null || !navigator.onLine) return;
    try {
      // update() rejects when the server is down, and an Access login redirect
      // is not a new worker: only a plain 200 for sw.js goes on to update().
      const res = await fetchImpl(swUrl, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (res.status === 200 && !res.redirected) await registration.update();
    } catch {
      // Offline or mid-deploy; the next check retries.
    }
  };
  setInterval(() => void check(), UPDATE_CHECK_MS);
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
