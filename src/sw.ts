/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { API_NAVIGATION, isDerivativeRequest } from './sw/routes';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (injected by VitePWA injectManifest). The old build's
// entries stay until this worker activates, so an open old shell keeps working.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Deep links cold-start offline from the precached shell. /api is the
// coordinator on this origin: never answered here, online or off.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [API_NAVIGATION] }));

registerRoute(
  isDerivativeRequest,
  new CacheFirst({
    cacheName: 'fc-derivatives-v1',
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  }),
);

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
