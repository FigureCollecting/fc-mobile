import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { devices } from '@playwright/test';
import ts from 'typescript';
import { goesRoundTheRules } from './handsOff';

export interface Source {
  /** Relative to the e2e directory, with forward slashes. */
  file: string;
  code: string;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Every JS and TS source file under `root` (specs, helpers and unit tests alike), outside node_modules. */
export function e2eSources(root: string): Source[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => SOURCE_FILE.test(f) && !f.split(path.sep).includes('node_modules'))
    .sort()
    .map((f) => ({ file: f.split(path.sep).join('/'), code: readFileSync(path.join(root, f), 'utf8') }));
}

/** Playwright, by package name or by a path into its package under node_modules. */
const PLAYWRIGHT = /^(?:@playwright\/test|playwright|playwright-core)(?:\/.*)?$|(?:^|\/)node_modules\/(?:@playwright\/test|playwright(?:-core)?)(?:\/|$)/;
/** Values a spec may take from Playwright itself: none of them opens a browser, a context or a request. */
const HARMLESS = new Set(['expect', 'devices', 'defineConfig']);
/** What every Chromium's args must hold: this identifier, as the args or spread into them among plain switches. */
const LAUNCH_ARGS = 'HANDS_OFF_LAUNCH_ARGS';
const CONTEXT_GUARDS = new Set(['blockHandsOff', 'guardContext']);
const API_GUARDS = new Set(['refuseHandsOffRequests']);
/** Browser launchers whose args the scan reads, by the index of their options argument. */
const LAUNCH_OPTIONS_AT = new Map([
  ['launch', 0],
  ['launchPersistentContext', 1],
]);
/** Ways to a browser whose launch args the scan cannot read (and `connect` on a browser type). */
const UNREADABLE_BROWSERS = new Set(['launchServer', 'connectOverCDP']);
const BROWSER_TYPES = new Set(['chromium', 'firefox', 'webkit']);
const EXPERIMENTAL_BROWSERS = new Set(['_android', '_electron']);
/**
 * Playwright's private holds on the launch options the worker's browser, and
 * every launch in the worker, start from: the playwright object's
 * _defaultLaunchOptions, and the _browserOptions worker fixture that sets it.
 * A pattern, not strings, so that this file names neither.
 */
const PRIVATE_HOLDS = /^_(?:defaultLaunchOptions|browserOptions)$/;
const DEFAULTS_TAKEN = 'takes the launch options every browser in the worker starts from, a private API the scan cannot check';
/** Launch options that take args off Chromium's command line, user args included (Playwright builds them all in defaultArgs). */
const IGNORE_DEFAULT_ARGS = 'ignoreDefaultArgs';
const IGNORES_ARGS = "can take the hands-off resolver rules off Chromium's command line";
/** Calls whose first argument, an object literal, overrides fixtures (test.extend, test.use). */
const FIXTURE_CALLS = new Set(['extend', 'use']);
/** Members that open a context or a page: the scan follows them only when called. */
const OPENERS = new Set(['newContext', 'newPage']);
/** Route calls that send the request on. Routes run newest first, so a spec's own route runs ahead of the guard's. */
const SENDS_ON = new Set(['continue', 'connectToServer']);
/** Route calls that remove routes: on a context, the hands-off guard's too. A page's routes are its own. */
const UNROUTES = new Set(['unroute', 'unrouteAll']);
/** The files whose `hands-off-scan:` notes count: the spec whose browsers all end at a local sentinel, and the guard itself. */
const NOTE_FILES = new Set(['hands-off.spec.ts', 'handsOff.ts']);
/** Playwright objects by the names its fixtures give them: a member of one taken by a name the scan cannot read is flagged. */
const PLAYWRIGHT_OBJECTS = new Set(['playwright', 'browser', 'page', 'request']);
const NOTE = 'hands-off-scan:';

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function playwrightModule(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) && PLAYWRIGHT.test(node.text) ? node.text : undefined;
}

/** The expression under any `await` and parentheses. */
function unwrapped(node: ts.Expression): ts.Expression {
  let out = node;
  while (ts.isAwaitExpression(out) || ts.isParenthesizedExpression(out)) out = out.expression;
  return out;
}

