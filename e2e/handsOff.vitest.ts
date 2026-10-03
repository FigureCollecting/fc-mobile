import { describe, expect, it, vi } from 'vitest';
import {
  HANDS_OFF_DOMAINS,
  HANDS_OFF_LAUNCH_ARGS,
  blockHandsOff,
  guardContext,
  handsOffLookupsRefused,
  handsOffResolverRules,
  isHandsOffHost,
  isHandsOffUrl,
  refuseHandsOffLookups,
  refuseHandsOffRequests,
} from './handsOff';

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
    request: fakeApi(),
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

function fakeApi() {
  return { fetch: vi.fn(async (..._args: unknown[]) => 'the response') };
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

describe('refuseHandsOffRequests (an API request context: the request fixture, context.request, page.request)', () => {
  it('refuses a hands-off URL before sending it, and lists it', async () => {
    const api = fakeApi();
    const send = api.fetch;
    const blocked: string[] = [];
    refuseHandsOffRequests(api as never, blocked);
    await expect(api.fetch('http://vndb.org./v11', { method: 'POST' })).rejects.toThrow('hands-off host, not sent: http://vndb.org./v11');
    await expect(api.fetch({ url: () => 'https://t.vndb.org/x.jpg' })).rejects.toThrow('hands-off host, not sent: https://t.vndb.org/x.jpg');
    expect(send).not.toHaveBeenCalled();
    expect(blocked).toEqual(['http://vndb.org./v11', 'https://t.vndb.org/x.jpg']);
  });

  it('sends anything else as it was asked', async () => {
    const api = fakeApi();
    const send = api.fetch;
    const blocked: string[] = [];
    refuseHandsOffRequests(api as never, blocked, 'http://localhost:5173');
    const options = { method: 'GET' };
    await expect(api.fetch('https://example.com/?u=https://vndb.org/x', options)).resolves.toBe('the response');
    await expect(api.fetch('/sw.js')).resolves.toBe('the response');
    expect(send.mock.calls).toEqual([['https://example.com/?u=https://vndb.org/x', options], ['/sw.js', undefined]]);
    expect(blocked).toEqual([]);
  });

  it('reads a relative URL against the base URL it is given', async () => {
    const api = fakeApi();
    refuseHandsOffRequests(api as never, [], 'https://vndb.org');
    await expect(api.fetch('/v11')).rejects.toThrow('hands-off host, not sent: /v11');
  });

  it("reads a relative context.request URL against the base URL blockHandsOff and guardContext are given (the fixture's baseURL)", async () => {
    const context = fakeContext();
    const other = fakeContext();
    const sends = [context.request.fetch, other.request.fetch];
    const { blocked } = await blockHandsOff(context as never, [], 'http://vndb.org');
    await expect(context.request.fetch('/v11')).rejects.toThrow('hands-off host, not sent: /v11');
    const seen: string[] = [];
    await guardContext(other as never, seen, async () => {
      await expect(other.request.fetch('/api')).rejects.toThrow('hands-off host, not sent: /api');
    }, 'https://www.suruga-ya.jp');
    for (const send of sends) expect(send).not.toHaveBeenCalled();
    expect([blocked, seen]).toEqual([['/v11'], ['/api']]);
  });

  it("guards every context's own API requests (context.request, which page.request is) with blockHandsOff", async () => {
    const context = fakeContext();
    const send = context.request.fetch;
    const { blocked } = await blockHandsOff(context as never);
    await expect(context.request.fetch('https://static.myfigurecollection.net/x.jpg')).rejects.toThrow(/hands-off host, not sent/);
    await expect(context.request.fetch('http://localhost:5173/')).resolves.toBe('the response');
    expect(send.mock.calls).toEqual([['http://localhost:5173/', undefined]]);
    expect(blocked).toEqual(['https://static.myfigurecollection.net/x.jpg']);
  });
});

describe("refuseHandsOffLookups (this process's own DNS)", () => {
  type Callback = (error: NodeJS.ErrnoException | null, ...rest: unknown[]) => void;

  function fakeDns() {
    const lookup = vi.fn((_host: string, ...rest: unknown[]) => {
      (rest[rest.length - 1] as Callback)(null, '192.0.2.1', 4);
    });
    const promisify = Symbol('customPromisifyArgs');
    Object.assign(lookup, { [promisify]: ['address', 'family'] });
    return { module: { lookup, promises: { lookup: vi.fn(async (..._args: unknown[]) => ({ address: '192.0.2.1', family: 4 })) } }, lookup, promisify };
  }

  function lookUp(module: { lookup: (...args: never[]) => void }, ...args: unknown[]) {
    return new Promise<unknown[]>((resolve) => {
      (module.lookup as (...a: unknown[]) => void)(...args, (...result: unknown[]) => resolve(result));
    });
  }

  it.each(['vndb.org', 'T.VNDB.ORG.', 'static.myfigurecollection.net..'])('finds no address for %s, by callback and by promise', async (host) => {
    const { module, lookup } = fakeDns();
    const real = module.promises.lookup;
    refuseHandsOffLookups(module as never);
    const notFound = { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: host, message: `getaddrinfo ENOTFOUND ${host} (a hands-off host)` };
    const [error] = await lookUp(module, host, { all: true });
    expect(error).toMatchObject(notFound);
    expect((await lookUp(module, host))[0]).toMatchObject(notFound);
    await expect(module.promises.lookup(host, { all: true } as never)).rejects.toMatchObject(notFound);
    expect(lookup).not.toHaveBeenCalled();
    expect(real).not.toHaveBeenCalled();
  });

  it('answers by callback later, as Node does, never during the call', async () => {
    const { module } = fakeDns();
    refuseHandsOffLookups(module as never);
    let returned = false;
    const answered = new Promise<boolean>((resolve) => {
      (module.lookup as (...a: unknown[]) => void)('vndb.org', () => resolve(returned));
    });
    returned = true;
    expect(await answered).toBe(true);
  });

  it('passes every other lookup to the real one unchanged', async () => {
    const { module, lookup } = fakeDns();
    const real = module.promises.lookup;
    refuseHandsOffLookups(module as never);
    expect(await lookUp(module, 'localhost', { family: 4 })).toEqual([null, '192.0.2.1', 4]);
    expect(lookup).toHaveBeenCalledWith('localhost', { family: 4 }, expect.any(Function));
    await expect(module.promises.lookup('notvndb.org', { all: true } as never)).resolves.toEqual({ address: '192.0.2.1', family: 4 });
    expect(real).toHaveBeenCalledWith('notvndb.org', { all: true });
    // Not a host name at all: the real lookup answers, as Node would (with its own error), even if it would print as one.
    const printsAsOne = { toString: () => 'vndb.org' };
    for (const notAName of [undefined, printsAsOne]) {
      expect(await lookUp(module, notAName)).toEqual([null, '192.0.2.1', 4]);
      await expect(module.promises.lookup(notAName as never)).resolves.toEqual({ address: '192.0.2.1', family: 4 });
    }
    expect(lookup).toHaveBeenLastCalledWith(printsAsOne, expect.any(Function));
  });

  it('says it is installed only when both lookups refuse, and installs only the one that does not', async () => {
    for (const missing of ['lookup', 'promises.lookup'] as const) {
      const { module, lookup } = fakeDns();
      const real = { lookup: module.lookup, promised: module.promises.lookup };
      refuseHandsOffLookups(module as never);
      const refusing = { lookup: module.lookup, promised: module.promises.lookup };
      if (missing === 'lookup') module.lookup = real.lookup;
      else module.promises.lookup = real.promised;
      expect(handsOffLookupsRefused(module as never), missing).toBe(false);

      refuseHandsOffLookups(module as never);
      expect(handsOffLookupsRefused(module as never), missing).toBe(true);
      // The one still installed is the same function, not wrapped a second time.
      if (missing === 'lookup') expect(module.promises.lookup).toBe(refusing.promised);
      else expect(module.lookup).toBe(refusing.lookup);
      expect((await lookUp(module, 'vndb.org'))[0], missing).toMatchObject({ code: 'ENOTFOUND' });
      await expect(module.promises.lookup('vndb.org'), missing).rejects.toMatchObject({ code: 'ENOTFOUND' });
      expect(lookup).not.toHaveBeenCalled();
      expect(real.promised).not.toHaveBeenCalled();
    }
  });

  it("keeps the real lookup's promisify shape, says it is installed, and installs once", () => {
    const { module, promisify } = fakeDns();
    expect(handsOffLookupsRefused(module as never)).toBe(false);
    refuseHandsOffLookups(module as never);
    const once = { lookup: module.lookup, promised: module.promises.lookup };
    refuseHandsOffLookups(module as never);
    expect(handsOffLookupsRefused(module as never)).toBe(true);
    expect({ lookup: module.lookup, promised: module.promises.lookup }).toEqual(once);
    expect((module.lookup as unknown as Record<symbol, unknown>)[promisify]).toEqual(['address', 'family']);
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
