/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { API_NAVIGATION, isDerivativeRequest } from './sw/routes';
import { BROWSED_MEDIA_CACHE, OWNED_MEDIA_CACHE, WITHHELD_CACHE, withheldKey } from './media/ownedImages';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (injected by VitePWA injectManifest). The old build's
// entries stay until this worker activates, so an open old shell keeps working.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Deep links cold-start offline from the precached shell. /api is the
// coordinator on this origin: never answered here, online or off.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [API_NAVIGATION] }));

// Derivatives and masks on the one public image address. An address the last owned sync withheld (a
// record in fc-withheld-v1, src/media/ownedImages.ts) is refused first, a network error: no cache
// answers it, nothing is fetched or stored, online or offline. The owned figures' images come next,
// from the cache the page fills and evicts with the collection. Any other image an <img> shows is
// CacheFirst in its own bounded cache. The page's own fetch of an image (the
// owned sync's Cache.add) goes to the origin and is never stored here a second time. Every fetch this
// route sends is cache 'no-store', so it neither reads nor fills the browser's HTTP cache: the origin
// answers immutable, and a copy there would outlive the sync's eviction. For the same reason the page
// gets every answer as a copy marked Cache-Control: no-store. Chromium's memory cache inside a tab
// keeps an immutable image and draws it in a later document of that tab without asking the worker,
// after an eviction too; that was measured outside the suite only, as every e2e context is routed and
// a route turns that cache off. A document also draws again, without a request, an image it already
// decoded (measured outside the suite too). An opaque answer cannot be copied and goes as it is, the origin's immutable with it. The
// <img>s of the case view, the figure page, JustifiedRows and DetailPane set crossorigin (their tests
// pin it). PhotoSwipe's <img> in the Collection's FigureViewer does not: it asks in no-cors mode, is
// answered from either cache as any request is, and on a miss in both gets the origin's opaque answer
// as it is, immutable, which is never stored here. src/sw/__tests__/sw.test.ts pins the refusal, the
// fetches and the copies; e2e/pwa (b) checks the header on every answer, the refusal online and
// offline, and, with Chromium's caches off, the worker's caches. A document the worker does not
// control yet (a first visit before clientsClaim, a shift-reload) loads its <img>s through the HTTP
// cache, and that copy outlives an eviction; no fetch of this route or the sync reads it.
// Only a CORS 200 is kept: an opaque response (status 0) can be neither measured nor composited, and
// costs ~7 MB of quota each. Both caches ignore Vary: the origin sends Vary: Origin, and an <img
// crossorigin> request then misses a response a fetch() stored (measured in e2e/pwa (b)); the bytes
// are content-addressed and a worker serves one origin.
const IGNORE_VARY = { ignoreVary: true };
const NO_STORE: RequestInit = { cache: 'no-store' };
/** Status 0, no headers or body to copy: an opaque answer, an opaque redirect, a network error. */
const UNCOPYABLE: ReadonlySet<ResponseType> = new Set(['opaque', 'opaqueredirect', 'error']);
/** The answer the page gets: a copy marked no-store, the status, body and other headers as they were. */
function forThePage(response: Response): Response {
  if (UNCOPYABLE.has(response.type)) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const browsed = new CacheFirst({
  cacheName: BROWSED_MEDIA_CACHE,
  matchOptions: IGNORE_VARY,
  fetchOptions: NO_STORE,
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 200, purgeOnQuotaError: true })],
});
registerRoute(isDerivativeRequest, async (options: { request: Request }) => {
  if ((await (await self.caches.open(WITHHELD_CACHE)).match(withheldKey(options.request.url))) !== undefined) return Response.error();
  const owned = await (await self.caches.open(OWNED_MEDIA_CACHE)).match(options.request, IGNORE_VARY);
  if (owned !== undefined) return forThePage(owned);
  return forThePage(await (options.request.destination === 'image' ? browsed.handle(options as never) : fetch(options.request, NO_STORE)));
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
