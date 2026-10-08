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
  /** Fires controllerchange and names the controller: navigator.serviceWorker in the app. */
  container?: Pick<EventTarget, 'addEventListener'> & { readonly controller?: ServiceWorker | null };
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
  let registered: Pick<ServiceWorkerRegistration, 'active'> | undefined;
  // A page loaded with no controller came from the network: the build active as it registered,
  // still activating, then claims it with that same build. That claim is not a takeover.
  // (The default container is absent where navigator.serviceWorker is, as in jsdom.)
  const loadedUncontrolled = (container?.controller ?? null) === null;
  let ownClaim: ServiceWorker | null = null;
  const reloadOnTakeover = (): void => {
    if (armed) return;
    armed = true;
    let reloaded = false;
    container.addEventListener('controllerchange', () => {
      if (reloaded) return;
      if (ownClaim !== null && container.controller === ownClaim) return;
      reloaded = true;
      reload();
    });
  };
  apply = register({
    immediate: true,
    onNeedRefresh() {
      // The plugin also calls this for a worker another page registered, even the first install,
      // which waits for nothing and claims this page: not an update, and no reload mid-sign-in.
      if (registered !== undefined && registered.active === null) return;
      updateReady.value = true;
      reloadOnTakeover();
    },
    // The reload above covers every page; the plugin's would be a second one.
    onNeedReload() {},
    onRegisteredSW(swUrl, registration) {
      if (registration === undefined) return;
      registered = registration;
      // With no active build yet, the first install's claim of this page is not an update.
      if (registration.active !== null) {
        if (loadedUncontrolled) ownClaim = registration.active;
        reloadOnTakeover();
      }
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
