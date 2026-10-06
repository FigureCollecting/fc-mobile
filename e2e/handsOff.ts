import dns from 'node:dns';
import { isDeepStrictEqual } from 'node:util';
import type { APIRequestContext, BrowserContext, Request } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * The e2e suites stop one at each layer it could leave by, each tested in
 * e2e/hands-off.spec.ts against local sentinels:
 * - every fixture context (e2e/fixtures.ts, guardContext) aborts its pages'
 *   and workers' requests to these hosts, closes its pages' WebSockets to them
 *   and refuses its API requests to them, and fails its test on one that got
 *   past (a redirect hop);
 * - every Chromium they launch gets HANDS_OFF_LAUNCH_ARGS (frozen, so no spec
 *   can change them), so its resolver has no address for them (which also
 *   stops a redirect hop), and no arg beside them that replaces them or goes
 *   round them (configBypasses for the configs, against the rules built
 *   afresh; e2e/handsOffScan.ts for the specs);
 * - no worker starts with a proxy in its environment or a browser to connect
 *   to (refuseRoundTheRules);
 * - each worker's Node DNS has none either (refuseHandsOffLookups);
 * - e2e/handsOffScan.ts keeps every spec on these guards.
 * The app's CSP and the vite dev server's refuse requests to them before they
 * are sent, as the route guard does; a CSP does not stop a navigation. Neither
 * stops the connection: for an https frame or form post the CSP refuses, or a
 * popup the guard aborts, full Chromium still connects to the host and sends
 * it a TLS ClientHello naming it. Only the resolver rules stop that (tested in
 * e2e/hands-off.spec.ts), so open a spike page only in a Chromium launched
 * with HANDS_OFF_LAUNCH_ARGS, never in your own browser.
 */
export const HANDS_OFF_DOMAINS = Object.freeze(['myfigurecollection.net', 'suruga-ya.jp', 'suruga-ya.com', 'hobby-genki.com', 'vndb.org'] as const);

/**
 * Chromium --host-resolver-rules: each domain and every host under it resolves
 * to nothing, spelled with trailing dots too (vndb.org. is the same host to a
 * resolver). The trailing-dot patterns fail closed: a name that only starts
 * with a hands-off domain (vndb.org.example) resolves to nothing as well.
 */
export function handsOffResolverRules(): string {
  return HANDS_OFF_DOMAINS.flatMap((d) => [`MAP ${d} ~NOTFOUND`, `MAP *.${d} ~NOTFOUND`, `MAP ${d}.* ~NOTFOUND`, `MAP *.${d}.* ~NOTFOUND`]).join(', ');
}

/** The hands-off launch args, built afresh: what every check compares a browser's args with, never the export a spec could reach. */
function handsOffLaunchArgs(): string[] {
  return [`--host-resolver-rules=${handsOffResolverRules()}`];
}

/**
 * The args every Chromium the suites launch gets. Frozen, as HANDS_OFF_DOMAINS
 * is: a spec that pushes onto it or sets an element throws before any browser
 * launches with the change. The configs pass this array itself, never a copy,
 * so the args a worker launches with (its launchOptions fixture's) are frozen
 * too. Typed string[] because Playwright's launch args are: the freeze holds
 * at run time, where nothing type-checks the specs.
 */
export const HANDS_OFF_LAUNCH_ARGS: string[] = Object.freeze(handsOffLaunchArgs()) as string[];

/**
 * The launch options of every Chromium project in the three configs:
 * HANDS_OFF_LAUNCH_ARGS, in an object frozen as they are. A spec that imports a
 * config and sets the args or adds a proxy throws, as one that pushes onto the
 * args does; the configs pass this object itself, never a copy.
 */
export const HANDS_OFF_LAUNCH_OPTIONS: { args: string[] } = Object.freeze({ args: HANDS_OFF_LAUNCH_ARGS });

/** Chromium switches that replace the hands-off resolver rules, or send requests round them (a proxy looks hosts up itself). */
const ROUND_THE_RULES = ['host-resolver-rules', 'host-rules', 'proxy-server', 'proxy-pac-url', 'proxy-auto-detect'];

/**
 * Whether a Chromium launch arg could replace the hands-off resolver rules or go
 * round them: a rule list (Chromium keeps the last one given), a proxy switch,
 * or a lone `--`, after which nothing is a switch. Read so that it fails closed:
 * any number of leading dashes (Chromium takes `-x` as `--x`), in any case.
 */
export function goesRoundTheRules(arg: string): boolean {
  if (arg === '--') return true;
  const name = arg.replace(/^-+/, '').toLowerCase();
  return ROUND_THE_RULES.some((s) => name.startsWith(s));
}

/** The options of a Playwright config's or project's `use` that decide its browser and how it reaches the network. */
export interface ConfigUse {
  browserName?: string;
  defaultBrowserType?: string;
  launchOptions?: { args?: string[]; proxy?: unknown; env?: unknown };
  /** Playwright's proxy option falls back on contextOptions.proxy, so every context sends through it. */
  contextOptions?: { proxy?: unknown };
  proxy?: unknown;
  connectOptions?: unknown;
}

