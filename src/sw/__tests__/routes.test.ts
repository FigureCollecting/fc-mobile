import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NavigationRoute } from 'workbox-routing';
import { API_NAVIGATION, API_PATH, DERIVATIVE_PATH, isApiPath, isDerivativeRequest } from '../routes';

const ORIGIN = 'https://figurecollecting.com';
const HEX64 = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

function req(path: string, init: { method?: string; origin?: string } = {}) {
  const url = new URL(path, init.origin ?? ORIGIN);
  return { url, request: new Request(url, { method: init.method ?? 'GET' }), sameOrigin: url.origin === ORIGIN };
}

describe('isApiPath', () => {
  it('matches exactly what the edge sends to the coordinator: ^/api(/.*)?$', () => {
    for (const p of ['/api', '/api/', '/api/x', '/api/coordinator.v1.SyncService/Push', '/api/auth/session']) {
      expect(isApiPath(p), p).toBe(true);
    }
    for (const p of ['/', '/apix', '/apis/x', '/app/api', '/figure/api', '/media/d/api']) {
      expect(isApiPath(p), p).toBe(false);
    }
    expect(API_PATH.source).toBe('^\\/api(\\/.*)?$');
  });

  it('matches every path under /api', () => {
    fc.assert(fc.property(fc.webPath(), (tail) => isApiPath(`/api${tail.startsWith('/') ? tail : `/${tail}`}`)));
  });
});

describe('API_NAVIGATION, in the real NavigationRoute', () => {
  // Workbox tests a denylist against pathname + search, not the pathname alone.
  const route = new NavigationRoute(() => Promise.resolve(new Response()), { denylist: [API_NAVIGATION] });
  const shellFor = (url: URL) =>
    Boolean(route.match({ url, request: { mode: 'navigate' } as Request, sameOrigin: true, event: {} as ExtendableEvent }));
  const shell = (p: string) => shellFor(new URL(p, ORIGIN));

  it('never gives the shell to a navigation under /api, with or without a query', () => {
    for (const p of ['/api', '/api?x=1', '/api/', '/api/x', '/api/x?y=1', '/api/auth/session?next=/']) {
      expect(shell(p), p).toBe(false);
    }
  });

  it('gives the shell to every other path, whatever its query says', () => {
    for (const p of ['/', '/apix', '/apis/x', '/figure/abc', '/discover?q=api', '/figure/api?x=/api']) {
      expect(shell(p), p).toBe(true);
    }
  });

  it('refuses exactly what the edge sends to the coordinator, for any query', () => {
    // Biased to /api, /api/..., /apiX...: plain webPath() almost never lands there.
    const paths = fc.oneof(fc.webPath(), fc.webPath().map((tail) => `/api${tail}`), fc.webSegment().map((seg) => `/api${seg}`));
    fc.assert(
      fc.property(paths, fc.webQueryParameters(), (path, query) => {
        const url = new URL(ORIGIN);
        url.pathname = path;
        url.search = query;
        return shellFor(url) === !isApiPath(url.pathname);
      }),
    );
  });
});

describe('isDerivativeRequest', () => {
  it('takes a same-origin GET of /media/d/<64 lowercase hex>', () => {
    expect(isDerivativeRequest(req(`/media/d/${HEX64}`))).toBe(true);
    expect(DERIVATIVE_PATH.test(`/media/d/${HEX64}`)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isDerivativeRequest(req(`/media/d/${HEX64}`, { origin: 'https://images.figurecollecting.com' }))).toBe(false);
    expect(isDerivativeRequest(req(`/media/d/${HEX64}`, { method: 'POST' }))).toBe(false);
    expect(isDerivativeRequest(req(`/media/d/${HEX64.toUpperCase()}`))).toBe(false);
    expect(isDerivativeRequest(req(`/media/d/${HEX64.slice(1)}`))).toBe(false);
    expect(isDerivativeRequest(req(`/media/d/${HEX64}0`))).toBe(false);
    expect(isDerivativeRequest(req(`/media/d/${HEX64}/x`))).toBe(false);
    expect(isDerivativeRequest(req(`/api/media/d/${HEX64}`))).toBe(false);
  });

  it('never matches an /api path, whatever follows', () => {
    fc.assert(fc.property(fc.webPath(), (tail) => !isDerivativeRequest(req(`/api${tail.startsWith('/') ? tail : `/${tail}`}`))));
  });
});
