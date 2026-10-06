import { describe, expect, it, vi } from 'vitest';
import {
  HANDS_OFF_DOMAINS,
  HANDS_OFF_LAUNCH_ARGS,
  HANDS_OFF_LAUNCH_OPTIONS,
  blockHandsOff,
  configBypasses,
  guardContext,
  handsOffLookupsRefused,
  handsOffResolverRules,
  isHandsOffHost,
  isHandsOffUrl,
  refuseHandsOffLookups,
  refuseHandsOffRequests,
  refuseInheritedOptions,
  refuseRoundTheRules,
  refuseRoundTheRulesAtEachLaunch,
  type ConfigUse,
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

  it('are frozen with the domains, so no spec can add a rule list or a proxy to the launch args, or empty the domains', () => {
    expect(Object.isFrozen(HANDS_OFF_LAUNCH_ARGS)).toBe(true);
    expect(Object.isFrozen(HANDS_OFF_DOMAINS)).toBe(true);
    expect(() => HANDS_OFF_LAUNCH_ARGS.push('--proxy-server=http://127.0.0.1:9')).toThrow(TypeError);
    expect(() => {
      HANDS_OFF_LAUNCH_ARGS[0] = '--host-resolver-rules=MAP * 127.0.0.1';
    }).toThrow(TypeError);
    expect(() => {
      (HANDS_OFF_DOMAINS as unknown as string[]).length = 0;
    }).toThrow(TypeError);
    expect(HANDS_OFF_LAUNCH_ARGS).toEqual([`--host-resolver-rules=${handsOffResolverRules()}`]);
    expect(HANDS_OFF_DOMAINS).toHaveLength(5);
  });

  it('come in launch options that are frozen too, so no spec that imports a config can set its args or add a proxy', () => {
    expect(HANDS_OFF_LAUNCH_OPTIONS.args).toBe(HANDS_OFF_LAUNCH_ARGS);
    expect(Object.isFrozen(HANDS_OFF_LAUNCH_OPTIONS)).toBe(true);
    expect(() => {
      (HANDS_OFF_LAUNCH_OPTIONS as { args: string[] }).args = ['--host-resolver-rules=MAP * 127.0.0.1'];
    }).toThrow(TypeError);
    // A proxy written as an object literal would trip e2e/handsOffScan.ts.
    expect(() => Object.assign(HANDS_OFF_LAUNCH_OPTIONS, Object.fromEntries([['proxy', { server: 'http://127.0.0.1:9' }]]))).toThrow(TypeError);
    expect(HANDS_OFF_LAUNCH_OPTIONS).toEqual({ args: HANDS_OFF_LAUNCH_ARGS });
  });
});

