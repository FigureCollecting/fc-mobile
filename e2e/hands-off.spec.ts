import dns from 'node:dns';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { test as guarded, expect } from './fixtures';
import {
  HANDS_OFF_DOMAINS,
  HANDS_OFF_LAUNCH_ARGS,
  blockHandsOff,
  configBypasses,
  guardContext,
  handsOffLookupsRefused,
  handsOffResolverRules,
  isHandsOffHost,
  refuseHandsOffLookups,
} from './handsOff';

/**
 * Ross, 2026-09-29: nothing we run may send a request to a site that bars AI
 * agents by name. These tests never reach one: every browser they use sends
 * every host its rules do not map to a local sentinel (the project's browser
 * too, after the project's own hands-off rules), so a request that gets past
 * the guard under test lands on 127.0.0.1 and fails the test.
 */

/** Images on every hands-off domain: the apex, subdomains, http, https and a port. */
const HANDS_OFF_IMAGES = [
  'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  'https://myfigurecollection.net/pics/item.jpg',
  'http://myfigurecollection.net/pics/item.jpg',
  'https://www.suruga-ya.jp/database/pics/game/g1.jpg',
  'https://suruga-ya.com/img/1.jpg',
  'https://www.hobby-genki.com/img/1.jpg',
  'https://t.vndb.org/cv/00/1.jpg',
  'http://s2.vndb.org:8080/ch/1.jpg',
  // Fully qualified (trailing-dot) names: the same hosts to a resolver.
  'http://vndb.org./v/1.jpg',
  'https://static.myfigurecollection.net./upload/items/1/1.jpg',
  'http://www.suruga-ya.jp../database/pics/1.jpg',
];

/** A host that is not hands-off, loaded first to prove the sentinel catches what a browser sends. */
const CANARY = 'http://fc-canary.test/canary.png';

/** Not hands-off, though they look like it or mention one: the guard must let them through. */
const LOOK_ALIKES = [
  'http://notmyfigurecollection.net/x.png',
  'http://myfigurecollection.net.fc-canary.test/x.png',
  'http://fc-canary.test/from?u=https://static.myfigurecollection.net/x.jpg',
];

/** WebSockets to hands-off hosts (plain ws, so a sentinel would read the Host of any that got out). */
const HANDS_OFF_SOCKETS = [
  'ws://vndb.org/socket',
  'ws://static.myfigurecollection.net/socket',
  'ws://www.suruga-ya.jp:8080/socket',
  'ws://vndb.org./socket',
  'ws://t.vndb.org../socket',
];

/** Opens each WebSocket and resolves with each one's close code. */
async function socketCloseCodes(page: Page, urls: string[]): Promise<number[]> {
  return page.evaluate(
    (all) =>
      Promise.all(
        all.map(
          (u) =>
            new Promise<number>((resolve) => {
              new WebSocket(u).addEventListener('close', (e) => resolve(e.code));
            }),
        ),
      ),
    urls,
  );
}

/** A service worker that fetches each URL posted to it and answers 'answered' or 'refused'. */
const PROBE_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('message', (event) => {
  event.waitUntil(
    fetch(event.data, { mode: 'no-cors' })
      .then(() => 'answered', () => 'refused')
      .then((answer) => event.source.postMessage(answer)),
  );
});
`;

/**
 * A local TCP listener standing in for the internet. It records the Host of
 * each plain HTTP request, or 'tls' for an https handshake, and hangs up.
 */
async function startSentinel() {
  const hosts: string[] = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (chunk) => {
      hosts.push(chunk[0] === 0x16 ? 'tls' : (/\r\nhost: ([^\r\n:]+)/i.exec(chunk.toString('latin1'))?.[1] ?? 'unknown'));
      socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    hosts,
    port,
    /** Last in a rule list: every host no earlier rule maps goes to the sentinel (localhost, where the servers under test are, excepted). */
    catchAll: `MAP * 127.0.0.1:${port}, EXCLUDE localhost, EXCLUDE 127.0.0.1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Sentinel = Awaited<ReturnType<typeof startSentinel>>;

const RESOLVER_RULES_FLAG = '--host-resolver-rules=';