/** A project's `use` as Playwright merges it: the config's, with each option the project sets to anything but undefined over it. */
function mergedUse(config: ConfigUse = {}, project: ConfigUse = {}): ConfigUse {
  return { ...config, ...Object.fromEntries(Object.entries(project).filter(([, value]) => value !== undefined)) };
}

/**
 * What in a Playwright config keeps a browser off the hands-off resolver rules,
 * as `project: what`. Each project is read as Playwright merges it (its `use`
 * over the config's): a Chromium project whose launch args leave the rules out,
 * hold any other arg that could replace them or go round them, or are not
 * frozen (a spec could push onto them through its launchOptions fixture before
 * the worker's browser launches), or launch options that are not frozen (a
 * spec that imports the config could set args or a proxy on them); a project
 * on another browser that `others`
 * (project name to its browser) does not name. The rules are built afresh for
 * the comparison, not read from HANDS_OFF_LAUNCH_ARGS.
 * Then, where each is written: a proxy, connectOptions, launch options with a
 * proxy or an env of their own, or context options with a proxy.
 */
export function configBypasses(config: { use?: ConfigUse; projects: { name?: string; use?: ConfigUse }[] }, others: Record<string, string> = {}): string[] {
  const found: string[] = [];
  for (const project of config.projects) {
    const name = project.name ?? '(unnamed)';
    const use = mergedUse(config.use, project.use);
    const engine = use.browserName ?? use.defaultBrowserType ?? 'chromium';
    const args = use.launchOptions?.args ?? [];
    const rules = handsOffLaunchArgs();
    if (engine !== 'chromium') {
      if (others[name] !== engine) found.push(`${name}: runs ${engine}, which has no hands-off resolver rules`);
    } else if (!rules.every((arg) => args.includes(arg))) {
      found.push(`${name}: launches Chromium without the hands-off resolver rules`);
    } else if (!isDeepStrictEqual(args.filter(goesRoundTheRules), rules)) {
      found.push(`${name}: launches Chromium with an arg that replaces or goes round the hands-off resolver rules`);
    } else if (!Object.isFrozen(args)) {
      found.push(`${name}: launches Chromium with args a spec can still change (not frozen): give it HANDS_OFF_LAUNCH_ARGS itself`);
    } else if (!Object.isFrozen(use.launchOptions)) {
      found.push(`${name}: launches Chromium with launch options a spec can still change (not frozen): give it HANDS_OFF_LAUNCH_OPTIONS itself`);
    }
  }
  const proxied = 'sends requests through a proxy, which looks the hands-off hosts up itself';
  // A proxy looks hosts up itself, and a browser connected to has launch args of its own: either goes round the rules.
  for (const [where, use] of [['(config)', config.use], ...config.projects.map((p) => [p.name ?? '(unnamed)', p.use] as const)] as const) {
    if (use?.proxy !== undefined) found.push(`${where}: proxy ${proxied}`);
    if (use?.connectOptions !== undefined) found.push(`${where}: connectOptions connects to a browser with launch args of its own`);
    if (use?.launchOptions?.proxy !== undefined) found.push(`${where}: launchOptions.proxy ${proxied}`);
    if (use?.contextOptions?.proxy !== undefined) found.push(`${where}: contextOptions.proxy ${proxied}`);
    if (use?.launchOptions?.env !== undefined) {
      found.push(`${where}: launchOptions.env replaces the browser's environment, which can carry a proxy that goes round the hands-off resolver rules`);
    }
  }
  return found;
}

/** Where Chromium and Node read a proxy from in the environment, by name in any case (no_proxy only lists hosts to skip one for). */
const PROXY_VARIABLES = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'auto_proxy', 'socks_server', 'socks_proxy']);

/**
 * Throws if this worker would run its browsers round the hands-off resolver
 * rules: a proxy in its environment (Chromium sends hosts to it unresolved; the
 * headless shell does even with --no-proxy-server), or a browser to connect to
 * (connectOptions, which PW_TEST_CONNECT_WS_ENDPOINT sets), which has launch
 * args of its own. Every reason, in one error.
 */
export function refuseRoundTheRules(env: Record<string, string | undefined>, connectOptions: unknown): void {
  const reasons = Object.entries(env)
    .filter(([name, value]) => PROXY_VARIABLES.has(name.toLowerCase()) && !!value)
    .map(([name]) => `${name} in this worker's environment sends requests through a proxy, which looks the hands-off hosts up itself`);
  if (connectOptions !== undefined) reasons.push('connectOptions connects this worker to a browser with launch args of its own');
  if (reasons.length > 0) throw new Error(`hands-off: ${reasons.join('; ')}`);
}

/** Whether a hostname is a hands-off domain or under one, in any case and with any trailing dots (a look-alike is not). */
export function isHandsOffHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  return HANDS_OFF_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Whether the URL's host (a relative URL read against `base`) is a hands-off domain or under one (a look-alike is not). */
export function isHandsOffUrl(url: string, base?: string): boolean {
  let host: string;
  try {
    host = new URL(url, base).hostname;
  } catch {
    return false;
  }
  return isHandsOffHost(host);
}

