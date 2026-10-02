import dns from 'node:dns';
import type { APIRequestContext, BrowserContext, Request } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * The e2e suites stop one at each layer it could leave by, each tested in
 * e2e/hands-off.spec.ts against local sentinels:
 * - every fixture context (e2e/fixtures.ts, guardContext) aborts its pages'
 *   and workers' requests to these hosts, closes its pages' WebSockets to them
 *   and refuses its API requests to them, and fails its test on one that got
 *   past (a redirect hop);
 * - every Chromium they launch gets HANDS_OFF_LAUNCH_ARGS, so its resolver has
 *   no address for them (which also stops a redirect hop);
 * - each worker's Node DNS has none either (refuseHandsOffLookups);
 * - e2e/handsOffScan.ts keeps every spec on these guards.
 * The app's CSP and the vite dev server's refuse them as subresources; a CSP
 * does not stop a navigation.
 */
export const HANDS_OFF_DOMAINS = ['myfigurecollection.net', 'suruga-ya.jp', 'suruga-ya.com', 'hobby-genki.com', 'vndb.org'] as const;

/**
 * Chromium --host-resolver-rules: each domain and every host under it resolves
 * to nothing, spelled with trailing dots too (vndb.org. is the same host to a
 * resolver). The trailing-dot patterns fail closed: a name that only starts
 * with a hands-off domain (vndb.org.example) resolves to nothing as well.
 */
export function handsOffResolverRules(): string {
  return HANDS_OFF_DOMAINS.flatMap((d) => [`MAP ${d} ~NOTFOUND`, `MAP *.${d} ~NOTFOUND`, `MAP ${d}.* ~NOTFOUND`, `MAP *.${d}.* ~NOTFOUND`]).join(', ');
}

export const HANDS_OFF_LAUNCH_ARGS: string[] = [`--host-resolver-rules=${handsOffResolverRules()}`];

/** Whether a hostname is a hands-off domain or under one, in any case and with any trailing dots (a look-alike is not). */
export function isHandsOffHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  return HANDS_OFF_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Whether the URL's host (a relative URL read against `base`) is a hands-off domain or under one (a look-alike is not). */
export function isHandsOffUrl(url: string, base?: string): boolean {
  let host: string;
  try {
    host = new URL(url, base).hostname;
  } catch {
    return false;
  }
  return isHandsOffHost(host);
}

/** Any URL that mentions a hands-off domain; isHandsOffUrl decides. */
const MENTIONS_HANDS_OFF = new RegExp(HANDS_OFF_DOMAINS.map((d) => d.replaceAll('.', '\\.')).join('|'), 'i');

type Guardable = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'on' | 'request'>;

export interface HandsOffGuard {
  /** Every hands-off URL the guard stopped (requests aborted, WebSockets closed), in order. */
  blocked: string[];
  /**
   * Every hands-off request the context's pages and workers sent that the guard
   * did not abort: a redirect hop (routes never see one; the resolver rules are
   * all that stops it), or a request another route took first.
   */
  escaped(): string[];
}

/**
 * Aborts every request the context's pages and service workers make to a
 * hands-off host before it is sent, closes every WebSocket its pages open to
 * one before it connects, refuses its own API requests to one (context.request,
 * which page.request is), and lists each in `blocked`. Routes never see a
 * redirect hop, so it also watches what the context sends: `escaped` lists any
 * hands-off request it did not abort.
 */
