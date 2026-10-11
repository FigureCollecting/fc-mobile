/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { API_NAVIGATION, isDerivativeRequest } from './sw/routes';
import { BROWSED_MEDIA_CACHE, OWNED_MEDIA_CACHE } from './media/ownedImages';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (injected by VitePWA injectManifest). The old build's
// entries stay until this worker activates, so an open old shell keeps working.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Deep links cold-start offline from the precached shell. /api is the
// coordinator on this origin: never answered here, online or off.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [API_NAVIGATION] }));

// Derivatives and masks on the one public image address. The owned figures' images come first,
// from the cache the page fills and evicts with the collection (src/media/ownedImages.ts). Any other
// image an <img> shows is CacheFirst in its own bounded cache. The page's own fetch of an image (the
// owned sync's Cache.add) goes to the origin and is never stored here a second time. Every fetch this
// route sends is cache 'no-store', so it neither reads nor fills the browser's HTTP cache: the origin
// answers immutable, and a copy there would outlive the sync's eviction. So the worker never answers
// from the HTTP cache (src/sw/__tests__/sw.test.ts pins the fetches; e2e/pwa (b) runs with the HTTP
// cache off, as every Playwright route turns it off, and proves the worker's caches). A document the
// worker does not control yet (a first visit before clientsClaim, a shift-reload) loads its <img>s
// through the HTTP cache, and that copy outlives an eviction; no fetch of this route or the sync reads it.
// Only a CORS 200 is kept: an opaque response (status 0) can be neither measured nor composited, and
// costs ~7 MB of quota each. Both caches ignore Vary: the origin sends Vary: Origin, and an <img
// crossorigin> request then misses a response a fetch() stored (measured in e2e/pwa (b)); the bytes
// are content-addressed and a worker serves one origin.
const IGNORE_VARY = { ignoreVary: true };
const NO_STORE: RequestInit = { cache: 'no-store' };
const browsed = new CacheFirst({
  cacheName: BROWSED_MEDIA_CACHE,
  matchOptions: IGNORE_VARY,
  fetchOptions: NO_STORE,
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 200, purgeOnQuotaError: true })],
});
registerRoute(isDerivativeRequest, async (options: { request: Request }) => {
  const owned = await (await self.caches.open(OWNED_MEDIA_CACHE)).match(options.request, IGNORE_VARY);
  if (owned !== undefined) return owned;
  return options.request.destination === 'image' ? browsed.handle(options as never) : fetch(options.request, NO_STORE);
});

clientsClaim();

// Prompt-style update: the new worker waits until the page asks. All state is
// in IndexedDB, so the reload that follows loses nothing. No Background Sync:
// the outbox holds intent and flushes from the page.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// ─── Push Notification Handler ──────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'FigureCollecting', {
      body: data.body,
      icon: data.icon ?? '/icons/icon-192.png',
      badge: data.badge ?? '/icons/badge-72.png',
      data: { url: data.url },
      tag: data.tag,
    }),
  );
});

// ─── Notification Click Handler ─────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If the app is already open, focus it and navigate
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    }),
  );
});
