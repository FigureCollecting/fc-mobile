import dns from 'node:dns';
import { isDeepStrictEqual, types as valueTypes } from 'node:util';
import vm from 'node:vm';
import type { APIRequestContext, BrowserContext, Request } from '@playwright/test';

/**
 * Ross, 2026-09-29: no request ever goes to a site that bars AI agents by name.
 * The e2e suites stop one at each layer it could leave by, each tested in
 * e2e/hands-off.spec.ts against local sentinels:
 * - every fixture context (e2e/fixtures.ts, guardContext) aborts its pages'
 *   and workers' requests to these hosts, closes its pages' WebSockets to them
 *   and refuses its API requests to them, and fails its test on one that got
 *   past (a redirect hop);
 * - every Chromium project of the configs gets HANDS_OFF_LAUNCH_ARGS, frozen
 *   (a spec cannot push onto them or set one), so its resolver has no
 *   address for them (which also stops a redirect hop), and no arg or launch
 *   option beside them that takes them off or goes round them
 *   (configBypasses, against the rules built afresh);
 * - no worker starts with a proxy in its environment, a variable that sends
 *   a launch to a browser elsewhere (SELENIUM_REMOTE_URL among them), or a
 *   browser to connect to (refuseRoundTheRules), or with a name on
 *   Object.prototype, which then takes no new name while the worker runs
 *   (lockInheritedOptions);
 * - each launch in a worker (its own browser's and a spec's; on a browser
 *   type, through the prototype they share, or on a type's own launcher) is
 *   checked as it is called (refuseRoundTheRulesAtEachLaunch): the
 *   environment, Object.prototype, the options it starts from
 *   (refuseLaunchBypasses), and a Chromium's args, its own over the worker's
 *   (refuseLaunchArgs: the rules first, then nothing that undoes them);
 *   however the options were built. It starts with that environment and
 *   those args, copied, and the environment and Object.prototype are checked
 *   again as it resolves. Its browser refuses a session on the whole
 *   browser; connecting to a browser, Electron and Android are refused;
 * - each worker's Node DNS has none either (refuseHandsOffLookups);
 * - e2e/handsOffScan.ts reads every e2e source's syntax for a way off these
 *   guards (syntax only).
 * The README lists what none of these covers.
 * The app's CSP and the vite dev server's refuse requests to them before they
 * are sent, as the route guard does; a CSP does not stop a navigation. Neither
 * stops the connection: for an https frame or form post the CSP refuses, or a
 * popup the guard aborts, full Chromium still connects to the host and sends
 * it a TLS ClientHello naming it. The resolver rules stop that (both tested in
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

/** The launch options configBypasses reads (the args, a proxy, an env): any other one a config gives is flagged. */
const READ_LAUNCH_OPTIONS = new Set(['args', 'proxy', 'env']);

/** ignoreDefaultArgs as an array takes each arg it names off Chromium's command line, user args included: Playwright builds them all in defaultArgs. */
const IGNORES_ARGS = "can take the hands-off resolver rules off Chromium's command line";

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
 * on another browser that `others` (project name to its browser) does not
 * name. The rules are built afresh for the comparison, not read from
 * HANDS_OFF_LAUNCH_ARGS.
 * Then, where each is written: a proxy, connectOptions, context options with a
 * proxy, or launch options with anything but args: a proxy or an env of their
 * own, ignoreDefaultArgs, or an option the check does not read.
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
    for (const [key, value] of Object.entries(use?.launchOptions ?? {})) {
      if (value === undefined || READ_LAUNCH_OPTIONS.has(key)) continue;
      found.push(`${where}: launchOptions.${key} ${key === 'ignoreDefaultArgs' ? IGNORES_ARGS : 'is a launch option the hands-off check does not read: pass HANDS_OFF_LAUNCH_OPTIONS itself'}`);
    }
  }
  return found;
}

/** Where Chromium and Node read a proxy from in the environment, by name in any case (no_proxy only lists hosts to skip one for). */
const PROXY_VARIABLES = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'auto_proxy', 'socks_server', 'socks_proxy']);