/**
 * The project's browser for this spec: its own launch args, with every host its
 * hands-off rules do not map sent on to a worker sentinel. A test fails if
 * anything reached that sentinel.
 */
const test = guarded.extend<{ netCheck: void }, { net: Sentinel }>({
  net: [
    async ({}, use) => {
      const sentinel = await startSentinel();
      await use(sentinel);
      await sentinel.close();
    },
    { scope: 'worker' },
  ],
  // hands-off-scan: keeps the project's resolver rules and appends the sentinel after them.
  launchOptions: [
    async ({ launchOptions, net }, use) => {
      const args = (launchOptions.args ?? []).map((a) => (a.startsWith(RESOLVER_RULES_FLAG) ? `${a}, ${net.catchAll}` : a));
      await use({ ...launchOptions, args });
    },
    { scope: 'worker' },
  ],
  netCheck: [
    async ({ net }, use) => {
      const before = net.hosts.length;
      await use();
      expect(net.hosts.slice(before), 'what reached the sentinel past every guard').toEqual([]);
    },
    { auto: true },
  ],
});

/** Puts the images in a blank page (no CSP) and waits until each has loaded or failed. */
async function loadImages(page: Page, urls: string[]): Promise<void> {
  await page.setContent(urls.map((u) => `<img src="${u}">`).join(''));
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
}

/** Each failed request's error, by URL. */
function failures(page: Page): Map<string, string> {
  const out = new Map<string, string>();
  page.on('requestfailed', (r) => out.set(r.url(), r.failure()?.errorText ?? ''));
  return out;
}

test('the probe images cover every hands-off domain', () => {
  for (const domain of HANDS_OFF_DOMAINS) {
    const hosts = HANDS_OFF_IMAGES.map((u) => new URL(u).hostname);
    expect(hosts.some((h) => h === domain || h.endsWith(`.${domain}`)), domain).toBe(true);
  }
});

