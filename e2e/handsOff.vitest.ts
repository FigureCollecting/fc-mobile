import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HANDS_OFF_DOMAINS, HANDS_OFF_LAUNCH_ARGS, blockHandsOff, handsOffResolverRules, isHandsOffUrl } from './handsOff';

const HANDS_OFF_URLS = [
  'https://myfigurecollection.net/',
  'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  'http://STATIC.MyFigureCollection.NET/x.jpg',
  'https://myfigurecollection.net./x.jpg',
  'https://user:pw@static.myfigurecollection.net/x.jpg',
  'https://example.com@static.myfigurecollection.net/x.jpg',
  'https://www.suruga-ya.jp/database/pics/game/g1.jpg',
  'https://suruga-ya.com/img/1.jpg',
  'https://a.b.hobby-genki.com:8443/img/1.jpg',
  'https://t.vndb.org/cv/00/1.jpg',
  'wss://vndb.org/socket',
];

/** Look-alikes, and our own hosts that merely mention a hands-off one. */
const OTHER_URLS = [
  'https://notmyfigurecollection.net/x.jpg',
  'https://myfigurecollection.net.example.com/x.jpg',
  'https://myfigurecollection.net@example.com/x.jpg',
  'https://xvndb.org/',
  'https://vndb.org.example/x',
  'https://example.com/?u=https://vndb.org/x',
  'https://example.com/myfigurecollection.net/x.jpg',
  'https://images.figurecollecting.com/serve/1@2',
  'http://localhost:5173/?layout=case',
  'data:image/png;base64,AAAA',
  'about:blank',
  '/relative/myfigurecollection.net.jpg',
  '',
];

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

describe('isHandsOffUrl', () => {
  it.each(HANDS_OFF_URLS)('%s is hands-off', (url) => {
    expect(isHandsOffUrl(url)).toBe(true);
  });

  it.each(OTHER_URLS)('%s is not', (url) => {
    expect(isHandsOffUrl(url)).toBe(false);
  });
});

type Handler = (route: unknown) => Promise<void> | void;

function fakeContext() {
  const routes: Array<{ pattern: RegExp; handler: Handler }> = [];
  return {
    routes,
    route: vi.fn(async (pattern: RegExp, handler: Handler) => {
      routes.push({ pattern, handler });
    }),
  };
}

function fakeRoute(url: string) {
  return { request: () => ({ url: () => url }), abort: vi.fn(async () => {}), fallback: vi.fn(async () => {}) };
}

describe('blockHandsOff', () => {
  it('routes, with one pattern, every request that could be for a hands-off host', async () => {
    const context = fakeContext();
    await blockHandsOff(context as never);
    expect(context.routes).toHaveLength(1);
    const { pattern } = context.routes[0]!;
    expect(pattern).toBeInstanceOf(RegExp);
    for (const url of HANDS_OFF_URLS) expect(pattern.test(url), url).toBe(true);
    expect(pattern.test('http://localhost:5173/assets/index.js')).toBe(false);
  });

  it('aborts a hands-off request as blocked by the client, and lists it', async () => {
    const context = fakeContext();
    const blocked: string[] = [];
    expect(await blockHandsOff(context as never, blocked)).toBe(blocked);
    const route = fakeRoute(HANDS_OFF_URLS[1]!);
    await context.routes[0]!.handler(route);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fallback).not.toHaveBeenCalled();
    expect(blocked).toEqual([HANDS_OFF_URLS[1]]);
  });

  it('passes on a request that only mentions a hands-off host', async () => {
    const context = fakeContext();
    const blocked = await blockHandsOff(context as never);
    const route = fakeRoute('https://example.com/?u=https://vndb.org/x');
    await context.routes[0]!.handler(route);
    expect(route.fallback).toHaveBeenCalledOnce();
    expect(route.abort).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });
});

describe('every browser context the e2e suites open is guarded', () => {
  const root = import.meta.dirname;
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.vitest.ts') && !f.split(path.sep).includes('node_modules'))
    .map((f) => ({ file: f.split(path.sep).join('/'), code: readFileSync(path.join(root, f), 'utf8') }));

  it('finds the specs', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(['fixtures.ts', 'auth/auth.spec.ts', 'pwa/pwa.spec.ts']));
  });

  it('takes `test` from e2e/fixtures.ts (guarded), never straight from @playwright/test', () => {
    const direct = sources.filter(({ file, code }) => {
      if (file === 'fixtures.ts') return false;
      return Array.from(code.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'@playwright\/test'/gm)).some((m) =>
        m[1]!.split(',').some((spec) => /^test\b/.test(spec.trim())),
      );
    });
    expect(direct.map((s) => s.file)).toEqual([]);
  });

  it('calls blockHandsOff wherever a file launches a browser or opens a context itself', () => {
    const unguarded = sources.filter(
      ({ code }) => /\.(launch|launchPersistentContext|newContext)\(/.test(code) && !/\bblockHandsOff\(/.test(code),
    );
    expect(unguarded.map((s) => s.file)).toEqual([]);
  });
});