/** The call, `await` and parentheses around `node` stripped from the outside in: the node its value lands in. */
function landing(node: ts.Node): ts.Node {
  let out = node;
  while (ts.isAwaitExpression(out.parent) || ts.isParenthesizedExpression(out.parent)) out = out.parent;
  return out;
}

function isGuardCall(node: ts.Node, guards: Set<string>): node is ts.CallExpression & { expression: ts.Identifier } {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && guards.has(node.expression.text);
}

/** A property's name as written (an identifier, a string, a computed string); undefined for any other computed name. */
function keyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) return ts.isStringLiteralLike(name.expression) ? name.expression.text : undefined;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/** `receiver.name` or `receiver['name']`. */
function member(node: ts.Node): { name: string; receiver: ts.Expression } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { name: node.name.text, receiver: node.expression };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return { name: node.argumentExpression.text, receiver: node.expression };
  }
  return undefined;
}

/** Which browser type this is (chromium, firefox or webkit, by name or as a member: playwright.chromium), if one. */
function browserType(node: ts.Expression): string | undefined {
  const r = unwrapped(node);
  const name = ts.isIdentifier(r) ? r.text : member(r)?.name;
  return name !== undefined && BROWSER_TYPES.has(name) ? name : undefined;
}

/** Whether `receiver.name` opens a browser whose launch args the scan cannot read. */
function opensUnreadable(name: string, receiver: ts.Expression): boolean {
  return UNREADABLE_BROWSERS.has(name) || (name === 'connect' && browserType(receiver) !== undefined);
}

/**
 * Launch args that keep the hands-off resolver rules in force, leave them out,
 * or hold one that could replace them or go round them; or launch options that
 * keep them but that the scan cannot read in full (a spread, a computed name).
 */
type Rules = 'kept' | 'missing' | 'overridden' | 'unread';

/**
 * HANDS_OFF_LAUNCH_ARGS itself, or an array that spreads it among string
 * literals none of which goes round its rules, keeps them; an array that
 * spreads it beside any other element (a value the scan cannot read) does not.
 */
function argsRules(args: ts.Expression): Rules {
  if (ts.isIdentifier(args)) return args.text === LAUNCH_ARGS ? 'kept' : 'missing';
  if (!ts.isArrayLiteralExpression(args)) return 'missing';
  const spreadsRules = (e: ts.Expression) => ts.isSpreadElement(e) && ts.isIdentifier(e.expression) && e.expression.text === LAUNCH_ARGS;
  if (!args.elements.some(spreadsRules)) return 'missing';
  return args.elements.every((e) => spreadsRules(e) || (ts.isStringLiteralLike(e) && !goesRoundTheRules(e.text))) ? 'kept' : 'overridden';
}

/**
 * What launch options' last args do to the rules: no spread or computed name
 * after them may replace them, and none before them may be there at all (it
 * could carry ignoreDefaultArgs, executablePath, an env or a proxy).
 */
function launchRules(options: ts.Expression | undefined): Rules {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return 'missing';
  let rules: Rules = 'missing';
  let unread = false;
  for (const p of options.properties) {
    const key = ts.isSpreadAssignment(p) ? undefined : keyName(p.name);
    if (key === undefined) unread = true;
    if (key === undefined || key === 'args') rules = key === 'args' && ts.isPropertyAssignment(p) ? argsRules(p.initializer) : 'missing';
  }
  return rules === 'kept' && unread ? 'unread' : rules;
}

/** The expression an object literal is written as: out through `as`, `satisfies`, `!`, a type assertion and parentheses. */
function writtenAs(node: ts.Expression): ts.Expression {
  let out = node;
  while (
    ts.isAsExpression(out.parent) ||
    ts.isSatisfiesExpression(out.parent) ||
    ts.isNonNullExpression(out.parent) ||
    ts.isTypeAssertionExpression(out.parent) ||
    ts.isParenthesizedExpression(out.parent)
  ) {
    out = out.parent;
  }
  return out;
}

/** Whether this object literal is launch options: an argument of a launcher, or the value of launchOptions. */
function isLaunchOptions(object: ts.Node): boolean {
  const up = object.parent;
  if (ts.isPropertyAssignment(up)) return keyName(up.name) === 'launchOptions';
  return ts.isCallExpression(up) && LAUNCH_OPTIONS_AT.has(member(up.expression)?.name ?? '');
}

