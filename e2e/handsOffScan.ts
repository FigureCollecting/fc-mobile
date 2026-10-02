import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

const PLAYWRIGHT = /^(?:@playwright\/test|playwright|playwright-core)(?:\/.*)?$/;
/** Values a spec may take from Playwright itself: none of them opens a browser, a context or a request. */
const HARMLESS = new Set(['expect', 'devices', 'defineConfig']);
const RESOLVER_RULES = /\b(?:HANDS_OFF_LAUNCH_ARGS|handsOffResolverRules)\b/;
const CONTEXT_GUARDS = new Set(['blockHandsOff', 'guardContext']);
const API_GUARDS = new Set(['refuseHandsOffRequests']);
/** The one file whose browsers all end at a local sentinel, so it may open unguarded ones on purpose. */
const NOTE_FILE = 'hands-off.spec.ts';
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

function isGuardCall(node: ts.Node, guards: Set<string>): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && guards.has(node.expression.text);
}

function hasResolverRules(options: ts.Expression | undefined): boolean {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'args' && RESOLVER_RULES.test(p.initializer.getText()),
  );
}

/**
 * What keeps one e2e source file off the hands-off guard (e2e/handsOff.ts), as
 * `file:line: what`: taking test, a browser type or `request` from Playwright
 * instead of e2e/fixtures.ts (whose contexts are guarded), a launch without the
 * hands-off resolver rules, launchOptions that replace the project's, and each
 * context, browser page or API request context the file opens itself that no
 * guard covers at that call. In hands-off.spec.ts a `hands-off-scan:` comment
 * on the statement exempts it.
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

  const noted = (node: ts.Node): boolean => {
    if (file !== NOTE_FILE) return false;
    for (let at: ts.Node | undefined = node; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
      const comments = ts.getLeadingCommentRanges(code, at.getFullStart()) ?? [];
      if (comments.some((c) => code.slice(c.pos, c.end).includes(NOTE))) return true;
      if (ts.isStatement(at)) return false;
    }
    return false;
  };

  const flag = (node: ts.Node, what: string): void => {
    if (noted(node)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${what}`);
  };

  /** Whether the value of `call` (a context, page or API context) reaches `guards` there or later in its block. */
  const guardedAtCall = (call: ts.CallExpression, guards: Set<string>, ofContext: boolean): boolean => {
    const value = landing(call);
    if (isGuardCall(value.parent, guards) && value.parent.arguments[0] === value) return true;
    const declaration = value.parent;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
    const name = declaration.name.text;
    const statement = declaration.parent.parent;
    const block = statement.parent;
    if (!ts.isVariableStatement(statement) || !(ts.isBlock(block) || ts.isSourceFile(block))) return false;
    const later = block.statements.slice(block.statements.indexOf(statement) + 1);
    const guardsIt = (node: ts.Node): boolean => {
      if (isGuardCall(node, guards)) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isIdentifier(first) && first.text === name) return true;
        // blockHandsOff(page.context()) guards a browser's own page.
        if (
          ofContext &&
          first !== undefined &&
          ts.isCallExpression(first) &&
          ts.isPropertyAccessExpression(first.expression) &&
          first.expression.name.text === 'context' &&
          ts.isIdentifier(first.expression.expression) &&
          first.expression.expression.text === name
        ) {
          return true;
        }
      }
      return ts.forEachChild(node, guardsIt) ?? false;
    };
    return later.some(guardsIt);
  };

  /** A page's context, a context the file guards, or one named as a context (the fixture's, a helper's parameter). */
  const isContext = (receiver: ts.Expression): boolean => {
    const r = unwrapped(receiver);
    if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === 'context') return true;
    return ts.isIdentifier(r) && (r.text === 'context' || r.text.endsWith('Context') || guardedNames.has(r.text));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !takesTest) {
      const module = playwrightModule(node.moduleSpecifier);
      const clause = node.importClause;
      if (module !== undefined && clause !== undefined && !clause.isTypeOnly) {
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
      const module = playwrightModule(node.arguments[0]);
      if (module !== undefined && !takesTest && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        flag(node, `requires ${module}`);
      } else if (module !== undefined && !takesTest && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        flag(node, `imports ${module} at run time`);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const callee = node.expression.getText(source);
        if (method === 'launch' || method === 'launchPersistentContext') {
          if (!hasResolverRules(node.arguments[method === 'launch' ? 0 : 1])) flag(node, `${callee}() launches without the hands-off resolver rules`);
        }
        if (method === 'newContext' && /\brequest$/.test(node.expression.expression.getText(source))) {
          if (!guardedAtCall(node, API_GUARDS, false)) flag(node, `${callee}() opens an API request context that no refuseHandsOffRequests guards`);
        } else if (method === 'newContext' || method === 'launchPersistentContext') {
          if (!guardedAtCall(node, CONTEXT_GUARDS, false)) flag(node, `${callee}() opens a context that no blockHandsOff guards`);
        } else if (method === 'newPage' && !isContext(node.expression.expression)) {
          if (!guardedAtCall(node, CONTEXT_GUARDS, true)) flag(node, `${callee}() opens a page in a context of its own that no blockHandsOff guards`);
        }
      }
    } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(source) === 'launchOptions' && !takesTest) {
      const value = ts.isPropertyAssignment(node) ? node.initializer.getText(source) : '';
      if (!RESOLVER_RULES.test(value)) flag(node, "launchOptions replaces the project's launch args and its hands-off resolver rules");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
