import type { BrowserContext, Request } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * Every context the e2e suites open aborts requests to these hosts before they
 * are sent (blockHandsOff, wired in e2e/fixtures.ts), and every Chromium they
 * launch gets HANDS_OFF_LAUNCH_ARGS, so its resolver has no address for them
 * either. The app's CSP and the vite dev server's refuse them as well.
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

/** Whether the URL's host is a hands-off domain or under one (a look-alike is not). */
export function isHandsOffUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return isHandsOffHost(host);
}

/** Any URL that mentions a hands-off domain; isHandsOffUrl decides. */
const MENTIONS_HANDS_OFF = new RegExp(HANDS_OFF_DOMAINS.map((d) => d.replaceAll('.', '\\.')).join('|'), 'i');

type Guardable = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'on'>;

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
 * one before it connects, and lists each in `blocked`. Routes never see a
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

/** Stub. */
export function refuseHandsOffRequests(..._args: unknown[]): void {}

/** Stub. */
export function refuseHandsOffLookups(..._args: unknown[]): void {}

/** Stub. */
export function handsOffLookupsRefused(..._args: unknown[]): boolean {
  return false;
}