/**
 * Where Playwright reads, at a launch, a browser to send it to instead (a
 * Selenium grid, its capabilities and headers; a browser server, its headers
 * and the network it may reach), or the test hook that lets a launch option
 * name a grid; by name in any case.
 */
const CONNECT_VARIABLES = new Set([
  'selenium_remote_url',
  'selenium_remote_capabilities',
  'selenium_remote_headers',
  'pw_test_connect_ws_endpoint',
  'pw_test_connect_headers',
  'pw_test_connect_expose_network',
  'pwtest_under_test',
]);

/**
 * Throws if this worker would run its browsers round the hands-off resolver
 * rules: a proxy in its environment (Chromium sends hosts to it unresolved; the
 * headless shell does even with --no-proxy-server), a variable that sends a
 * launch to a browser somewhere else (CONNECT_VARIABLES), or a browser to
 * connect to (connectOptions, which PW_TEST_CONNECT_WS_ENDPOINT sets): a
 * browser connected to has launch args of its own. Every reason, in one error.
 */
export function refuseRoundTheRules(env: Record<string, string | undefined>, connectOptions: unknown): void {
  const reasons = Object.entries(env)
    .filter(([, value]) => !!value)
    .flatMap(([name]) => {
      const key = name.toLowerCase();
      if (PROXY_VARIABLES.has(key)) return [`${name} in this worker's environment sends requests through a proxy, which looks the hands-off hosts up itself`];
      if (CONNECT_VARIABLES.has(key)) return [`${name} in this worker's environment can connect it to a browser with launch args of its own`];
      return [];
    });
  if (connectOptions !== undefined) reasons.push('connectOptions connects this worker to a browser with launch args of its own');
  if (reasons.length > 0) throw new Error(`hands-off: ${reasons.join('; ')}`);
}

/** Object.prototype's own names in a fresh realm: what Node puts there before any code runs. */
const NODE_PROTOTYPE = new Set(vm.runInNewContext('Object.getOwnPropertyNames(Object.prototype)') as string[]);

/**
 * Throws if Object.prototype carries a name Node does not put there: every
 * options object inherits it, and Playwright reads launch and context options
 * by name, inherited ones included (ignoreDefaultArgs there takes the resolver
 * rules off every browser launched after).
 */
export function refuseInheritedOptions(prototype: object = Object.prototype): void {
  const added = Object.getOwnPropertyNames(prototype).filter((name) => !NODE_PROTOTYPE.has(name));
  if (added.length > 0) {
    throw new Error(`hands-off: Object.prototype carries ${added.join(', ')}, which every options object inherits: Playwright would read each as an option of every launch or context`);
  }
}

/**
 * Runs refuseInheritedOptions on the prototype, then stops any name being
 * added to it for good (Object.preventExtensions, which nothing undoes):
 * Playwright reads an inherited launch or context option a few ticks after
 * the call, past any check made as it is called. Every e2e worker runs it as
 * it starts (e2e/fixtures.ts).
 */
export function lockInheritedOptions(prototype: object = Object.prototype): void {
  refuseInheritedOptions(prototype);
  Object.preventExtensions(prototype);
}

/** Launch options that take the resolver rules off Chromium or send it round them, whatever its args: each with why. */
const LAUNCH_BYPASSES = new Map([
  ['ignoreDefaultArgs', IGNORES_ARGS],
  ['executablePath', 'launches a browser binary that may leave out the args it is given'],
  ['proxy', 'sends requests through a proxy, which looks the hands-off hosts up itself'],
  ['env', "replaces the browser's environment, which can carry a proxy that goes round the hands-off resolver rules"],
]);
/** Playwright's own test hooks (__testHookSeleniumRemoteURL sends a launch to a Selenium grid). */
const TEST_HOOK = '__testHook';
/** Why an option under a getter or setter is refused, whatever its name. */
const UNREADABLE = 'is a getter or setter, which the hands-off check cannot read as the launch will';

/**
 * Environments a launch check read and handed its launch, frozen: the one its
 * browser starts with, which a launcher the launch hands its options on to
 * (launchServer's) takes as checked.
 */
const CHECKED_ENVIRONMENTS = new WeakSet<object>();

