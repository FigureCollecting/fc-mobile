/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker registration with a prompt-style update. A new build waits
// until the user reloads, and the old shell keeps its precache meanwhile; once a
// newer build controls a page, that page reloads, so no old shell outlives it.
import { signal } from '@preact/signals';
import { registerSW, type RegisterSWOptions } from 'virtual:pwa-register';

export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** True once a new build is installed and waiting for the user. */
export const updateReady = signal(false);

/** What a check for a newer build found; Settings words each one. */
export type UpdateCheck = 'ready' | 'latest' | 'offline' | 'unavailable';

type Registration = Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'waiting' | 'update'>;

let apply: ((reloadPage?: boolean) => Promise<void>) | undefined;
/** The registered worker's check; unset where there is no service worker. */
let checkNow: (() => Promise<UpdateCheck>) | undefined;

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
  checkNow = undefined;
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
      checkNow = watchForUpdates(swUrl, registration, fetchImpl);
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

/**
 * Look for a newer build now, as the hourly, reconnect and foreground checks do. A newer build
 * installs and raises the update prompt. Never rejects.
 */
export function checkForUpdate(): Promise<UpdateCheck> {
  return checkNow?.() ?? Promise.resolve('unavailable');
}

/** How long a check waits for a newer build to finish installing before it gives up. */
export const INSTALL_WAIT_MS = 30 * 1000;

/** A newer build waits behind the active one; the first build, about to activate, is not one. */
const newerWaiting = (registration: Registration): boolean =>
  registration.active !== null && registration.waiting !== null;

/**
 * A newer build that is installing is ready once installed (it then waits, and the prompt shows).
 * One that fails to install (a precached asset 404s mid-deploy) turns redundant and nothing waits;
 * neither that nor one still installing after INSTALL_WAIT_MS is a version to offer.
 */
function installOutcome(worker: ServiceWorker): Promise<UpdateCheck> {
  return new Promise((resolve) => {
    const settle = (): void => {
      if (worker.state === 'installing') return;
      done(worker.state === 'redundant' ? 'offline' : 'ready');
    };
    const timer = setTimeout(() => done('offline'), INSTALL_WAIT_MS);
    function done(result: UpdateCheck): void {
      clearTimeout(timer);
      worker.removeEventListener('statechange', settle);
      resolve(result);
    }
    worker.addEventListener('statechange', settle);
    settle();
  });
}

/** What the registration holds after a check; the first install is not a newer build. */
function found(registration: Registration): UpdateCheck | Promise<UpdateCheck> {
  if (registration.active === null) return 'latest';
  if (registration.waiting !== null) return 'ready';
  return registration.installing === null ? 'latest' : installOutcome(registration.installing);
}

function watchForUpdates(swUrl: string, registration: Registration, fetchImpl: typeof fetch): () => Promise<UpdateCheck> {
  /** Asks the browser to look for a newer sw.js; false when the server could not be asked. */
  const askServer = async (): Promise<boolean> => {
    if (!navigator.onLine) return false;
    try {
      // update() rejects when the server is down, and an Access login redirect
      // is not a new worker: only a plain 200 for sw.js goes on to update().
      const res = await fetchImpl(swUrl, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (res.status !== 200 || res.redirected) return false;
      await registration.update();
      return true;
    } catch {
      // Offline or mid-deploy; the next check retries.
      return false;
    }
  };
  const check = async (): Promise<UpdateCheck> => {
    // A build already installing is the newest one there is: wait for it rather than ask again.
    if (registration.installing === null && !(await askServer())) {
      // A newer build already waiting is ready (its prompt is up) whatever the network.
      return newerWaiting(registration) ? 'ready' : 'offline';
    }
    return found(registration);
  };
  setInterval(() => void check(), UPDATE_CHECK_MS);
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  return check;
}