test.describe('resolver rules (the network-level net under every Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '--host-resolver-rules is a Chromium switch');

  test('this project launches Chromium with them', ({}, testInfo) => {
    expect(HANDS_OFF_LAUNCH_ARGS).toHaveLength(1);
    expect(testInfo.project.use.launchOptions?.args ?? []).toEqual(expect.arrayContaining(HANDS_OFF_LAUNCH_ARGS));
  });

  test('a test fails if anything reached the sentinel under its browser', async ({ page, net }) => {
    test.fail(true, "this spec's sentinel check fails the test after it ran: the expected outcome");
    await loadImages(page, [CANARY]);
    await expect.poll(() => net.hosts).toContain('fc-canary.test');
  });

  test("this spec's browser keeps them, and sends what they do not map to the sentinel", async ({ launchOptions, net, page }) => {
    expect(launchOptions.args).toContain(`${HANDS_OFF_LAUNCH_ARGS[0]}, ${net.catchAll}`);
    const failed = failures(page);
    await loadImages(page, [CANARY]);
    await expect.poll(() => net.hosts).toContain('fc-canary.test');
    expect(failed.get(CANARY)).toBe('net::ERR_EMPTY_RESPONSE');
    net.hosts.length = 0;
  });

  test('every Chromium project of every Playwright config (e2e, PWA, stack) launches with them, and none goes round them', async () => {
    /** The one project on another browser: WebKit, with the route guard only, not in CI (README). */
    const others = { '../playwright.config.ts': { webkit: 'webkit' }, '../playwright.pwa.config.ts': {}, '../playwright.stack.config.ts': {} };
    for (const [file, other] of Object.entries(others)) {
      const { default: config } = (await import(file)) as { default: Parameters<typeof configBypasses>[0] };
      expect(config.projects.length, file).toBeGreaterThan(0);
      expect(configBypasses(config, other), file).toEqual([]);
    }
  });

  test('they give a hands-off host no address, so an image there is never sent even with no route', async ({ playwright }) => {
    const sentinel = await startSentinel();
    const rules = [handsOffResolverRules(), sentinel.catchAll].filter(Boolean).join(', ');
    // hands-off-scan: its own rules, the hands-off ones first and then the sentinel.
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=${rules}`] });
    try {
      // hands-off-scan: no route guard, on purpose: the resolver rules alone are under test.
      const page = await browser.newPage();
      const failed = failures(page);
      await loadImages(page, [CANARY]);
      await expect.poll(() => sentinel.hosts, 'the canary reached the sentinel').toContain('fc-canary.test');

      await loadImages(page, HANDS_OFF_IMAGES);
      expect(new Set(sentinel.hosts)).toEqual(new Set(['fc-canary.test']));
      for (const url of HANDS_OFF_IMAGES) expect(failed.get(url), url).toBe('net::ERR_NAME_NOT_RESOLVED');
    } finally {
      await browser.close();
      await sentinel.close();
    }
  });
});

test.describe('the route guard every e2e context gets', () => {
  // The resolver rules are the net under these tests; WebKit has none.
  test.skip(({ browserName }) => browserName !== 'chromium', 'runs only where the resolver rules back it up');

  test('aborts an image on every hands-off host before it is sent', async ({ page, handsOffBlocked }) => {
    const failed = failures(page);
    const answered: string[] = [];
    page.on('response', (r) => answered.push(r.url()));

    await loadImages(page, HANDS_OFF_IMAGES);

    expect(new Set(handsOffBlocked)).toEqual(new Set(HANDS_OFF_IMAGES));
    // Blocked by the client (the route), not a failed lookup (the resolver rules under it).
    for (const url of HANDS_OFF_IMAGES) expect(failed.get(url), url).toMatch(/^net::ERR_BLOCKED_BY_CLIENT\b/);
    expect(answered).toEqual([]);
    expect(await page.evaluate(() => Array.from(document.images, (img) => img.naturalWidth))).toEqual(HANDS_OFF_IMAGES.map(() => 0));
  });

  test('aborts a fetch and a navigation to a hands-off host too', async ({ page, handsOffBlocked }) => {
    const fetched = await page.evaluate(() =>
      fetch('https://vndb.org/v11').then(
        () => 'answered',
        () => 'refused',
      ),
    );
    expect(fetched).toBe('refused');
    await expect(page.goto('https://myfigurecollection.net/item/1')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(handsOffBlocked).toEqual(['https://vndb.org/v11', 'https://myfigurecollection.net/item/1']);
  });

  test('blockHandsOff keeps any browser off the hosts and lets other hosts through', async ({ playwright }) => {
    const sentinel = await startSentinel();
    // No hands-off rules here: whatever the guard lets through reaches the sentinel.
    // hands-off-scan: no hands-off rules, on purpose: the sentinel catches whatever the guard lets through.
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=${sentinel.catchAll}`] });
    try {
      const context = await browser.newContext();
      const { blocked } = await blockHandsOff(context);
      const page = await context.newPage();
      await loadImages(page, [CANARY]);
      await expect.poll(() => sentinel.hosts, 'the canary reached the sentinel').toContain('fc-canary.test');

      await loadImages(page, [...HANDS_OFF_IMAGES, ...LOOK_ALIKES]);
      await expect
        .poll(() => new Set(sentinel.hosts))
        .toEqual(new Set(['fc-canary.test', 'notmyfigurecollection.net', 'myfigurecollection.net.fc-canary.test']));
      expect(new Set(blocked)).toEqual(new Set(HANDS_OFF_IMAGES));
    } finally {
      await browser.close();
      await sentinel.close();
    }
  });

  test('closes a WebSocket to a hands-off host before it connects', async ({ page, handsOffBlocked }) => {
    await page.setContent('<title>probe</title>');
    // 1008: closed by the guard (policy), not 1006 from a failed lookup (the resolver rules under it).
    expect(await socketCloseCodes(page, HANDS_OFF_SOCKETS)).toEqual(HANDS_OFF_SOCKETS.map(() => 1008));
    expect(new Set(handsOffBlocked)).toEqual(new Set(HANDS_OFF_SOCKETS));
  });

  test('blockHandsOff keeps any browser\'s WebSockets off the hosts and lets others through', async ({ playwright }) => {
    const sentinel = await startSentinel();
    // hands-off-scan: no hands-off rules, on purpose: the sentinel catches whatever the guard lets through.
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=${sentinel.catchAll}`] });
    try {
      const context = await browser.newContext();
      const { blocked } = await blockHandsOff(context);
      const page = await context.newPage();
      await page.setContent('<title>probe</title>');
      await socketCloseCodes(page, ['ws://fc-canary.test/socket', 'ws://notmyfigurecollection.net/socket', ...HANDS_OFF_SOCKETS]);
      await expect.poll(() => new Set(sentinel.hosts)).toEqual(new Set(['fc-canary.test', 'notmyfigurecollection.net']));
      expect(new Set(blocked)).toEqual(new Set(HANDS_OFF_SOCKETS));
    } finally {
      await browser.close();
      await sentinel.close();
    }
  });

  test('guardContext fails its test on a hands-off request the route guard never saw (a redirect hop)', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const blocked: string[] = [];
      let navigation = '';
      const run = guardContext(context, blocked, async () => {
        const page = await context.newPage();
        // The redirect comes from a route, so nothing leaves the browser; the hop itself is never routed.
        await page.route('http://fc-redirector.test/**', (route) => route.fulfill({ status: 302, headers: { Location: 'http://vndb.org./v11' } }));
        navigation = await page.goto('http://fc-redirector.test/go').then(
          () => 'loaded',
          (e: Error) => e.message,
        );
      });
      await expect(run).rejects.toThrow(
        'hands-off requests the route guard did not abort: http://vndb.org./v11 (redirect from http://fc-redirector.test/go)',
      );
      // The resolver rules stopped the hop.
      expect(navigation).toMatch(/net::ERR_NAME_NOT_RESOLVED/);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a redirect hop to a hands-off host fails the e2e test that followed it', async ({ page, handsOffBlocked }) => {
    test.fail(true, "the fixture's check fails this test after it ran: the expected outcome");
    await page.route('http://fc-redirector.test/**', (route) => route.fulfill({ status: 302, headers: { Location: 'http://vndb.org/v11' } }));
    await expect(page.goto('http://fc-redirector.test/go')).rejects.toThrow(/net::ERR_NAME_NOT_RESOLVED/);
    expect(handsOffBlocked).toEqual([]);
  });

  test("aborts a service worker's own request to a hands-off host too", async ({ context, page, handsOffBlocked }) => {
    const url = HANDS_OFF_IMAGES[0] as string;
    const failed = new Map<string, string>();
    context.on('requestfailed', (r) => {
      if (r.serviceWorker()) failed.set(r.url(), r.failure()?.errorText ?? '');
    });
    // A page and a worker of our own on the e2e origin (no CSP): the worker fetches what the page posts it.
    await context.route('**/hands-off-probe/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
    await context.route('**/hands-off-probe/sw.js', (route) => route.fulfill({ contentType: 'text/javascript', body: PROBE_WORKER }));
    await page.goto('/hands-off-probe/');

    const answer = await page.evaluate(async (target) => {
      const reg = await navigator.serviceWorker.register('/hands-off-probe/sw.js', { scope: '/hands-off-probe/' });
      const worker = (reg.installing ?? reg.waiting ?? reg.active) as ServiceWorker;
      await new Promise<void>((resolve) => {
        if (worker.state === 'activated') resolve();
        else worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
      });
      const reply = new Promise<string>((resolve) => navigator.serviceWorker.addEventListener('message', (e) => resolve(String(e.data))));
      worker.postMessage(target);
      return reply;
    }, url);

    expect(answer).toBe('refused');
    expect(handsOffBlocked).toEqual([url]);
    expect(failed.get(url)).toMatch(/^net::ERR_BLOCKED_BY_CLIENT\b/);
  });
});

test.describe("API requests and this worker's own DNS (sent from Node: no route or resolver rule sees them)", () => {
  // A local proxy stands in for the internet: an API request the guard lets through lands on it, never on the host.
  const proxied = test.extend<{ proxyNet: Sentinel }>({
    proxyNet: async ({}, use) => {
      const sentinel = await startSentinel();
      await use(sentinel);
      await sentinel.close();
    },
    // hands-off-scan: the proxy is a local sentinel; the guards under test refuse before anything reaches it.
    proxy: async ({ proxyNet }, use) => {
      await use({ server: `http://127.0.0.1:${proxyNet.port}` });
    },
  });

  proxied('the request fixture, context.request and page.request refuse a hands-off URL before sending it', async ({ request, context, page, handsOffBlocked, proxyNet }) => {
    await request.get('http://fc-canary.test/api').catch(() => undefined);
    expect(proxyNet.hosts, 'the canary reached the stand-in proxy').toEqual(['fc-canary.test']);

    const sent = [
      ['http://vndb.org/v11', () => request.get('http://vndb.org/v11')],
      ['https://static.myfigurecollection.net./x.jpg', () => request.fetch('https://static.myfigurecollection.net./x.jpg', { method: 'HEAD' })],
      ['http://www.suruga-ya.jp/api', () => context.request.post('http://www.suruga-ya.jp/api', { data: {} })],
      ['https://t.vndb.org../x.jpg', () => page.request.get('https://t.vndb.org../x.jpg')],
    ] as const;
    for (const [url, send] of sent) await expect(send(), url).rejects.toThrow(`hands-off host, not sent: ${url}`);
    expect(proxyNet.hosts).toEqual(['fc-canary.test']);
    expect(handsOffBlocked).toEqual(sent.map(([url]) => url));
  });

  proxied.describe('under a hands-off baseURL', () => {
    proxied.use({ baseURL: 'http://vndb.org' });

    proxied('context.request and page.request read a relative URL against it, and refuse it', async ({ context, page, handsOffBlocked, proxyNet }) => {
      for (const send of [() => context.request.get('/v11'), () => page.request.get('/v11')]) await expect(send()).rejects.toThrow('hands-off host, not sent: /v11');
      expect(proxyNet.hosts).toEqual([]);
      expect(handsOffBlocked).toEqual(['/v11', '/v11']);
    });
  });

  test("this worker's DNS has no address for a hands-off host, so nothing the guards miss is sent from Node", async ({ playwright }) => {
    // First, with nothing real under it: the lines below ask this worker's DNS, so unless its refusal works, is installed
    // and knows these hosts, they would ask the real one.
    const hosts = ['vndb.org', 'T.VNDB.ORG.', 'static.myfigurecollection.net..'];
    expect(hosts.filter((host) => !isHandsOffHost(host))).toEqual([]);
    const passedOn: unknown[] = [];
    const standIn = {
      lookup: (host: unknown, ...rest: unknown[]) => {
        passedOn.push(host);
        (rest[rest.length - 1] as (error: null, address: string, family: number) => void)(null, '192.0.2.1', 4);
      },
      promises: { lookup: async (host: unknown) => (passedOn.push(host), { address: '192.0.2.1', family: 4 }) },
    };
    refuseHandsOffLookups(standIn as never);
    for (const host of hosts) {
      await expect(standIn.promises.lookup(host), host).rejects.toMatchObject({ code: 'ENOTFOUND' });
      await expect(new Promise((resolve, reject) => standIn.lookup(host, (error: Error | null) => (error ? reject(error) : resolve(host)))), host).rejects.toMatchObject({
        code: 'ENOTFOUND',
      });
    }
    expect(passedOn, 'what the refusal passed on to the stand-in').toEqual([]);
    expect(handsOffLookupsRefused(), 'e2e/fixtures.ts refuses hands-off lookups in every worker').toBe(true);

    for (const host of hosts) {
      await expect(dns.promises.lookup(host), host).rejects.toMatchObject({ code: 'ENOTFOUND', hostname: host });
      await expect(
        new Promise((resolve, reject) => dns.lookup(host, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)))),
        host,
      ).rejects.toMatchObject({ code: 'ENOTFOUND', hostname: host });
    }
    await expect(dns.promises.lookup('localhost')).resolves.toMatchObject({ address: expect.any(String) });

    // Node's own fetch, and an API request context of Playwright's with no guard on it.
    await expect(fetch('http://vndb.org/v11')).rejects.toMatchObject({ cause: { code: 'ENOTFOUND', hostname: 'vndb.org' } });
    // hands-off-scan: unguarded on purpose, to show the DNS under it.
    const api = await playwright.request.newContext();
    try {
      await expect(api.get('http://vndb.org./v11')).rejects.toThrow('getaddrinfo ENOTFOUND vndb.org. (a hands-off host)');
    } finally {
      await api.dispose();
    }
  });
});

