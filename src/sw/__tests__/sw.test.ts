import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { API_NAVIGATION } from '../routes';
import { BROWSED_MEDIA_CACHE } from '../../media/ownedImages';

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
  ExpirationPlugin: vi.fn(function (this: Record<string, unknown>, config: unknown) {
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
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: wb.ExpirationPlugin }));
vi.mock('workbox-core', () => ({ clientsClaim: wb.clientsClaim }));

type Listener = (event: unknown) => void;
const listeners: Record<string, Listener[]> = {};
const skipWaiting = vi.fn(async () => undefined);
const MANIFEST = [{ url: '/index.html', revision: 'r1' }];
// The owned-figure cache the page fills (src/media/ownedImages.ts): one entry, read first.
const OWNED_URL = `https://images.figurecollecting.com/d/${'cd'.repeat(32)}`;
const ownedResponse = new Response('owned');
const opened: string[] = [];
const matchOptions: (CacheQueryOptions | undefined)[] = [];

beforeAll(async () => {
  const scope = self as unknown as Record<string, unknown>;
  scope.__WB_MANIFEST = MANIFEST;
  scope.skipWaiting = skipWaiting;
  scope.caches = {
    open: async (name: string) => {
      opened.push(name);
      return {
        match: async (r: Request | string, options?: CacheQueryOptions) => {
          matchOptions.push(options);
          return new URL(typeof r === 'string' ? r : r.url).href === OWNED_URL ? ownedResponse : undefined;
        },
      };
    },
  };
  vi.spyOn(self, 'addEventListener').mockImplementation(((type: string, fn: Listener) => {
    (listeners[type] ??= []).push(fn);
  }) as typeof self.addEventListener);
  await import('../../sw');
});

const ORIGIN = 'https://figurecollecting.com';
/** A request as an <img> makes it: Request's own destination is '' outside a browser's fetch. */
const asImage = (request: Request): Request => Object.defineProperty(request, 'destination', { value: 'image' });
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

  it('serves the public image address from the owned-figure cache first, else CacheFirst for an <img>, keeping only a CORS 200, bounded', async () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { options: { cacheName: string; plugins: unknown[]; matchOptions: CacheQueryOptions }; handle?: unknown };
    // The one the owned sync also deletes from (src/media/ownedImages.ts).
    expect(cacheFirst.options.cacheName).toBe(BROWSED_MEDIA_CACHE);
    // The origin sends Vary: Origin (fc-infra edge README); an <img crossorigin> request then misses a
    // response a fetch() stored, so the content-addressed caches ignore Vary (one app origin per worker).
    expect(cacheFirst.options.matchOptions).toEqual({ ignoreVary: true });
    expect(wb.CacheableResponsePlugin).toHaveBeenCalledWith({ statuses: [200] });
    expect(wb.ExpirationPlugin).toHaveBeenCalledWith({ maxEntries: 200, purgeOnQuotaError: true });
    expect(cacheFirst.options.plugins).toEqual([wb.CacheableResponsePlugin.mock.instances[0], wb.ExpirationPlugin.mock.instances[0]]);

    const call = wb.registerRoute.mock.calls.find(([m]) => typeof m === 'function' && m !== undefined && (m as (c: unknown) => boolean)(ctx(`/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com')));
    expect(call).toBeDefined();
    const [match, handler] = call as unknown as [(c: ReturnType<typeof ctx>) => boolean, (o: { request: Request }) => Promise<Response>];
    expect(match(ctx(`/media/d/${'ab'.repeat(32)}`))).toBe(false);

    const browsed = new Response('browsed');
    (cacheFirst as unknown as { handle: (o: unknown) => Promise<Response> }).handle = vi.fn(async () => browsed);
    expect(await handler({ request: new Request(OWNED_URL) })).toBe(ownedResponse);
    expect(opened).toEqual(['fc-owned-media-v1']);
    expect(matchOptions).toEqual([{ ignoreVary: true }]);
    expect((cacheFirst as unknown as { handle: ReturnType<typeof vi.fn> }).handle).not.toHaveBeenCalled();
    // An <img> of any other image: the browsed cache.
    const shown = { request: asImage(new Request(`https://images.figurecollecting.com/d/${'ab'.repeat(32)}`)) };
    expect(await handler(shown)).toBe(browsed);
    expect((cacheFirst as unknown as { handle: ReturnType<typeof vi.fn> }).handle).toHaveBeenCalledWith(shown);
  });

  it('sends the page\'s own fetch of an image (the owned sync\'s Cache.add) to the origin, never into the browsed cache', async () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { handle: ReturnType<typeof vi.fn> };
    cacheFirst.handle = vi.fn(async () => new Response('browsed'));
    const [, handler] = wb.registerRoute.mock.calls.find(([m]) => typeof m === 'function' && (m as (c: unknown) => boolean)(ctx(`/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com'))) as unknown as [unknown, (o: { request: Request }) => Promise<Response>];
    const network = new Response('origin');
    const fetchSpy = vi.fn(async () => network);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const request = new Request(`https://images.figurecollecting.com/d/${'ef'.repeat(32)}`, { mode: 'cors', credentials: 'omit' });
      expect(request.destination).toBe('');
      expect(await handler({ request })).toBe(network);
      expect(fetchSpy).toHaveBeenCalledWith(request);
      expect(cacheFirst.handle).not.toHaveBeenCalled();
      // An owned image is still answered from its cache first, whoever asks.
      expect(await handler({ request: new Request(OWNED_URL) })).toBe(ownedResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