/** Any URL that mentions a hands-off domain; isHandsOffUrl decides. */
const MENTIONS_HANDS_OFF = new RegExp(HANDS_OFF_DOMAINS.map((d) => d.replaceAll('.', '\\.')).join('|'), 'i');

type Guardable = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'on' | 'request'>;

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
 * one before it connects, refuses its own API requests to one (context.request,
 * which page.request is; a relative URL read against `baseURL`, the context's
 * own), and lists each in `blocked`. Routes never see a redirect hop, so it
 * also watches what the context sends: `escaped` lists any hands-off request it
 * did not abort. A route the spec adds later runs first: one that sends the
 * request on (continue) or fetches it (route.fetch) goes round the abort and
 * the API guard, which e2e/handsOffScan.ts stops.
 */
export async function blockHandsOff(context: Guardable, blocked: string[] = [], baseURL?: string): Promise<HandsOffGuard> {
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
    // hands-off-scan: the guard's own route connects only a WebSocket that is not to a hands-off host.
    if (!isHandsOffUrl(ws.url())) return ws.connectToServer();
    blocked.push(ws.url());
    return ws.close({ code: 1008, reason: 'hands-off host' });
  });
  refuseHandsOffRequests(context.request, blocked, baseURL);
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
 * The context every e2e fixture test gets: guarded by blockHandsOff (with the
 * test's baseURL) while the test runs, and the test fails afterwards if any
 * hands-off request escaped the guard.
 */
export async function guardContext<C extends Guardable>(context: C, blocked: string[], use: (context: C) => Promise<void>, baseURL?: string): Promise<void> {
  const guard = await blockHandsOff(context, blocked, baseURL);
  await use(context);
  const escaped = guard.escaped();
  if (escaped.length > 0) throw new Error(`hands-off requests the route guard did not abort: ${escaped.join(', ')}`);
}

/**
 * Makes an API request context (the request fixture, context.request) refuse a
 * hands-off URL before sending it, and list it in `blocked`. It runs in Node,
 * so no route, resolver rule or CSP sees it. Every method (get, post, ...)
 * sends through `fetch`.
 */
export function refuseHandsOffRequests(api: Pick<APIRequestContext, 'fetch'>, blocked: string[] = [], baseURL?: string): void {
  const send = api.fetch.bind(api);
  api.fetch = async (urlOrRequest, options) => {
    const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url();
    if (isHandsOffUrl(url, baseURL)) {
      blocked.push(url);
      throw new Error(`hands-off host, not sent: ${url}`);
    }
    return send(urlOrRequest, options);
  };
}

type Lookups = { lookup: typeof dns.lookup; promises: { lookup: typeof dns.promises.lookup } };

const REFUSES_HANDS_OFF = Symbol.for('fc-mobile.e2e.refusesHandsOff');

function notFound(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname} (a hands-off host)`), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname });
}

/**
 * Makes this process's DNS lookups (dns.lookup and dns.promises.lookup: what
 * Node's net, http and fetch, and Playwright's API requests, resolve with) find
 * no address for a hands-off host, as the resolver rules do in Chromium. Every
 * other lookup goes to the real one unchanged. Installs each once per module.
 */
export function refuseHandsOffLookups(module: Lookups = dns): void {
  const lookup = module.lookup;
  if (!(REFUSES_HANDS_OFF in lookup)) {
    const refusing = function (this: unknown, hostname: string, ...rest: unknown[]) {
      if (typeof hostname === 'string' && isHandsOffHost(hostname)) {
        process.nextTick(rest[rest.length - 1] as (error: Error) => void, notFound(hostname));
        return;
      }
      return (lookup as (...args: unknown[]) => void).call(this, hostname, ...rest);
    };
    // util.promisify(dns.lookup) resolves with { address, family } through this symbol.
    for (const key of Object.getOwnPropertySymbols(lookup)) Object.assign(refusing, { [key]: (lookup as unknown as Record<symbol, unknown>)[key] });
    module.lookup = Object.assign(refusing, { [REFUSES_HANDS_OFF]: true }) as unknown as typeof dns.lookup;
  }

  const promised = module.promises.lookup;
  if (!(REFUSES_HANDS_OFF in promised)) {
    const refusingPromise = function (this: unknown, hostname: string, ...rest: unknown[]) {
      if (typeof hostname === 'string' && isHandsOffHost(hostname)) return Promise.reject(notFound(hostname));
      return (promised as (...args: unknown[]) => Promise<unknown>).call(this, hostname, ...rest);
    };
    module.promises.lookup = Object.assign(refusingPromise, { [REFUSES_HANDS_OFF]: true }) as unknown as typeof dns.promises.lookup;
  }
}

/** Whether refuseHandsOffLookups is installed on the module (this process's dns by default). */
export function handsOffLookupsRefused(module: Lookups = dns): boolean {
  return REFUSES_HANDS_OFF in module.lookup && REFUSES_HANDS_OFF in module.promises.lookup;
}