/**
 * Throws if the options a launch starts from (each of `sources`: the worker's
 * defaults, then the launch's own, which Playwright merges in that order)
 * carry a LAUNCH_BYPASSES option set to anything but undefined (an env a
 * launch check handed on excepted), or a Playwright test hook; or any option
 * under a getter or setter, which can answer this check one thing and the
 * launch another; or if one is a Proxy, which this check cannot read as
 * Playwright will. Every own property counts, enumerable or not. Every
 * reason, in one error.
 */
export function refuseLaunchBypasses(sources: readonly unknown[]): void {
  const reasons: string[] = [];
  for (const options of sources) {
    if (valueTypes.isProxy(options)) {
      reasons.push("this launch's options are a Proxy, which the hands-off check cannot read");
      continue;
    }
    for (const [name, property] of Object.entries(Object.getOwnPropertyDescriptors(Object(options)))) {
      const why = LAUNCH_BYPASSES.get(name) ?? (name.startsWith(TEST_HOOK) ? 'is a Playwright test hook, which can send the launch to a browser elsewhere' : undefined);
      if (!('value' in property)) reasons.push(`${name} in this launch's options ${why ?? UNREADABLE}`);
      else if (why !== undefined && property.value !== undefined && !(name === 'env' && CHECKED_ENVIRONMENTS.has(property.value as object))) {
        reasons.push(`${name} in this launch's options ${why}`);
      }
    }
  }
  if (reasons.length > 0) throw new Error(`hands-off: ${reasons.join('; ')}`);
}

/** The switch the hands-off rules ride on: a Chromium launch's one arg. */
const RULES_SWITCH = '--host-resolver-rules=';
/** A first rule that sends every host to this machine (a spec's sentinel), hands-off hosts included. */
const EVERY_HOST_TO_LOOPBACK = /^MAP \* 127\.0\.0\.1(?::\d+)?$/;
/** The whitespace Chromium trims off a rule and its parts: ASCII only. */
const ASCII_SPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;

/** A rule as Chromium reads it: split at each space, each part trimmed, empty parts dropped. */
function ruleParts(rule: string): string[] {
  return rule
    .split(' ')
    .map((part) => part.replace(ASCII_SPACE, ''))
    .filter((part) => part !== '');
}

/**
 * Whether a rule after the hands-off ones (or after every host to 127.0.0.1)
 * leaves every hands-off host where those put it: a MAP (the first MAP that
 * matches a host wins), or an EXCLUDE of one named host that is not hands-off
 * (an EXCLUDE that matches a host takes it off every MAP, those first).
 */
function keepsTheRules(rule: string): boolean {
  const [kind = '', pattern = '', ...rest] = ruleParts(rule);
  if (kind.toLowerCase() === 'map') return rest.length === 1;
  return kind.toLowerCase() === 'exclude' && pattern !== '' && rest.length === 0 && !/[*?\\]/.test(pattern) && !isHandsOffHost(pattern);
}

/**
 * Throws unless a Chromium launch's args (the worker's, or the launch's own
 * over them, as Playwright merges them) are one --host-resolver-rules switch
 * whose list starts with the hands-off rules (built afresh), or sends every
 * host to 127.0.0.1 first (a spec's sentinel), and goes on only with rules
 * that keep every hands-off host where those put it. Any other arg is
 * refused, whatever it is: Chromium has switches enough that open another
 * way out (a proxy, a debugging port).
 */
export function refuseLaunchArgs(args: unknown): void {
  const refused = (why: string) => new Error(`hands-off: this Chromium launch's args ${why}`);
  if (args === undefined || (Array.isArray(args) && args.length === 0)) throw refused('leave out the hands-off resolver rules');
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) throw refused('are not an array of strings, which the hands-off check cannot read');
  const other = (args as string[]).find((arg, i) => i > 0 || !arg.startsWith(RULES_SWITCH));
  if (other !== undefined) throw refused(`hold ${JSON.stringify(other)}: a Chromium launch's args are one --host-resolver-rules switch and nothing else`);
  const list = (args[0] as string).slice(RULES_SWITCH.length);
  const rules = handsOffResolverRules();
  let after: string[];
  if (list === rules) after = [];
  else if (list.startsWith(`${rules},`)) after = list.slice(rules.length + 1).split(',');
  else if (EVERY_HOST_TO_LOOPBACK.test(list.split(',')[0]!)) after = list.split(',').slice(1);
  else throw refused('do not start with the hands-off rules, or send every host to 127.0.0.1 first');
  const loose = after.find((rule) => !keepsTheRules(rule));
  if (loose !== undefined) {
    throw refused(
      `hold the rule ${JSON.stringify(loose.replace(ASCII_SPACE, ''))}, which could take a hands-off host off them: after the hands-off rules, or every host to 127.0.0.1, only MAP rules and EXCLUDE of a named host that is not hands-off may follow`,
    );
  }
}

