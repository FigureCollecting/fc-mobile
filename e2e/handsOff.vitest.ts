import { describe, expect, it } from 'vitest';
import { HANDS_OFF_DOMAINS, HANDS_OFF_LAUNCH_ARGS, handsOffResolverRules } from './handsOff';

describe('the hands-off hosts', () => {
  it('are the sites that bar AI agents by name (Ross, 2026-09-29)', () => {
    expect([...HANDS_OFF_DOMAINS].sort()).toEqual(
      ['hobby-genki.com', 'myfigurecollection.net', 'suruga-ya.com', 'suruga-ya.jp', 'vndb.org'].sort(),
    );
  });
});

describe('the resolver rules every Chromium the suites launch gets', () => {
  it('give each hands-off domain and every host under it no address', () => {
    const rules = handsOffResolverRules().split(', ');
    for (const domain of HANDS_OFF_DOMAINS) {
      expect(rules).toContain(`MAP ${domain} ~NOTFOUND`);
      expect(rules).toContain(`MAP *.${domain} ~NOTFOUND`);
    }
    expect(rules).toHaveLength(HANDS_OFF_DOMAINS.length * 2);
  });

  it('are the one launch argument', () => {
    expect(HANDS_OFF_LAUNCH_ARGS).toEqual([`--host-resolver-rules=${handsOffResolverRules()}`]);
  });
});
