import { isMediaUrl } from '../media/address';

// Request classes the service worker decides on. The coordinator shares this
// origin under /api, so the worker must never answer, cache or replay it.

/** The edge's coordinator rule, verbatim: ^/api(/.*)?$ */
export const API_PATH = /^\/api(\/.*)?$/;

/**
 * The same paths for the NavigationRoute denylist. Workbox tests a denylist
 * against pathname + search, so a query must end the /api prefix too.
 */
export const API_NAVIGATION = /^\/api(?:[/?]|$)/;

export function isApiPath(pathname: string): boolean {
  return API_PATH.test(pathname);
}

export interface RouteRequest {
  url: URL;
  request: Request;
  sameOrigin: boolean;
}

/**
 * A derivative or mask on the ONE public image address (src/media/address.ts), content-addressed
 * so immutable. Cross-origin: the strategy keeps only a CORS 200, never an opaque response.
 */
export function isDerivativeRequest({ url, request }: RouteRequest): boolean {
  return request.method === 'GET' && isMediaUrl(url);
}