/** The browser-type members that start a browser, by the index of their options: each is checked first. */
const LAUNCHERS = new Map([
  ['launch', 0],
  ['launchPersistentContext', 1],
  ['launchServer', 0],
]);
/** The browser-type members that connect to a browser already running, with launch args of its own (two private ones among them): each is refused. */
const CONNECTORS = ['connect', 'connectOverCDP', '_connect', '_connectToWorker'];
/** Playwright's experimental Electron and Android, and what each opens a browser with: neither browser gets the resolver rules, so each is refused. */
const OTHER_OPENERS = [
  ['_electron', ['launch']],
  ['_android', ['connect', 'devices', 'launchServer']],
] as const;
/**
 * Members of a browser that open a session on the whole browser, from which a
 * context with a proxy of its own (CDP's Target.createBrowserContext) goes
 * round the resolver rules and every guard: each refused.
 */
const BROWSER_SESSIONS = ['newBrowserCDPSession'];
const CHECKS_EACH_LAUNCH = Symbol.for('fc-mobile.e2e.checksEachLaunch');

/** What a launch gives back: a browser, a persistent context (with its browser), or a browser server; each closes. */
type Launched = { close?: () => unknown; browser?: () => unknown } | null | undefined;

/**
 * What a launch will read at `name` on `object` (or what it inherits there):
 * refused if a getter or setter, which can answer this check one thing and
 * the launch another, or if held in a Proxy, which this check cannot read as
 * the launch will.
 */
function readAsLaunched(object: unknown, name: string): unknown {
  for (let at = object; at !== null && (typeof at === 'object' || typeof at === 'function'); at = Object.getPrototypeOf(at)) {
    if (valueTypes.isProxy(at)) throw new Error("hands-off: this launch's defaults are held in a Proxy, which the hands-off check cannot read");
    const property = Object.getOwnPropertyDescriptor(at, name);
    if (property === undefined) continue;
    if (!('value' in property)) throw new Error(`hands-off: ${name} ${UNREADABLE}`);
    return property.value;
  }
  return undefined;
}

/**
 * Replaces the member `name` where `object` takes it from (itself, or a
 * prototype it may share with others), so a call through that prototype is
 * replaced too; once (a member this file put there is left), and only where
 * there is one to replace.
 */
function replaceMember(object: object, name: string, make: (original: (...args: unknown[]) => Promise<unknown>) => (...args: unknown[]) => Promise<unknown>): void {
  for (let owner: object | null = object; owner !== null; owner = Object.getPrototypeOf(owner) as object | null) {
    if (!Object.hasOwn(owner, name)) continue;
    const members = owner as Record<string, (...args: unknown[]) => Promise<unknown>>;
    if (!(CHECKS_EACH_LAUNCH in members[name]!)) members[name] = Object.assign(make(members[name]!), { [CHECKS_EACH_LAUNCH]: true });
    return;
  }
}

/** A member that throws as it is called, never calling what it replaced. */
const refusing = (what: string) => () => async () => {
  throw new Error(`hands-off: ${what}`);
};

/**
 * Refuses the BROWSER_SESSIONS on the browser a launch gave back (a
 * persistent context's own), where its class keeps them: so on every browser
 * of that class.
 */
function refuseBrowserSessions(launched: Launched): void {
  const browser = typeof launched?.browser === 'function' ? launched.browser() : launched;
  for (const name of BROWSER_SESSIONS) {
    replaceMember(Object(browser), name, refusing(`${name} opens a session on the whole browser, which can make a context with a proxy of its own that goes round the hands-off resolver rules`));
  }
}