/** An identifier that names something rather than reading a variable: `x.name`, `{ name: v }`, `{ name: n } = x`. */
function isMemberName(node: ts.Identifier): boolean {
  const p = node.parent;
  return (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node) || (ts.isBindingElement(p) && p.propertyName === node);
}

/** The first read of `name` in these nodes, in source order. */
function firstUse(nodes: readonly ts.Node[], name: string): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const look = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === name && !isMemberName(node)) {
      found = node;
      return true;
    }
    return ts.forEachChild(node, look) ?? false;
  };
  nodes.some(look);
  return found;
}

/**
 * Whether `node` runs whenever the statement in `list` it sits in runs: nothing
 * between them but awaits, parentheses, declarations, blocks, and a try's own
 * block (not its catch or finally). A block under an if, a loop or a function
 * stops at that statement.
 */
function onEveryPath(node: ts.Node, list: readonly ts.Node[]): boolean {
  for (let at = node; !list.includes(at); at = at.parent) {
    const up = at.parent;
    const plain =
      ts.isAwaitExpression(up) ||
      ts.isParenthesizedExpression(up) ||
      ts.isExpressionStatement(up) ||
      ts.isVariableDeclaration(up) ||
      ts.isVariableDeclarationList(up) ||
      ts.isVariableStatement(up) ||
      ts.isBlock(up) ||
      (ts.isTryStatement(up) && up.tryBlock === at);
    if (!plain) return false;
  }
  return true;
}

function isAwaited(node: ts.Node): boolean {
  let up = node.parent;
  while (ts.isParenthesizedExpression(up)) up = up.parent;
  return ts.isAwaitExpression(up);
}

/**
 * What keeps one e2e source file off the hands-off guard (e2e/handsOff.ts), as
 * `file:line: what`. Read from the syntax tree:
 * - test, a browser type or `request` taken from Playwright (by import, export,
 *   require, any call given its module name, or a path into node_modules)
 *   instead of from e2e/fixtures.ts, whose contexts are guarded;
 * - a launch whose args are not HANDS_OFF_LAUNCH_ARGS, or a spread of it among
 *   string literals none of which is another rule list, a proxy switch or `--`
 *   (goesRoundTheRules), or that a later spread or computed name could replace;
 *   launchOptions that do the same; an env in launch options (a proxy rides in
 *   it); a launcher, newContext or newPage taken without being called,
 *   launchServer, connect, connectOverCDP and _android / _electron;
 *   _defaultLaunchOptions or _browserOptions, where the worker's browser and
 *   every launch in the worker take their options from, named anywhere (an
 *   identifier or a string); a fixture test.extend or test.use overrides that
 *   is private (named with a leading underscore) or named by a computed key it
 *   cannot read; ignoreDefaultArgs as a key in any object or a member, before
 *   or after the args; executablePath as a key in any object;
 * - browserName or defaultBrowserType other than 'chromium', a devices[...]
 *   spread that is not a Chromium device, a firefox or webkit launch, proxy and
 *   connectOptions: each leaves the resolver rules behind;
 * - each context, browser page or API request context the file opens that a
 *   guard does not take before anything else uses it, on every path (not under
 *   a condition, a loop or a callback), blockHandsOff awaited;
 * - a route that sends the request on (continue, connectToServer, fallback with
 *   changes, routeFromHAR), fetches it itself, or has a handler the scan cannot
 *   read: routes run newest first, so it would run ahead of the guard's;
 * - unroute or unrouteAll on anything but `page`: on a context, either can take
 *   the guard's routes off;
 * - a member taken by a computed name it cannot read: of a browser type, a
 *   context, `playwright`, `browser`, `page` or `request`, or in a destructuring.
 * A `hands-off-scan:` comment on a statement exempts it in hands-off.spec.ts
 * and handsOff.ts only.
 */