describe('configBypasses (a Playwright config, as the e2e, PWA and stack configs are checked)', () => {
  /** A `use` from [option, value] pairs: these options written as an object literal would trip e2e/handsOffScan.ts. */
  const use = (...options: [string, unknown][]): ConfigUse => Object.fromEntries(options);
  const rules: [string, unknown] = ['launchOptions', Object.freeze({ args: HANDS_OFF_LAUNCH_ARGS })];

  it('finds nothing when every Chromium project launches with the rules and each other browser is named', () => {
    const config = {
      use: use(['baseURL', 'http://localhost:5173']),
      projects: [
        { name: 'chromium', use: use(['defaultBrowserType', 'chromium'], rules) },
        { name: 'plain', use: use(rules) },
        { name: 'more', use: use(['launchOptions', Object.freeze({ args: Object.freeze([...HANDS_OFF_LAUNCH_ARGS, '--disable-gpu']) })]) },
        { name: 'webkit', use: use(['defaultBrowserType', 'webkit']) },
      ],
    };
    expect(configBypasses(config, { webkit: 'webkit' })).toEqual([]);
  });

  it('flags a Chromium project without the rules, and a browser that is not the one named for its project', () => {
    const config = {
      projects: [
        { name: 'bare' },
        { name: 'other-args', use: use(['launchOptions', { args: ['--disable-gpu'] }]) },
        { name: 'firefox', use: use(['browserName', 'firefox'], rules) },
        { name: 'webkit', use: use(['defaultBrowserType', 'firefox']) },
        { use: use(['defaultBrowserType', 'webkit']) },
      ],
    };
    expect(configBypasses(config, { webkit: 'webkit' })).toEqual([
      'bare: launches Chromium without the hands-off resolver rules',
      'other-args: launches Chromium without the hands-off resolver rules',
      'firefox: runs firefox, which has no hands-off resolver rules',
      'webkit: runs firefox, which has no hands-off resolver rules',
      '(unnamed): runs webkit, which has no hands-off resolver rules',
    ]);
  });

  it("reads each project as Playwright merges it, its use over the config's: a top-level browserName or launchOptions counts", () => {
    const firefox = { use: use(['browserName', 'firefox']), projects: [{ name: 'chromium', use: use(['defaultBrowserType', 'chromium'], rules) }] };
    expect(configBypasses(firefox)).toEqual(['chromium: runs firefox, which has no hands-off resolver rules']);
    const merged = {
      use: use(['defaultBrowserType', 'webkit'], rules),
      projects: [
        { name: 'webkit' },
        { name: 'chromium', use: use(['browserName', 'chromium'], ['launchOptions', undefined]) },
        { name: 'replaces', use: use(['defaultBrowserType', 'chromium'], ['launchOptions', { args: ['--disable-gpu'] }]) },
      ],
    };
    expect(configBypasses(merged, { webkit: 'webkit' })).toEqual(['replaces: launches Chromium without the hands-off resolver rules']);
  });

  it('wants HANDS_OFF_LAUNCH_ARGS as the only args that touch the resolver or a proxy, and no proxy or env in the launch options', () => {
    const launch = (...options: [string, unknown][]) => ['launchOptions', Object.freeze(Object.fromEntries(options))] as [string, unknown];
    const config = {
      projects: [
        { name: 'later-rules', use: use(launch(['args', [...HANDS_OFF_LAUNCH_ARGS, '--host-resolver-rules=MAP fc-canary.test 127.0.0.1']])) },
        { name: 'rules-first', use: use(launch(['args', ['--host-resolver-rules=MAP * 127.0.0.1', ...HANDS_OFF_LAUNCH_ARGS]])) },
        { name: 'proxy-arg', use: use(launch(['args', [...HANDS_OFF_LAUNCH_ARGS, '--proxy-server=http://127.0.0.1:9']])) },
        { name: 'ends-switches', use: use(launch(['args', ['--', ...HANDS_OFF_LAUNCH_ARGS]])) },
        { name: 'plain-switches', use: use(launch(['args', Object.freeze([...HANDS_OFF_LAUNCH_ARGS, '--disable-gpu', '--no-proxy-server'])])) },
        { name: 'launch-proxy', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['proxy', { server: 'http://127.0.0.1:9' }])) },
        { name: 'launch-env', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['env', { http_proxy: 'http://127.0.0.1:9' }])) },
      ],
    };
    const round = 'launches Chromium with an arg that replaces or goes round the hands-off resolver rules';
    expect(configBypasses(config)).toEqual([
      `later-rules: ${round}`,
      `rules-first: ${round}`,
      `proxy-arg: ${round}`,
      `ends-switches: ${round}`,
      'launch-proxy: launchOptions.proxy sends requests through a proxy, which looks the hands-off hosts up itself',
      "launch-env: launchOptions.env replaces the browser's environment, which can carry a proxy that goes round the hands-off resolver rules",
    ]);
  });

  it("flags ignoreDefaultArgs in the launch options, in the config or in any project: Playwright takes each arg it names off Chromium's command line, the rules among them", () => {
    const launch = (...options: [string, unknown][]) => ['launchOptions', Object.freeze(Object.fromEntries(options))] as [string, unknown];
    const ignoresRules = launch(['args', HANDS_OFF_LAUNCH_ARGS], ['ignoreDefaultArgs', Object.freeze([...HANDS_OFF_LAUNCH_ARGS])]);
    const config = {
      use: use(ignoresRules),
      projects: [
        { name: 'from-config' },
        { name: 'ignores-rules', use: use(ignoresRules) },
        { name: 'ignores-first', use: use(launch(['ignoreDefaultArgs', HANDS_OFF_LAUNCH_ARGS], ['args', HANDS_OFF_LAUNCH_ARGS])) },
        { name: 'ignores-all-defaults', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['ignoreDefaultArgs', true])) },
        { name: 'unset', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['ignoreDefaultArgs', undefined])) },
        // Set, if harmless: only undefined is unset, so it is flagged as any value is.
        { name: 'ignores-none', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['ignoreDefaultArgs', false])) },
      ],
    };
    const ignored = "launchOptions.ignoreDefaultArgs can take the hands-off resolver rules off Chromium's command line";
    expect(configBypasses(config)).toEqual([
      `(config): ${ignored}`,
      `ignores-rules: ${ignored}`,
      `ignores-first: ${ignored}`,
      `ignores-all-defaults: ${ignored}`,
      `ignores-none: ${ignored}`,
    ]);
  });

  it('flags every launch option but args, proxy and env (each read above): the check reads nothing else, so it wants HANDS_OFF_LAUNCH_OPTIONS and nothing beside it', () => {
    const launch = (...options: [string, unknown][]) => ['launchOptions', Object.freeze(Object.fromEntries(options))] as [string, unknown];
    const config = {
      use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['timeout', 1])),
      projects: [
        { name: 'export', use: use(['launchOptions', HANDS_OFF_LAUNCH_OPTIONS]) },
        { name: 'executable', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['executablePath', '/opt/chromium-wrapper'])) },
        { name: 'slow', use: use(launch(['slowMo', 50], ['args', HANDS_OFF_LAUNCH_ARGS])) },
        { name: 'unset', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['slowMo', undefined])) },
        { name: 'headed', use: use(launch(['args', HANDS_OFF_LAUNCH_ARGS], ['headless', false])) },
      ],
    };
    const unread = 'is a launch option the hands-off check does not read: pass HANDS_OFF_LAUNCH_OPTIONS itself';
    expect(configBypasses(config)).toEqual([
      `(config): launchOptions.timeout ${unread}`,
      `executable: launchOptions.executablePath ${unread}`,
      `slow: launchOptions.slowMo ${unread}`,
      `headed: launchOptions.headless ${unread}`,
    ]);
  });

  it('reads the args against the rules built afresh, so args with one more rule list or a proxy are flagged even if a spec pushed the same onto HANDS_OFF_LAUNCH_ARGS', () => {
    const round = 'launches Chromium with an arg that replaces or goes round the hands-off resolver rules';
    const original = [...HANDS_OFF_LAUNCH_ARGS];
    for (const extra of ['--host-resolver-rules=MAP * 127.0.0.1', '--proxy-server=http://127.0.0.1:9']) {
      let pushed = false;
      try {
        HANDS_OFF_LAUNCH_ARGS.push(extra);
        pushed = true;
      } catch {
        // Frozen: the push is refused, as it should be. The check below must hold either way.
      }
      try {
        const config = { projects: [{ name: 'p', use: use(['launchOptions', { args: Object.freeze([...original, extra]) }]) }] };
        expect(configBypasses(config), extra).toEqual([`p: ${round}`]);
      } finally {
        if (pushed) HANDS_OFF_LAUNCH_ARGS.pop();
      }
    }
  });

  it('wants the args frozen, as HANDS_OFF_LAUNCH_ARGS is: a copy is an array a spec can still push onto through its launchOptions fixture', () => {
    const config = {
      projects: [
        { name: 'copy', use: use(['launchOptions', { args: [...HANDS_OFF_LAUNCH_ARGS] }]) },
        // Sealed is not frozen: an element can still be set, to another rule list.
        { name: 'sealed', use: use(['launchOptions', { args: Object.seal([...HANDS_OFF_LAUNCH_ARGS]) }]) },
        { name: 'itself', use: use(rules) },
        { name: 'frozen-more', use: use(['launchOptions', Object.freeze({ args: Object.freeze([...HANDS_OFF_LAUNCH_ARGS, '--disable-gpu']) })]) },
      ],
    };
    const notFrozen = 'launches Chromium with args a spec can still change (not frozen): give it HANDS_OFF_LAUNCH_ARGS itself';
    expect(configBypasses(config)).toEqual([`copy: ${notFrozen}`, `sealed: ${notFrozen}`]);
  });

  it('wants the launch options frozen too: a spec that imports a config could set args or a proxy on an open object', () => {
    const config = {
      use: use(['launchOptions', { args: HANDS_OFF_LAUNCH_ARGS }]),
      projects: [
        { name: 'from-config' },
        { name: 'open', use: use(['launchOptions', { args: HANDS_OFF_LAUNCH_ARGS }]) },
        { name: 'sealed', use: use(['launchOptions', Object.seal({ args: HANDS_OFF_LAUNCH_ARGS })]) },
        { name: 'export', use: use(['launchOptions', HANDS_OFF_LAUNCH_OPTIONS]) },
        { name: 'frozen', use: use(rules) },
      ],
    };
    const open = 'launches Chromium with launch options a spec can still change (not frozen): give it HANDS_OFF_LAUNCH_OPTIONS itself';
    expect(configBypasses(config)).toEqual([`from-config: ${open}`, `open: ${open}`, `sealed: ${open}`]);
  });

  it('flags a proxy or connectOptions in the config or in any project', () => {
    const config = {
      use: use(['proxy', { server: 'http://127.0.0.1:3128' }]),
      projects: [{ name: 'chromium', use: use(rules, ['connectOptions', { wsEndpoint: 'ws://127.0.0.1:1' }]) }, { use: use(rules, ['proxy', {}]) }],
    };
    expect(configBypasses(config)).toEqual([
      '(config): proxy sends requests through a proxy, which looks the hands-off hosts up itself',
      'chromium: connectOptions connects to a browser with launch args of its own',
      '(unnamed): proxy sends requests through a proxy, which looks the hands-off hosts up itself',
    ]);
  });

  it("flags a proxy in contextOptions, in the config or in any project: Playwright's proxy option reads it, so every context sends through it", () => {
    /** contextOptions holding `proxy`: written as an object literal it would trip e2e/handsOffScan.ts too. */
    const contextProxy = (server: string): [string, unknown] => ['contextOptions', Object.fromEntries([['proxy', { server }]])];
    const config = {
      use: use(contextProxy('http://127.0.0.1:3128')),
      projects: [
        { name: 'chromium', use: use(rules, contextProxy('http://127.0.0.1:9')) },
        { name: 'other-context-options', use: use(rules, ['contextOptions', { ignoreHTTPSErrors: true }]) },
        { name: 'unset-proxy', use: use(rules, ['contextOptions', Object.fromEntries([['proxy', undefined]])]) },
      ],
    };
    const proxied = 'contextOptions.proxy sends requests through a proxy, which looks the hands-off hosts up itself';
    expect(configBypasses(config)).toEqual([`(config): ${proxied}`, `chromium: ${proxied}`]);
    expect(configBypasses({ projects: [{ name: 'project-only', use: use(rules, contextProxy('http://127.0.0.1:9')) }] })).toEqual([`project-only: ${proxied}`]);
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

  it('refuses to guard a context while Object.prototype carries a name of its own: the context may already read it as an option (a proxy)', async () => {
    const context = fakeContext();
    Object.defineProperty(Object.prototype, 'proxy', { value: { server: 'http://127.0.0.1:9' }, configurable: true });
    try {
      await expect(blockHandsOff(context as never)).rejects.toThrow('hands-off: Object.prototype carries proxy, which every options object inherits');
    } finally {
      Reflect.deleteProperty(Object.prototype, 'proxy');
    }
    expect(context.route).not.toHaveBeenCalled();
    await expect(blockHandsOff(context as never)).resolves.toMatchObject({ blocked: [] });
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

describe('refuseRoundTheRules (what every e2e worker checks before it starts)', () => {
  it('passes a worker with no proxy in its environment and no browser to connect to', () => {
    expect(() => refuseRoundTheRules({ PATH: '/usr/bin', no_proxy: 'localhost', NO_PROXY: '*', http_proxy: '' }, undefined)).not.toThrow();
    // Empty is unset to Playwright too; a name that only starts like one of its connect variables is not one.
    expect(() => refuseRoundTheRules({ SELENIUM_REMOTE_URL: '', PW_TEST_CONNECT_WS_ENDPOINT: '', SELENIUM_REMOTE_URLS: 'x', PW_TEST_REPORTER: 'list' }, undefined)).not.toThrow();
  });

  it.each(['http_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'Ftp_Proxy', 'auto_proxy', 'SOCKS_SERVER', 'socks_proxy'])(
    'refuses %s in the environment: Chromium (the headless shell even with --no-proxy-server) would send hosts to it',
    (name) => {
      expect(() => refuseRoundTheRules({ [name]: 'http://127.0.0.1:3128' }, undefined)).toThrow(
        `hands-off: ${name} in this worker's environment sends requests through a proxy, which looks the hands-off hosts up itself`,
      );
    },
  );

  it.each(['SELENIUM_REMOTE_URL', 'selenium_remote_url', 'SELENIUM_REMOTE_CAPABILITIES', 'SELENIUM_REMOTE_HEADERS', 'PW_TEST_CONNECT_WS_ENDPOINT', 'PWTEST_UNDER_TEST'])(
    "refuses %s in the environment, in any case: Playwright reads it at a launch, and it can send the launch to a browser with launch args of its own (a Selenium grid, a browser server, or a test hook that names one)",
    (name) => {
      expect(() => refuseRoundTheRules({ [name]: 'http://127.0.0.1:4444/wd/hub' }, undefined)).toThrow(
        `hands-off: ${name} in this worker's environment can connect it to a browser with launch args of its own`,
      );
    },
  );

  it('refuses a browser to connect to (connectOptions, or PW_TEST_CONNECT_WS_ENDPOINT): it has launch args of its own', () => {
    expect(() => refuseRoundTheRules({}, { wsEndpoint: 'ws://127.0.0.1:1' })).toThrow(
      'hands-off: connectOptions connects this worker to a browser with launch args of its own',
    );
  });

  it('lists every reason at once', () => {
    expect(() => refuseRoundTheRules({ http_proxy: 'http://127.0.0.1:1', SELENIUM_REMOTE_URL: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' }, {})).toThrow(
      /^hands-off: http_proxy .*; SELENIUM_REMOTE_URL .*; HTTPS_PROXY .*; connectOptions .*own$/,
    );
  });
});

describe("refuseRoundTheRulesAtEachLaunch (every launch in an e2e worker, its own browser's included)", () => {
  const LAUNCHERS = ['launch', 'launchPersistentContext', 'launchServer'];
  const CONNECTORS = ['connect', 'connectOverCDP'];
  const ENGINES = ['chromium', 'firefox', 'webkit'] as const;

  /** A stand-in for Playwright's browser types: each launcher and connector records its call (name, `this`, arguments) and answers its name. */
  function fakePlaywright() {
    const made = (engine: string) => {
      const calls: { name: string; self: unknown; args: unknown[] }[] = [];
      const type: Record<string, unknown> = { engine, calls };
      for (const name of [...LAUNCHERS, ...CONNECTORS]) {
        type[name] = async function (this: unknown, ...args: unknown[]) {
          calls.push({ name, self: this, args });
          return `${engine}.${name}`;
        };
      }
      return type as Record<string, (...args: unknown[]) => Promise<unknown>> & { calls: typeof calls };
    };
    return { chromium: made('chromium'), firefox: made('firefox'), webkit: made('webkit') };
  }

  /** Calls a member by a name held in a variable: written out, a launch here would trip e2e/handsOffScan.ts. */
  const start = (type: Record<string, (...args: unknown[]) => Promise<unknown>>, name: string, ...args: unknown[]) => type[name]!(...args);

  it('lets each launch through, with its own `this` and arguments, while the environment is clean', async () => {
    const pw = fakePlaywright();
    refuseRoundTheRulesAtEachLaunch(pw, undefined, () => ({ PATH: '/usr/bin' }));
    for (const engine of ENGINES) {
      for (const name of LAUNCHERS) await expect(start(pw[engine], name, 'dir', { args: [] })).resolves.toBe(`${engine}.${name}`);
      expect(pw[engine].calls).toEqual(LAUNCHERS.map((name) => ({ name, self: pw[engine], args: ['dir', { args: [] }] })));
    }
  });

  it('reads the environment as each launch starts: a proxy or a connect variable written after the worker started is refused before anything launches', async () => {
    const pw = fakePlaywright();
    const env: Record<string, string | undefined> = {};
    refuseRoundTheRulesAtEachLaunch(pw, undefined, () => env);
    await start(pw.chromium, 'launch');
    env.HTTPS_PROXY = 'http://127.0.0.1:9';
    for (const engine of ENGINES) {
      for (const name of LAUNCHERS) {
        await expect(start(pw[engine], name), `${engine}.${name}`).rejects.toThrow("hands-off: HTTPS_PROXY in this worker's environment sends requests through a proxy");
      }
    }
    delete env.HTTPS_PROXY;
    env.SELENIUM_REMOTE_URL = 'http://127.0.0.1:9/wd/hub';
    await expect(start(pw.chromium, 'launch')).rejects.toThrow("hands-off: SELENIUM_REMOTE_URL in this worker's environment can connect it to a browser with launch args of its own");
    expect(ENGINES.flatMap((engine) => pw[engine].calls.map((c) => `${engine}.${c.name}`))).toEqual(['chromium.launch']);
  });

  it("reads this worker's own process.env at each launch unless given another", async () => {
    const pw = fakePlaywright();
    refuseRoundTheRulesAtEachLaunch(pw, undefined);
    await expect(start(pw.chromium, 'launch')).resolves.toBe('chromium.launch');
    vi.stubEnv('SELENIUM_REMOTE_URL', 'http://127.0.0.1:9/wd/hub');
    try {
      await expect(start(pw.chromium, 'launch')).rejects.toThrow('hands-off: SELENIUM_REMOTE_URL');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(pw.chromium.calls).toHaveLength(1);
  });

  it('refuses every launch while the worker has a browser to connect to (connectOptions)', async () => {
    const pw = fakePlaywright();
    refuseRoundTheRulesAtEachLaunch(pw, { wsEndpoint: 'ws://127.0.0.1:9' }, () => ({}));
    await expect(start(pw.webkit, 'launchPersistentContext', 'dir')).rejects.toThrow('hands-off: connectOptions connects this worker to a browser with launch args of its own');
    expect(pw.webkit.calls).toEqual([]);
  });

  it('refuses connect and connectOverCDP outright, on every browser type: a browser connected to has launch args of its own', async () => {
    const pw = fakePlaywright();
    refuseRoundTheRulesAtEachLaunch(pw, undefined, () => ({}));
    for (const engine of ENGINES) {
      for (const name of CONNECTORS) {
        await expect(start(pw[engine], name, 'ws://127.0.0.1:9')).rejects.toThrow(`hands-off: ${engine}.${name} connects this worker to a browser with launch args of its own`);
      }
      expect(pw[engine].calls).toEqual([]);
    }
  });

  it('refuses each launch while Object.prototype carries a name of its own: Playwright reads launch options inherited from it, ignoreDefaultArgs among them', async () => {
    const pw = fakePlaywright();
    refuseRoundTheRulesAtEachLaunch(pw, undefined, () => ({}));
    Object.defineProperty(Object.prototype, 'ignoreDefaultArgs', { value: [...HANDS_OFF_LAUNCH_ARGS], configurable: true });
    try {
      for (const name of LAUNCHERS) {
        await expect(start(pw.chromium, name)).rejects.toThrow('hands-off: Object.prototype carries ignoreDefaultArgs, which every options object inherits');
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, 'ignoreDefaultArgs');
    }
    await expect(start(pw.chromium, 'launch')).resolves.toBe('chromium.launch');
    expect(pw.chromium.calls.map((c) => c.name)).toEqual(['launch']);
  });

  it('installs once per browser type: a second call wraps nothing again, so each launch reads the environment once and launches once', async () => {
    const pw = fakePlaywright();
    let reads = 0;
    const env = () => (reads++, {});
    refuseRoundTheRulesAtEachLaunch(pw, undefined, env);
    refuseRoundTheRulesAtEachLaunch(pw, undefined, env);
    await start(pw.chromium, 'launch');
    expect(reads).toBe(1);
    expect(pw.chromium.calls).toHaveLength(1);
  });
});

describe('refuseInheritedOptions (Object.prototype, which every options object inherits from)', () => {
  it("passes Node's own Object.prototype", () => {
    expect(() => refuseInheritedOptions()).not.toThrow();
    expect(() => refuseInheritedOptions(Object.create(null))).not.toThrow();
  });

  it('refuses any name Node does not put there, by any name and enumerable or not, listing each', () => {
    const prototype = Object.create(null, Object.getOwnPropertyDescriptors(Object.prototype));
    Object.defineProperty(prototype, 'proxy', { value: { server: 'http://127.0.0.1:9' }, enumerable: true });
    Object.defineProperty(prototype, 'ignoreDefaultArgs', { value: true });
    expect(() => refuseInheritedOptions(prototype)).toThrow(
      'hands-off: Object.prototype carries proxy, ignoreDefaultArgs, which every options object inherits: Playwright would read each as an option of every launch or context',
    );
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
