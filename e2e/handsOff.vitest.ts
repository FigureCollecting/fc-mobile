import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HANDS_OFF_DOMAINS, HANDS_OFF_LAUNCH_ARGS, blockHandsOff, guardContext, handsOffResolverRules, isHandsOffHost, isHandsOffUrl } from './handsOff';

const HANDS_OFF_URLS = [
  'https://myfigurecollection.net/',
  'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  'http://STATIC.MyFigureCollection.NET/x.jpg',
  'https://myfigurecollection.net./x.jpg',
  'https://vndb.org../x',
  'http://static.myfigurecollection.net.../x.jpg',
  'https://T.VNDB.ORG./x',
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

/**
 * Chromium's --host-resolver-rules matching (net/base/host_mapping_rules.cc): the
 * first MAP rule whose pattern matches the host wins, '*' standing for any run
 * of characters.
 */
function mappedBy(rules: string[], host: string): string | undefined {
  return rules.find((rule) => {
    const glob = rule.split(' ')[1]!;
    return new RegExp(`^${glob.split('*').map((part) => part.replaceAll('.', '\\.')).join('.*')}$`).test(host);
  });
}

describe('the resolver rules every Chromium the suites launch gets', () => {
  const rules = handsOffResolverRules().split(', ');

  it('give each hands-off domain and every host under it no address, with or without trailing dots', () => {
    for (const domain of HANDS_OFF_DOMAINS) {
      expect(rules).toContain(`MAP ${domain} ~NOTFOUND`);
      expect(rules).toContain(`MAP *.${domain} ~NOTFOUND`);
      expect(rules).toContain(`MAP ${domain}.* ~NOTFOUND`);
      expect(rules).toContain(`MAP *.${domain}.* ~NOTFOUND`);
    }
    expect(rules).toHaveLength(HANDS_OFF_DOMAINS.length * 4);
  });

  it.each([
    'vndb.org',
    'vndb.org.',
    'vndb.org..',
    't.vndb.org',
    't.vndb.org.',
    'static.myfigurecollection.net.',
    'myfigurecollection.net...',
    'www.suruga-ya.jp.',
    'suruga-ya.com..',
    'a.b.hobby-genki.com.',
  ])('map %s to nothing', (host) => {
    expect(mappedBy(rules, host)).toMatch(/ ~NOTFOUND$/);
  });

  it.each(['notvndb.org', 'xvndb.org.', 'vndb.orgx', 'notmyfigurecollection.net.', 'fc-canary.test', 'localhost', 'images.figurecollecting.com'])(
    'leave %s alone',
    (host) => {
      expect(mappedBy(rules, host)).toBeUndefined();
    },
  );

  it('fail closed on a name that only starts with a hands-off domain', () => {
    expect(mappedBy(rules, 'vndb.org.example')).toBe('MAP vndb.org.* ~NOTFOUND');
  });

  it('are the one launch argument', () => {
    expect(HANDS_OFF_LAUNCH_ARGS).toEqual([`--host-resolver-rules=${handsOffResolverRules()}`]);
  });
});

describe('isHandsOffHost (a hostname, as a DNS lookup gets it)', () => {
  it.each(['vndb.org', 'VNDB.ORG', 'vndb.org.', 'vndb.org..', 'Static.MyFigureCollection.Net.', 'www.suruga-ya.jp', 'a.b.hobby-genki.com'])(
    '%s is hands-off',
    (host) => {
      expect(isHandsOffHost(host)).toBe(true);
    },
  );

  it.each(['notvndb.org', 'vndb.org.example', 'xvndb.org.', '.', '', 'localhost'])('%j is not', (host) => {
    expect(isHandsOffHost(host)).toBe(false);
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

interface FakeRequest {
  url: () => string;
  redirectedFrom: () => FakeRequest | null;
  failure: () => { errorText: string } | null;
}

function fakeContext() {
  const routes: Array<{ pattern: RegExp; handler: Handler }> = [];
  const sockets: Array<{ pattern: RegExp; handler: Handler }> = [];
  const listeners: Array<(request: FakeRequest) => void> = [];
  return {
    routes,
    sockets,
    route: vi.fn(async (pattern: RegExp, handler: Handler) => {
      routes.push({ pattern, handler });
    }),
    routeWebSocket: vi.fn(async (pattern: RegExp, handler: Handler) => {
      sockets.push({ pattern, handler });
    }),
    on: vi.fn((event: string, listener: (request: FakeRequest) => void) => {
      if (event === 'request') listeners.push(listener);
    }),
    /** The context sends a request: its 'request' event, then its route (if routed). */
    send: async (request: FakeRequest, routed: boolean) => {
      for (const listener of listeners) listener(request);
      const route = fakeRoute(request);
      if (routed) await routes[0]!.handler(route);
      return route;
    },
  };
}

function fakeRequest(url: string, from: FakeRequest | null = null, failure: string | null = null): FakeRequest {
  return { url: () => url, redirectedFrom: () => from, failure: () => (failure === null ? null : { errorText: failure }) };
}

function fakeRoute(request: string | FakeRequest) {
  const req = typeof request === 'string' ? fakeRequest(request) : request;
  return { request: () => req, abort: vi.fn(async () => {}), fallback: vi.fn(async () => {}) };
}

function fakeSocket(url: string) {
  return { url: () => url, close: vi.fn(async () => {}), connectToServer: vi.fn(() => ({})) };
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
    // The dots are literal: a name that only resembles a domain is not routed.
    expect(pattern.test('http://localhost:5173/myfigurecollection-net/vndb_org.jpg')).toBe(false);
  });

  it('aborts a hands-off request as blocked by the client, and lists it', async () => {
    const context = fakeContext();
    const blocked: string[] = [];
    expect((await blockHandsOff(context as never, blocked)).blocked).toBe(blocked);
    const route = fakeRoute(HANDS_OFF_URLS[1]!);
    await context.routes[0]!.handler(route);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fallback).not.toHaveBeenCalled();
    expect(blocked).toEqual([HANDS_OFF_URLS[1]]);
  });

  it('routes WebSockets with the same pattern, and closes one to a hands-off host without connecting it', async () => {
    const context = fakeContext();
    const { blocked } = await blockHandsOff(context as never);
    expect(context.sockets).toHaveLength(1);
    expect(context.sockets[0]!.pattern).toBe(context.routes[0]!.pattern);
    const socket = fakeSocket('wss://vndb.org/socket');
    await context.sockets[0]!.handler(socket);
    expect(socket.close).toHaveBeenCalledWith({ code: 1008, reason: 'hands-off host' });
    expect(socket.connectToServer).not.toHaveBeenCalled();
    expect(blocked).toEqual(['wss://vndb.org/socket']);
  });

  it('connects a WebSocket that only mentions a hands-off host to its server', async () => {
    const context = fakeContext();
    const { blocked } = await blockHandsOff(context as never);
    const socket = fakeSocket('ws://localhost:5173/?u=vndb.org');
    await context.sockets[0]!.handler(socket);
    expect(socket.connectToServer).toHaveBeenCalledOnce();
    expect(socket.close).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it('passes on a request that only mentions a hands-off host', async () => {
    const context = fakeContext();
    const { blocked } = await blockHandsOff(context as never);
    const route = fakeRoute('https://example.com/?u=https://vndb.org/x');
    await context.routes[0]!.handler(route);
    expect(route.fallback).toHaveBeenCalledOnce();
    expect(route.abort).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it('lists as escaped each hands-off request it saw sent but did not abort: a redirect hop, or one another route took first', async () => {
    const context = fakeContext();
    const guard = await blockHandsOff(context as never);
    const page = fakeRequest('http://fc-redirector.test/go');
    await context.send(fakeRequest('https://vndb.org/aborted'), true);
    await context.send(page, false);
    await context.send(fakeRequest('http://vndb.org./v11', page), false);
    await context.send(fakeRequest('https://static.myfigurecollection.net/x.jpg'), false);
    await context.send(fakeRequest('https://example.com/?u=https://vndb.org/x'), true);
    expect(context.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(guard.blocked).toEqual(['https://vndb.org/aborted']);
    expect(guard.escaped()).toEqual([
      'http://vndb.org./v11 (redirect from http://fc-redirector.test/go)',
      'https://static.myfigurecollection.net/x.jpg',
    ]);
  });

  it("does not list a request the page's CSP refused before sending it (Chromium still reports it, failed as 'csp')", async () => {
    const context = fakeContext();
    const guard = await blockHandsOff(context as never);
    await context.send(fakeRequest('https://t.vndb.org/x.jpg', null, 'csp'), false);
    await context.send(fakeRequest('https://t.vndb.org/y.jpg', null, 'net::ERR_NAME_NOT_RESOLVED'), false);
    expect(guard.escaped()).toEqual(['https://t.vndb.org/y.jpg']);
  });

  it('lists nothing as escaped when it aborted every hands-off request sent', async () => {
    const context = fakeContext();
    const guard = await blockHandsOff(context as never);
    await context.send(fakeRequest('https://vndb.org/a'), true);
    await context.send(fakeRequest('https://vndb.org/a'), true);
    expect(guard.blocked).toEqual(['https://vndb.org/a', 'https://vndb.org/a']);
    expect(guard.escaped()).toEqual([]);
  });
});

describe('guardContext (the context every e2e fixture test gets)', () => {
  it('guards the context for the test, and passes when nothing escaped', async () => {
    const context = fakeContext();
    const blocked: string[] = [];
    const use = vi.fn(async (c: unknown) => {
      expect(c).toBe(context);
      await context.send(fakeRequest('https://t.vndb.org/x.jpg'), true);
    });
    await guardContext(context as never, blocked, use);
    expect(use).toHaveBeenCalledOnce();
    expect(blocked).toEqual(['https://t.vndb.org/x.jpg']);
  });

  it('fails the test, after it ran, on each hands-off request that escaped the guard', async () => {
    const context = fakeContext();
    const page = fakeRequest('http://fc-redirector.test/go');
    const use = vi.fn(async () => {
      await context.send(page, false);
      await context.send(fakeRequest('http://vndb.org/v11', page), false);
    });
    await expect(guardContext(context as never, [], use)).rejects.toThrow(
      'hands-off requests the route guard did not abort: http://vndb.org/v11 (redirect from http://fc-redirector.test/go)',
    );
    expect(use).toHaveBeenCalledOnce();
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
