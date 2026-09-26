// Request classes the service worker decides on. The coordinator shares this
// origin under /api, so the worker must never answer, cache or replay it.

/** The edge's coordinator rule, verbatim: ^/api(/.*)?$ */
export const API_PATH = /^\/api(\/.*)?$/;

/**
 * The same paths for the NavigationRoute denylist. Workbox tests a denylist
 * against pathname + search, so a query must end the /api prefix too.
 */
export const API_NAVIGATION = /^\/api(?:[/?]|$)/;

/** A display derivative, addressed by the SHA-256 of its bytes, so immutable. */
export const DERIVATIVE_PATH = /^\/media\/d\/[0-9a-f]{64}$/;

export function isApiPath(pathname: string): boolean {
  return API_PATH.test(pathname);
}

export interface RouteRequest {
  url: URL;
  request: Request;
  sameOrigin: boolean;
}

/** Same-origin only: a cross-origin no-cors image is opaque and must never be cached. */
export function isDerivativeRequest({ url, request, sameOrigin }: RouteRequest): boolean {
  return sameOrigin && request.method === 'GET' && DERIVATIVE_PATH.test(url.pathname);
}
