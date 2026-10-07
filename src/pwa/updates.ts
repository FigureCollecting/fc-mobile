/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker registration with a prompt-style update. A new build waits
// until the user reloads, and the old shell keeps its precache meanwhile; once a
// newer build controls a page, that page reloads, so no old shell outlives it.
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
  /** Fires controllerchange: navigator.serviceWorker in the app. */
  container?: Pick<EventTarget, 'addEventListener'>;
  reload?: () => void;
}

export function startServiceWorker({
  register = registerSW,
  fetchImpl = (...args) => fetch(...args),
  supported = 'serviceWorker' in navigator,
  container = navigator.serviceWorker,
  reload = () => window.location.reload(),
}: StartOptions = {}): void {
  if (!supported) return;
  // Once this page runs over an installed build, a change of controller is a
  // newer build taking over (from this tab or another) and the old precache is
  // gone: reload. The plugin reloads only pages that had a controller at load.
  let armed = false;
  const reloadOnTakeover = (): void => {
    if (armed) return;
    armed = true;
    container.addEventListener('controllerchange', () => reload(), { once: true });
  };
  apply = register({
    immediate: true,
    onNeedRefresh() {
      updateReady.value = true;
      reloadOnTakeover();
    },
    // The reload above covers every page; the plugin's would be a second one.
    onNeedReload() {},
    onRegisteredSW(swUrl, registration) {
      if (registration === undefined) return;
      // With no active build yet, the first install's claim of this page is not an update.
      if (registration.active !== null) reloadOnTakeover();
      watchForUpdates(swUrl, registration, fetchImpl);
    },
    onRegisterError(error) {
      console.warn('[sw] registration failed', error);
    },
  });
}

/** Hand control to the waiting build; the page reloads when it takes over. */
export function applyUpdate(): Promise<void> {
  return apply?.(true) ?? Promise.resolve();
}

/**
 * Reload into the newest build. A build already waiting takes over instead (its takeover
 * reloads the page), so the reload does not bring back the old shell from the precache.
 */
export function reloadToLatest(reload: () => void = () => window.location.reload()): Promise<void> {
  if (updateReady.value) return applyUpdate();
  reload();
  return Promise.resolve();
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
