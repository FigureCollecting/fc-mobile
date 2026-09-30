/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 */
export const HANDS_OFF_DOMAINS = ['myfigurecollection.net', 'suruga-ya.jp', 'suruga-ya.com', 'hobby-genki.com', 'vndb.org'] as const;

export function handsOffResolverRules(): string {
  return '';
}

export const HANDS_OFF_LAUNCH_ARGS: string[] = [];