test.describe('the vite dev server (npm run dev, and any spike page it serves)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'runs only where the resolver rules back it up');

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  let server: ViteDevServer;
  let origin: string;

  test.beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({
      configFile: path.join(repoRoot, 'vite.config.ts'),
      mode: 'development',
      logLevel: 'error',
      server: { port: 0 },
    });
    await server.listen();
    origin = new URL(server.resolvedUrls?.local[0] as string).origin;
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('refuses a hands-off image under its CSP, so the page never even asks for it', async ({ page, handsOffBlocked, cspViolations }) => {
    // The app's shell only: the app is not what this checks.
    await page.route(`${origin}/src/main.tsx`, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    const response = await page.goto(`${origin}/`);
    const served = response?.headers()['content-security-policy'];
    expect(served, 'the dev server sends a CSP').toBeTruthy();
    expect(served).toBe(server.config.server.headers?.['Content-Security-Policy']);

    const control = `${origin}/favicon.svg`;
    await page.evaluate((urls) => {
      for (const src of urls) document.body.append(Object.assign(new Image(), { src }));
    }, [control, ...HANDS_OFF_IMAGES]);
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));

    expect(await page.locator(`img[src="${control}"]`).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect
      .poll(() => new Set(cspViolations.map((v) => `${v.directive} ${v.blocked}`)))
      .toEqual(new Set(HANDS_OFF_IMAGES.map((u) => `img-src ${u}`)));
    // Refused by the CSP before any request: the route guard never saw one.
    expect(handsOffBlocked).toEqual([]);
    cspViolations.length = 0;
  });

  test('serves a spike page from its own file under the CSP too, which refuses the hands-off images in its markup', async ({ page, handsOffBlocked, cspViolations }, testInfo) => {
    // A spike page as SC-0 or CAB-PERF adds one: an HTML file of its own in the repo, not the app's index.html.
    // test-results/ is in the repo (so the dev server serves it) and outside vite's file watcher.
    const file = testInfo.outputPath('spike.html');
    writeFileSync(file, `<!doctype html><html><body>${['/favicon.svg', ...HANDS_OFF_IMAGES].map((u) => `<img src="${u}">`).join('')}</body></html>`);
    const url = `${origin}/${path.relative(repoRoot, file).split(path.sep).map(encodeURIComponent).join('/')}`;

    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    expect(await page.title(), 'its own page, not the app shell').toBe('');
    expect(response?.headers()['content-security-policy']).toBe(server.config.server.headers?.['Content-Security-Policy']);
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));

    expect(await page.locator('img[src="/favicon.svg"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect
      .poll(() => new Set(cspViolations.map((v) => `${v.directive} ${v.blocked}`)))
      .toEqual(new Set(HANDS_OFF_IMAGES.map((u) => `img-src ${u}`)));
    expect(handsOffBlocked).toEqual([]);
    cspViolations.length = 0;
  });

  test('does not stop a navigation under that CSP: in a spec, the route guard does', async ({ page, handsOffBlocked, cspViolations }, testInfo) => {
    const file = testInfo.outputPath('spike-links.html');
    writeFileSync(file, '<!doctype html><title>links</title><a id="out" href="https://vndb.org/v11">out</a>');
    await page.goto(`${origin}/${path.relative(repoRoot, file).split(path.sep).map(encodeURIComponent).join('/')}`);
    await page.click('#out');
    await expect.poll(() => [...handsOffBlocked]).toEqual(['https://vndb.org/v11']);
    // The CSP saw nothing to refuse: the link was followed, and the guard stopped it.
    expect(cspViolations).toEqual([]);
  });

  test('runs the app itself under that CSP: the case view draws, HMR connects, and nothing is refused', async ({ page, handsOffBlocked }) => {
    test.setTimeout(120_000); // the first visit pre-bundles the app's dependencies
    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.addInitScript(() => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
    });

    await page.goto(`${origin}/?layout=case&motif=detolf-dark&density=compact`);
    await page.locator('button.shelf-figure').first().waitFor({ timeout: 90_000 });
    await expect.poll(() => sockets.some((u) => u.startsWith(origin.replace(/^http/, 'ws')))).toBe(true);
    expect(handsOffBlocked).toEqual([]);
    // The cspViolations fixture fails the test on any violation (an inline script or style, the HMR socket).
  });
});
