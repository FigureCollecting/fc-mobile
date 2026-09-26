import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { API_NAVIGATION } from '../routes';

// Workbox is mocked so the entry's wiring can be read back; its behaviour in a
// real browser is covered by e2e/pwa.
const wb = vi.hoisted(() => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn((url: string) => ({ boundTo: url })),
  registerRoute: vi.fn(),
  clientsClaim: vi.fn(),
  NavigationRoute: vi.fn(function (this: Record<string, unknown>, handler: unknown, options: unknown) {
    this.handler = handler;
    this.options = options;
  }),
  CacheFirst: vi.fn(function (this: Record<string, unknown>, options: unknown) {
    this.options = options;
  }),
  CacheableResponsePlugin: vi.fn(function (this: Record<string, unknown>, config: unknown) {
    this.config = config;
  }),
}));
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: wb.precacheAndRoute,
  cleanupOutdatedCaches: wb.cleanupOutdatedCaches,
  createHandlerBoundToURL: wb.createHandlerBoundToURL,
}));
vi.mock('workbox-routing', () => ({ registerRoute: wb.registerRoute, NavigationRoute: wb.NavigationRoute }));
vi.mock('workbox-strategies', () => ({ CacheFirst: wb.CacheFirst }));
vi.mock('workbox-cacheable-response', () => ({ CacheableResponsePlugin: wb.CacheableResponsePlugin }));
vi.mock('workbox-core', () => ({ clientsClaim: wb.clientsClaim }));

type Listener = (event: unknown) => void;
const listeners: Record<string, Listener[]> = {};
const skipWaiting = vi.fn(async () => undefined);
const MANIFEST = [{ url: '/index.html', revision: 'r1' }];

beforeAll(async () => {
  const scope = self as unknown as Record<string, unknown>;
  scope.__WB_MANIFEST = MANIFEST;
  scope.skipWaiting = skipWaiting;
  vi.spyOn(self, 'addEventListener').mockImplementation(((type: string, fn: Listener) => {
    (listeners[type] ??= []).push(fn);
  }) as typeof self.addEventListener);
  await import('../../sw');
});

const ORIGIN = 'https://figurecollecting.com';
function ctx(p: string, method = 'GET', origin = ORIGIN) {
  const url = new URL(p, origin);
  return { url, request: new Request(url, { method }), sameOrigin: url.origin === ORIGIN, event: {} };
}

describe('service worker wiring', () => {
  it('precaches the injected manifest and drops caches of older builds', () => {
    expect(wb.precacheAndRoute).toHaveBeenCalledWith(MANIFEST);
    expect(wb.cleanupOutdatedCaches).toHaveBeenCalledTimes(1);
  });

  it('answers navigations with the precached shell, except under /api', () => {
    expect(wb.createHandlerBoundToURL).toHaveBeenCalledWith('/index.html');
    const nav = wb.NavigationRoute.mock.instances[0] as unknown as { handler: unknown; options: { denylist: RegExp[] } };
    expect(nav.handler).toEqual({ boundTo: '/index.html' });
    expect(wb.registerRoute).toHaveBeenCalledWith(nav);
    // routes.test.ts runs this denylist through the real NavigationRoute.
    expect(nav.options.denylist).toEqual([API_NAVIGATION]);
  });

  it('serves content-addressed derivatives CacheFirst, caching only status 200', () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { options: { cacheName: string; plugins: unknown[] } };
    expect(cacheFirst.options.cacheName).toBe('fc-derivatives-v1');
    expect(wb.CacheableResponsePlugin).toHaveBeenCalledWith({ statuses: [200] });
    expect(cacheFirst.options.plugins).toEqual([wb.CacheableResponsePlugin.mock.instances[0]]);
    const call = wb.registerRoute.mock.calls.find(([, handler]) => handler === cacheFirst);
    const match = call?.[0] as (c: ReturnType<typeof ctx>) => boolean;
    expect(match(ctx(`/media/d/${'ab'.repeat(32)}`))).toBe(true);
    expect(match(ctx(`/media/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com'))).toBe(false);
  });

  it('registers exactly two routes of its own, and none that matches /api', () => {
    expect(wb.registerRoute).toHaveBeenCalledTimes(2);
    const matchers = wb.registerRoute.mock.calls
      .map(([m]) => m)
      .filter((m): m is (c: ReturnType<typeof ctx>) => boolean => typeof m === 'function');
    fc.assert(
      fc.property(fc.webPath(), fc.constantFrom('GET', 'POST', 'PUT'), (tail, method) => {
        const p = `/api${tail.startsWith('/') ? tail : `/${tail}`}`;
        return matchers.every((m) => !m(ctx(p, method)));
      }),
    );
  });

  it('claims open pages on first install so they are served offline', () => {
    expect(wb.clientsClaim).toHaveBeenCalledTimes(1);
  });

  it('waits for the page to accept an update: skipWaiting only on SKIP_WAITING', () => {
    const [onMessage] = listeners.message ?? [];
    onMessage?.({ data: { type: 'OTHER' } });
    onMessage?.({ data: null });
    expect(skipWaiting).not.toHaveBeenCalled();
    onMessage?.({ data: { type: 'SKIP_WAITING' } });
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('has no Background Sync: no sync listener and no workbox-background-sync', () => {
    expect(listeners.sync).toBeUndefined();
    expect(listeners.periodicsync).toBeUndefined();
    const source = readFileSync(path.resolve(__dirname, '../../sw.ts'), 'utf8');
    expect(source).not.toMatch(/background-sync|BackgroundSync/);
  });
});