export function unguardedSites({ file, code }: Source): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found: string[] = [];
  const takesTest = file === 'fixtures.ts';

  /** Every identifier the file hands to a context guard: a context known to be guarded. */
  const guardedNames = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (isGuardCall(node, CONTEXT_GUARDS) && node.arguments[0] !== undefined && ts.isIdentifier(node.arguments[0])) {
      guardedNames.add(node.arguments[0].text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /** A note in a comment on the statement (one of a block's, not an if's body) that holds `node`. */
  const noted = (node: ts.Node): boolean => {
    if (!NOTE_FILES.has(file)) return false;
    for (let at: ts.Node | undefined = node; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
      const comments = ts.getLeadingCommentRanges(code, at.getFullStart()) ?? [];
      if (comments.some((c) => code.slice(c.pos, c.end).includes(NOTE))) return true;
      if (ts.isStatement(at) && 'statements' in at.parent) return false;
    }
    return false;
  };

  const flag = (node: ts.Node, what: string): void => {
    if (noted(node)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${what}`);
  };

  /**
   * Whether the value of `call` (a context, a browser's page, an API context) is
   * guarded before anything else uses it: handed straight to a guard, or held in
   * a name whose first use after it, in its statement list, is a guard's first
   * argument (a page's: page.context()), on every path, blockHandsOff awaited.
   */
  const guardedAtCall = (call: ts.CallExpression, guards: Set<string>, ofPage = false): boolean => {
    const value = landing(call);
    if (isGuardCall(value.parent, guards) && value.parent.arguments[0] === value) return true;
    const declaration = value.parent;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
    const { parent: declarationList } = declaration;
    // Not a for header's: the statements after a loop are not in its scope.
    if (!ts.isVariableDeclarationList(declarationList) || !ts.isVariableStatement(declarationList.parent)) return false;
    const statement = declarationList.parent;
    // A block, the file, or a switch case: whatever holds the statement and the ones after it.
    const list = (statement.parent as Partial<Pick<ts.Block, 'statements'>>).statements;
    if (list === undefined) return false;
    const { declarations } = declarationList;
    const after = [...declarations.slice(declarations.indexOf(declaration) + 1), ...list.slice(list.indexOf(statement) + 1)];
    let use: ts.Expression | undefined = firstUse(after, declaration.name.text);
    if (use !== undefined && ofPage) {
      const access = use.parent;
      const isContextCall = ts.isPropertyAccessExpression(access) && access.name.text === 'context' && ts.isCallExpression(access.parent) && access.parent.expression === access;
      use = isContextCall ? access.parent : undefined;
    }
    const guard = use?.parent;
    return (
      guard !== undefined &&
      isGuardCall(guard, guards) &&
      guard.arguments[0] === use &&
      onEveryPath(guard, list) &&
      (guard.expression.text !== 'blockHandsOff' || isAwaited(guard))
    );
  };

  /** A page's context, a context the file guards, or `context` (the fixture's, or a helper's parameter it is passed to). */
  const isContext = (receiver: ts.Expression): boolean => {
    const r = unwrapped(receiver);
    if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === 'context') return true;
    return ts.isIdentifier(r) && (r.text === 'context' || guardedNames.has(r.text));
  };

  /** Whether `receiver` is the first parameter of a handler given to `.route(url, handler)`. */
  const isRouteParameter = (receiver: ts.Expression): boolean => {
    if (!ts.isIdentifier(receiver)) return false;
    for (let at: ts.Node = receiver; !ts.isSourceFile(at); at = at.parent) {
      if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) {
        const param = at.parameters[0]?.name;
        if (param !== undefined && ts.isIdentifier(param) && param.text === receiver.text) {
          const route = at.parent;
          return ts.isCallExpression(route) && member(route.expression)?.name === 'route';
        }
      }
    }
    return false;
  };

  const visitCall = (node: ts.CallExpression): void => {
    const module = playwrightModule(node.arguments[0]);
    if (module !== undefined) {
      if (!takesTest) flag(node, node.expression.kind === ts.SyntaxKind.ImportKeyword ? `imports ${module} at run time` : `requires ${module}`);
      return;
    }
    const m = member(node.expression);
    if (m === undefined) return;
    const { name, receiver } = m;
    const callee = node.expression.getText(source);
    const optionsAt = LAUNCH_OPTIONS_AT.get(name);
    const rules = optionsAt === undefined ? 'kept' : launchRules(node.arguments[optionsAt]);
    if (rules === 'missing') flag(node, `${callee}() launches without the hands-off resolver rules`);
    if (rules === 'overridden') flag(node, `${callee}() launches with an arg that replaces or goes round the hands-off resolver rules, or one the scan cannot read`);
    if (rules === 'unread') flag(node, `${callee}() launches with options spread in or under a computed name, which the scan cannot read`);
    // Firefox and WebKit ignore --host-resolver-rules, given or not.
    if (optionsAt !== undefined && (browserType(receiver) ?? 'chromium') !== 'chromium') {
      flag(node, `${callee}() launches a browser other than chromium, which has no hands-off resolver rules`);
    }
    if (opensUnreadable(name, receiver)) flag(node, `${callee}() opens a browser the scan cannot check`);
    if (name === 'newContext' && /\brequest$/.test(receiver.getText(source))) {
      if (!guardedAtCall(node, API_GUARDS)) flag(node, `${callee}() opens an API request context that no refuseHandsOffRequests guards`);
    } else if (name === 'newContext' || name === 'launchPersistentContext') {
      if (!guardedAtCall(node, CONTEXT_GUARDS)) flag(node, `${callee}() opens a context that no blockHandsOff guards`);
    } else if (name === 'newPage' && !isContext(receiver)) {
      if (!guardedAtCall(node, CONTEXT_GUARDS, true)) flag(node, `${callee}() opens a page in a context of its own that no blockHandsOff guards`);
    }
    if (SENDS_ON.has(name)) flag(node, `${callee}() sends a routed request on, ahead of the hands-off guard`);
    if (name === 'fallback' && node.arguments.length > 0) flag(node, `${callee}() sends a routed request on with changes, ahead of the hands-off guard`);
    if (name === 'routeFromHAR') flag(node, `${callee}() can send requests on, ahead of the hands-off guard`);
    if (UNROUTES.has(name) && !(ts.isIdentifier(receiver) && receiver.text === 'page')) flag(node, `${callee}() can take the hands-off route guard off a context`);
    if (name === 'fetch' && isRouteParameter(receiver)) flag(node, `${callee}() fetches a routed request itself, outside the hands-off guards`);
    const handler = node.arguments[1];
    if ((name === 'route' || name === 'routeWebSocket') && handler !== undefined && !ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
      flag(node, `${callee}() takes a handler the scan cannot read`);
    }
  };

  /** A browser type, a context, or a Playwright object by its fixture's name. */
  const isPlaywrightObject = (receiver: ts.Expression): boolean => {
    const r = unwrapped(receiver);
    return browserType(r) !== undefined || isContext(r) || (ts.isIdentifier(r) && PLAYWRIGHT_OBJECTS.has(r.text));
  };

  /**
   * A launcher, newContext or newPage named but not called here; _android and
   * _electron anywhere; a member of a Playwright object by a computed name.
   */
  const visitMember = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): void => {
    const m = member(node);
    if (m === undefined) {
      if (isPlaywrightObject(node.expression)) flag(node, `${node.getText(source)} takes a member by a name the scan cannot read`);
      return;
    }
    if (EXPERIMENTAL_BROWSERS.has(m.name)) {
      flag(node, `${node.getText(source)} opens a browser the scan cannot check`);
      return;
    }
    if (m.name === IGNORE_DEFAULT_ARGS) flag(node, `${node.getText(source)} ${IGNORES_ARGS}`);
    const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
    if (!called && (LAUNCH_OPTIONS_AT.has(m.name) || opensUnreadable(m.name, m.receiver) || OPENERS.has(m.name))) {
      flag(node, `${node.getText(source)} is taken, not called, so the scan cannot check what it opens`);
    }
  };

  const visitBinding = (node: ts.BindingElement): void => {
    const key = node.propertyName !== undefined ? keyName(node.propertyName) : ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (key === undefined) {
      // A pattern with no name of its own (`[{ a }] = x`) is read through its elements; a computed name cannot be read.
      if (node.propertyName !== undefined) flag(node, `${node.getText(source)} takes a member by a name the scan cannot read`);
      return;
    }
    if (EXPERIMENTAL_BROWSERS.has(key)) flag(node, `${key} opens a browser the scan cannot check`);
    else if (LAUNCH_OPTIONS_AT.has(key) || UNREADABLE_BROWSERS.has(key) || OPENERS.has(key)) {
      flag(node, `${key} is taken, not called, so the scan cannot check what it opens`);
    }
  };

  /** A private hold named anywhere, by an identifier or a string: with its receiver when it names a member. */
  const visitName = (node: ts.Identifier | ts.StringLiteralLike): void => {
    if (!PRIVATE_HOLDS.test(node.text)) return;
    const up = node.parent;
    const written = (ts.isPropertyAccessExpression(up) && up.name === node) || (ts.isElementAccessExpression(up) && up.argumentExpression === node) ? up : node;
    flag(written, `${written.getText(source)} ${DEFAULTS_TAKEN}`);
  };

  /** An option in any object literal (test.use, a fixture, launch or context options), or a class's member of that name. */
  const visitOption = (node: ts.ObjectLiteralElementLike | (ts.ClassElement & { name: ts.PropertyName })): void => {
    if (ts.isSpreadAssignment(node)) {
      const spread = unwrapped(node.expression);
      const device = ts.isElementAccessExpression(spread) || ts.isPropertyAccessExpression(spread) ? spread : undefined;
      if (device !== undefined && ts.isIdentifier(device.expression) && device.expression.text === 'devices') {
        if (devices[member(device)?.name ?? '']?.defaultBrowserType !== 'chromium') {
          flag(node, `${node.getText(source)} may pick a browser other than chromium, which has no hands-off resolver rules`);
        }
      }
      return;
    }
    const written = ts.isObjectLiteralExpression(node.parent) ? writtenAs(node.parent) : undefined;
    const call = written?.parent;
    if (call !== undefined && ts.isCallExpression(call) && call.arguments[0] === written && FIXTURE_CALLS.has(member(call.expression)?.name ?? '')) {
      const fixture = keyName(node.name);
      if (fixture === undefined) flag(node, `${node.name.getText(source)} overrides a fixture by a name the scan cannot read`);
      else if (fixture.startsWith('_') && !PRIVATE_HOLDS.test(fixture)) flag(node, `${fixture} overrides a private Playwright fixture, which the scan cannot check`);
    }
    const value = ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) ? node.initializer : undefined;
    switch (keyName(node.name)) {
      case 'launchOptions': {
        const rules = launchRules(value);
        if (rules === 'missing') flag(node, "launchOptions replaces the project's launch args and its hands-off resolver rules");
        if (rules === 'overridden') flag(node, 'launchOptions carries an arg that replaces or goes round the hands-off resolver rules, or one the scan cannot read');
        if (rules === 'unread') flag(node, 'launchOptions holds options spread in or under a computed name, which the scan cannot read');
        break;
      }
      case 'env':
        if (isLaunchOptions(node.parent)) flag(node, "env replaces the browser's environment, which can carry a proxy that goes round the hands-off resolver rules");
        break;
      case 'browserName':
      case 'defaultBrowserType':
        if (value === undefined || !ts.isStringLiteralLike(value) || value.text !== 'chromium') {
          // A class field's text ends at its semicolon.
          flag(node, `${node.getText(source).replace(/;$/, '')} may pick a browser other than chromium, which has no hands-off resolver rules`);
        }
        break;
      case 'proxy':
        flag(node, 'proxy sends requests through a proxy, which looks the hands-off hosts up itself');
        break;
      case IGNORE_DEFAULT_ARGS:
        flag(node, `${IGNORE_DEFAULT_ARGS} ${IGNORES_ARGS}`);
        break;
      case 'executablePath':
        flag(node, 'executablePath launches a browser binary the scan cannot check, which may leave out the args it is given');
        break;
      case 'connectOptions':
        flag(node, 'connectOptions opens a browser the scan cannot check');
        break;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const module = playwrightModule(node.moduleSpecifier);
      const clause = node.importClause;
      if (!takesTest && module !== undefined && clause !== undefined && !clause.isTypeOnly) {
        if (clause.name !== undefined) flag(node, `imports the default export of ${module}`);
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) flag(node, `imports all of ${module}`);
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (!element.isTypeOnly && !HARMLESS.has(imported)) flag(node, `imports ${imported} from ${module}`);
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const module = playwrightModule(node.moduleSpecifier);
      if (module !== undefined) flag(node, `re-exports ${module}`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const module = playwrightModule(node.moduleReference.expression);
      if (module !== undefined) flag(node, `requires ${module}`);
    } else if (ts.isCallExpression(node)) {
      visitCall(node);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      visitMember(node);
    } else if (ts.isBindingElement(node)) {
      visitBinding(node);
    } else if (ts.isObjectLiteralElementLike(node) && ts.isObjectLiteralExpression(node.parent)) {
      visitOption(node);
    } else if (ts.isClassElement(node) && node.name !== undefined) {
      visitOption(node as ts.ClassElement & { name: ts.PropertyName });
    } else if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      visitName(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
