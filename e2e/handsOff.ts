import type { BrowserContext } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * Every Chromium the e2e suites launch gets HANDS_OFF_LAUNCH_ARGS, so its
 * resolver has no address for these hosts.
 */
export const HANDS_OFF_DOMAINS = ['myfigurecollection.net', 'suruga-ya.jp', 'suruga-ya.com', 'hobby-genki.com', 'vndb.org'] as const;

/** Chromium --host-resolver-rules: each domain and every host under it resolves to nothing. */
export function handsOffResolverRules(): string {
  return HANDS_OFF_DOMAINS.flatMap((d) => [`MAP ${d} ~NOTFOUND`, `MAP *.${d} ~NOTFOUND`]).join(', ');
}

export const HANDS_OFF_LAUNCH_ARGS: string[] = [`--host-resolver-rules=${handsOffResolverRules()}`];

export function isHandsOffUrl(_url: string): boolean {
  return false;
}

export async function blockHandsOff(_context: Pick<BrowserContext, 'route'>, blocked: string[] = []): Promise<string[]> {
  return blocked;
}
