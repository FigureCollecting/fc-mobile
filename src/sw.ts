/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (injected by VitePWA injectManifest)
precacheAndRoute(self.__WB_MANIFEST);

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
