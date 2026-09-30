import type { BrowserContext } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * Every context the e2e suites open aborts requests to these hosts before they
 * are sent (blockHandsOff, wired in e2e/fixtures.ts), and every Chromium they
 * launch gets HANDS_OFF_LAUNCH_ARGS, so its resolver has no address for them
 * either. The app's CSP and the vite dev server's refuse them as well.
 */
export const HANDS_OFF_DOMAINS = ['myfigurecollection.net', 'suruga-ya.jp', 'suruga-ya.com', 'hobby-genki.com', 'vndb.org'] as const;

/** Chromium --host-resolver-rules: each domain and every host under it resolves to nothing. */
export function handsOffResolverRules(): string {
  return HANDS_OFF_DOMAINS.flatMap((d) => [`MAP ${d} ~NOTFOUND`, `MAP *.${d} ~NOTFOUND`]).join(', ');
}

export const HANDS_OFF_LAUNCH_ARGS: string[] = [`--host-resolver-rules=${handsOffResolverRules()}`];

/** Whether the URL's host is a hands-off domain or under one (a look-alike is not). */
export function isHandsOffUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  return HANDS_OFF_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Any URL that mentions a hands-off domain; isHandsOffUrl decides. */
const MENTIONS_HANDS_OFF = new RegExp(HANDS_OFF_DOMAINS.map((d) => d.replaceAll('.', '\\.')).join('|'), 'i');

/**
 * Aborts every request the context's pages and workers make to a hands-off
 * host before it is sent, and lists it in `blocked`.
 */
export async function blockHandsOff(context: Pick<BrowserContext, 'route'>, blocked: string[] = []): Promise<string[]> {
  await context.route(MENTIONS_HANDS_OFF, (route) => {
    const url = route.request().url();
    if (!isHandsOffUrl(url)) return route.fallback();
    blocked.push(url);
    return route.abort('blockedbyclient');
  });
  return blocked;
}