export async function blockHandsOff(context: Guardable, blocked: string[] = []): Promise<HandsOffGuard> {
  const sent: Request[] = [];
  const aborted = new Set<Request>();
  context.on('request', (request) => {
    if (isHandsOffUrl(request.url())) sent.push(request);
  });
  await context.route(MENTIONS_HANDS_OFF, (route) => {
    const request = route.request();
    if (!isHandsOffUrl(request.url())) return route.fallback();
    aborted.add(request);
    blocked.push(request.url());
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(MENTIONS_HANDS_OFF, (ws) => {
    if (!isHandsOffUrl(ws.url())) return ws.connectToServer();
    blocked.push(ws.url());
    return ws.close({ code: 1008, reason: 'hands-off host' });
  });
  refuseHandsOffRequests(context.request, blocked);
  return {
    blocked,
    escaped: () =>
      sent
        // Chromium reports a request the page's CSP refused, failed as 'csp': it was never sent.
        .filter((request) => !aborted.has(request) && request.failure()?.errorText !== 'csp')
        .map((request) => {
          const from = request.redirectedFrom();
          return from === null ? request.url() : `${request.url()} (redirect from ${from.url()})`;
        }),
  };
}

/**
 * The context every e2e fixture test gets: guarded by blockHandsOff while the
 * test runs, and the test fails afterwards if any hands-off request escaped
 * the guard.
 */
export async function guardContext<C extends Guardable>(context: C, blocked: string[], use: (context: C) => Promise<void>): Promise<void> {
  const guard = await blockHandsOff(context, blocked);
  await use(context);
  const escaped = guard.escaped();
  if (escaped.length > 0) throw new Error(`hands-off requests the route guard did not abort: ${escaped.join(', ')}`);
}

/**
 * Makes an API request context (the request fixture, context.request) refuse a
 * hands-off URL before sending it, and list it in `blocked`. It runs in Node,
 * so no route, resolver rule or CSP sees it. Every method (get, post, ...)
 * sends through `fetch`.
 */
export function refuseHandsOffRequests(api: Pick<APIRequestContext, 'fetch'>, blocked: string[] = [], baseURL?: string): void {
  const send = api.fetch.bind(api);
  api.fetch = async (urlOrRequest, options) => {
    const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url();
    if (isHandsOffUrl(url, baseURL)) {
      blocked.push(url);
      throw new Error(`hands-off host, not sent: ${url}`);
    }
    return send(urlOrRequest, options);
  };
}

type Lookups = { lookup: typeof dns.lookup; promises: { lookup: typeof dns.promises.lookup } };

const REFUSES_HANDS_OFF = Symbol.for('fc-mobile.e2e.refusesHandsOff');

function notFound(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname} (a hands-off host)`), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname });
}

/**
 * Makes this process's DNS lookups (dns.lookup and dns.promises.lookup: what
 * Node's net, http and fetch, and Playwright's API requests, resolve with) find
 * no address for a hands-off host, as the resolver rules do in Chromium. Every
 * other lookup goes to the real one unchanged. Installs once per module.
 */
export function refuseHandsOffLookups(module: Lookups = dns): void {
  if (handsOffLookupsRefused(module)) return;
  const lookup = module.lookup;
  const refusing = function (this: unknown, hostname: string, ...rest: unknown[]) {
    if (typeof hostname === 'string' && isHandsOffHost(hostname)) {
      process.nextTick(rest[rest.length - 1] as (error: Error) => void, notFound(hostname));
      return;
    }
    return (lookup as (...args: unknown[]) => void).call(this, hostname, ...rest);
  };
  // util.promisify(dns.lookup) resolves with { address, family } through this symbol.
  for (const key of Object.getOwnPropertySymbols(lookup)) Object.assign(refusing, { [key]: (lookup as unknown as Record<symbol, unknown>)[key] });
  module.lookup = Object.assign(refusing, { [REFUSES_HANDS_OFF]: true }) as unknown as typeof dns.lookup;

  const promised = module.promises.lookup;
  const refusingPromise = function (this: unknown, hostname: string, ...rest: unknown[]) {
    if (typeof hostname === 'string' && isHandsOffHost(hostname)) return Promise.reject(notFound(hostname));
    return (promised as (...args: unknown[]) => Promise<unknown>).call(this, hostname, ...rest);
  };
  module.promises.lookup = Object.assign(refusingPromise, { [REFUSES_HANDS_OFF]: true }) as unknown as typeof dns.promises.lookup;
}

/** Whether refuseHandsOffLookups is installed on the module (this process's dns by default). */
export function handsOffLookupsRefused(module: Lookups = dns): boolean {
  return REFUSES_HANDS_OFF in module.lookup && REFUSES_HANDS_OFF in module.promises.lookup;
}