/**
 * Makes every launch on these browser types (the worker's own browser's
 * included: Playwright's browser fixture launches through them), wherever it
 * is taken from, and on each one's own launcher (_serverLauncher, which
 * launchServer hands on to), check as it is called: refuseRoundTheRules on the
 * environment as it is then, refuseInheritedOptions, refuseLaunchBypasses on
 * the options it starts from (the worker's defaults, read as the launch will,
 * and its own), and for a Chromium launch (anything not Firefox's or
 * WebKit's) refuseLaunchArgs on its args, its own over the worker's. The
 * launch is handed a copy of its options with that environment, frozen, and a
 * frozen copy of those args: what was checked is what it starts with, however
 * either changes after the call. As the launch resolves, the environment and
 * Object.prototype are checked again (Playwright reads both a few ticks after
 * the call): on a refusal, what it launched is closed. The browser it gives
 * back refuses BROWSER_SESSIONS. Refuses outright the members that connect to
 * a browser (CONNECTORS), Playwright's Electron and Android openers
 * (OTHER_OPENERS) and Android's own launcher. Installs each once.
 */
export function refuseRoundTheRulesAtEachLaunch(
  types: { chromium: object; firefox: object; webkit: object; _electron?: object; _android?: object },
  connectOptions: unknown,
  env: () => Record<string, string | undefined> = () => process.env,
): void {
  const launcherOf = (type: object | undefined): unknown => (type as { _serverLauncher?: unknown } | undefined)?._serverLauncher;
  /** What launches a browser with no resolver rules to keep: Firefox and WebKit, and their launchers. Anything else is read as Chromium. */
  const ruleless = new Set<unknown>([types.firefox, types.webkit, launcherOf(types.firefox), launcherOf(types.webkit)].filter((owner) => owner !== undefined));
  const checking = (at: number) => (start: (...args: unknown[]) => Promise<unknown>) =>
    async function (this: unknown, ...args: unknown[]) {
      const environment = Object.freeze({ ...env() });
      refuseRoundTheRules(environment, connectOptions);
      refuseInheritedOptions();
      // hands-off-scan: reads the options every launch in this worker starts from, as the launch will, to refuse what they carry.
      const defaults = readAsLaunched(readAsLaunched(this, '_playwright'), '_defaultLaunchOptions');
      const own = args[at];
      refuseLaunchBypasses([defaults, own]);
      const options: Record<string, unknown> = { ...Object(own), env: environment };
      if (!ruleless.has(this)) {
        const merged: unknown = { ...Object(defaults), ...Object(own) }.args;
        options.args = Array.isArray(merged) ? Object.freeze([...merged]) : merged;
        refuseLaunchArgs(options.args);
      }
      CHECKED_ENVIRONMENTS.add(environment);
      const handed = [...args];
      handed[at] = options;
      const launched = (await start.apply(this, handed)) as Launched;
      try {
        refuseRoundTheRules(env(), connectOptions);
        refuseInheritedOptions();
      } catch (error) {
        try {
          await launched?.close?.();
        } catch {
          // The refusal is what the caller sees.
        }
        throw error;
      }
      refuseBrowserSessions(launched);
      return launched;
    };
  for (const type of [types.chromium, types.firefox, types.webkit]) {
    for (const [name, at] of LAUNCHERS) replaceMember(type, name, checking(at));
    replaceMember(Object(launcherOf(type)), 'launchServer', checking(0));
    for (const name of CONNECTORS) replaceMember(type, name, refusing(`${name} connects this worker to a browser with launch args of its own`));
  }
  for (const [key, names] of OTHER_OPENERS) {
    for (const name of names) replaceMember(Object(types[key]), name, refusing(`${key}.${name} opens a browser the hands-off resolver rules are not on`));
    replaceMember(Object(launcherOf(types[key])), 'launchServer', refusing(`${key}._serverLauncher.launchServer opens a browser the hands-off resolver rules are not on`));
  }
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
  refuseInheritedOptions();
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
