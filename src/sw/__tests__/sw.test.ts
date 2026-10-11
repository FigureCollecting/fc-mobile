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
// As the origin answers (fc-infra edge README): immutable for a year.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ORIGIN_HEADERS = { 'content-type': 'image/png', 'cache-control': IMMUTABLE, 'x-origin': 'kept' };
/**
 * A CORS answer as the browser hands it to the worker, from the Cache API or the network: type
 * 'cors', its headers immutable (each change throws, as in Chromium).
 */
function corsAnswer(body: string, init: ResponseInit = {}): Response {
  const response = new Response(body, { ...init, headers: ORIGIN_HEADERS });
  for (const change of ['set', 'append', 'delete'] as const) {
    Object.defineProperty(response.headers, change, {
      value: () => {
        throw new TypeError('Headers are immutable');
      },
    });
  }
  return Object.defineProperty(response, 'type', { value: 'cors' });
}
/** Each match of the owned entry gives a fresh response, as the Cache API does. */
const ownedResponse = () => corsAnswer('owned');
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
          return new URL(typeof r === 'string' ? r : r.url).href === OWNED_URL ? ownedResponse() : undefined;
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
const text = async (response: Promise<Response>) => (await response).text();
/** The image route: its matcher and its handler. */
function imageRoute() {
  const call = wb.registerRoute.mock.calls.find(([m]) => typeof m === 'function' && (m as (c: unknown) => boolean)(ctx(`/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com')));
  return call as unknown as [(c: ReturnType<typeof ctx>) => boolean, (o: { request: Request }) => Promise<Response>];
}
/** A response with no copy to make: an opaque (no-cors) one, an opaque redirect, a network error. Status 0. */
const statusZero = (type: ResponseType) => Object.defineProperties(new Response(null), { type: { value: type }, status: { value: 0 } });

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
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { options: { cacheName: string; plugins: unknown[]; matchOptions: CacheQueryOptions; fetchOptions: RequestInit }; handle?: unknown };
    // The one the owned sync also deletes from (src/media/ownedImages.ts).
    expect(cacheFirst.options.cacheName).toBe(BROWSED_MEDIA_CACHE);
    // The origin sends Vary: Origin (fc-infra edge README); an <img crossorigin> request then misses a
    // response a fetch() stored, so the content-addressed caches ignore Vary (one app origin per worker).
    expect(cacheFirst.options.matchOptions).toEqual({ ignoreVary: true });
    // The origin answers immutable: the worker's fetch neither reads nor fills the browser's HTTP cache,
    // so the worker's caches hold the only copy and the owned sync's eviction leaves none behind.
    expect(cacheFirst.options.fetchOptions).toEqual({ cache: 'no-store' });
    expect(wb.CacheableResponsePlugin).toHaveBeenCalledWith({ statuses: [200] });
    expect(wb.ExpirationPlugin).toHaveBeenCalledWith({ maxEntries: 200, purgeOnQuotaError: true });
    expect(cacheFirst.options.plugins).toEqual([wb.CacheableResponsePlugin.mock.instances[0], wb.ExpirationPlugin.mock.instances[0]]);

    const call = wb.registerRoute.mock.calls.find(([m]) => typeof m === 'function' && m !== undefined && (m as (c: unknown) => boolean)(ctx(`/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com')));
    expect(call).toBeDefined();
    const [match, handler] = call as unknown as [(c: ReturnType<typeof ctx>) => boolean, (o: { request: Request }) => Promise<Response>];
    expect(match(ctx(`/media/d/${'ab'.repeat(32)}`))).toBe(false);

    const browsed = new Response('browsed');
    (cacheFirst as unknown as { handle: (o: unknown) => Promise<Response> }).handle = vi.fn(async () => browsed);
    expect(await text(handler({ request: new Request(OWNED_URL) }))).toBe('owned');
    expect(opened).toEqual(['fc-owned-media-v1']);
    expect(matchOptions).toEqual([{ ignoreVary: true }]);
    expect((cacheFirst as unknown as { handle: ReturnType<typeof vi.fn> }).handle).not.toHaveBeenCalled();
    // An <img> of any other image: the browsed cache.
    const shown = { request: asImage(new Request(`https://images.figurecollecting.com/d/${'ab'.repeat(32)}`)) };
    expect(await text(handler(shown))).toBe('browsed');
    expect((cacheFirst as unknown as { handle: ReturnType<typeof vi.fn> }).handle).toHaveBeenCalledWith(shown);
  });

  it('sends the page\'s own fetch of an image (the owned sync\'s Cache.add) to the origin, never into the browsed cache or the HTTP cache', async () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { handle: ReturnType<typeof vi.fn> };
    cacheFirst.handle = vi.fn(async () => new Response('browsed'));
    const [, handler] = wb.registerRoute.mock.calls.find(([m]) => typeof m === 'function' && (m as (c: unknown) => boolean)(ctx(`/d/${'ab'.repeat(32)}`, 'GET', 'https://images.figurecollecting.com'))) as unknown as [unknown, (o: { request: Request }) => Promise<Response>];
    const network = new Response('origin');
    const fetchSpy = vi.fn(async () => network);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const request = new Request(`https://images.figurecollecting.com/d/${'ef'.repeat(32)}`, { mode: 'cors', credentials: 'omit' });
      expect(request.destination).toBe('');
      expect(await text(handler({ request }))).toBe('origin');
      expect(fetchSpy).toHaveBeenCalledWith(request, { cache: 'no-store' });
      expect(cacheFirst.handle).not.toHaveBeenCalled();
      // An owned image is still answered from its cache first, whoever asks.
      expect(await text(handler({ request: new Request(OWNED_URL) }))).toBe('owned');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers the page with a copy marked Cache-Control no-store, from either cache or the origin, so Chromium\'s memory cache does not answer a later document with it; status, body and other headers as they were', async () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { handle: ReturnType<typeof vi.fn> };
    const [, handler] = imageRoute();
    const fetchSpy = vi.fn(async () => corsAnswer('gone', { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const fromOwned = await handler({ request: new Request(OWNED_URL) });
      cacheFirst.handle = vi.fn(async () => corsAnswer('browsed'));
      const fromBrowsed = await handler({ request: asImage(new Request(`https://images.figurecollecting.com/d/${'ab'.repeat(32)}`)) });
      const fromOrigin = await handler({ request: new Request(`https://images.figurecollecting.com/d/${'ef'.repeat(32)}`) });
      const answers = [fromOwned, fromBrowsed, fromOrigin];
      expect(answers.map((r) => r.headers.get('cache-control'))).toEqual(['no-store', 'no-store', 'no-store']);
      expect(answers.map((r) => [r.status, r.statusText, r.headers.get('content-type'), r.headers.get('x-origin')])).toEqual([
        [200, '', 'image/png', 'kept'],
        [200, '', 'image/png', 'kept'],
        [404, 'Not Found', 'image/png', 'kept'],
      ]);
      expect(await Promise.all(answers.map((r) => r.text()))).toEqual(['owned', 'browsed', 'gone']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes an opaque answer (an <img> without crossorigin), an opaque redirect or a network error as it is: none can be copied', async () => {
    const cacheFirst = wb.CacheFirst.mock.instances[0] as unknown as { handle: ReturnType<typeof vi.fn> };
    const [, handler] = imageRoute();
    const opaque = statusZero('opaque');
    cacheFirst.handle = vi.fn(async () => opaque);
    expect(await handler({ request: asImage(new Request(`https://images.figurecollecting.com/d/${'ab'.repeat(32)}`)) })).toBe(opaque);
    for (const answer of [statusZero('opaqueredirect'), Response.error()]) {
      vi.stubGlobal('fetch', vi.fn(async () => answer));
      try {
        expect(await handler({ request: new Request(`https://images.figurecollecting.com/d/${'ef'.repeat(32)}`) })).toBe(answer);
      } finally {
        vi.unstubAllGlobals();
      }
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
