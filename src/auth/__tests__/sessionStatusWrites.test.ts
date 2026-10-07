// A syntax-tree check on session.ts, standing in for a lint rule: its status changes only
// through the gate, and each write carries the ticket its public operation took as the first
// statement of its body. No other ticket can be made: none taken later or in a nested block or
// callback, none forged with a cast, none passed in under another name, none from an alias of
// the gate. reload.test.ts shows the run-time effect for each write.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const FILE = path.resolve(__dirname, '../session.ts');

/** The public operations that take a ticket, each exactly once. */
const TAKERS = ['start', 'boot', 'completeSignIn', 'signOut', 'accessToken', 'refreshAfterReject', 'requireReauth', 'deviceKey'];
/** What session.ts may use on its gate. */
const GATE_MEMBERS = new Set(['ticket', 'settle', 'reloadRequired', 'status']);

const isThisGate = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === 'gate';

const enclosingFunction = (node: ts.Node): ts.SignatureDeclaration | undefined => {
  for (let at = node.parent; at !== undefined; at = at.parent) if (ts.isFunctionLike(at)) return at;
  return undefined;
};

const methodName = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : undefined;

const isPrivateMethod = (node: ts.Node | undefined): node is ts.MethodDeclaration =>
  node !== undefined &&
  ts.isMethodDeclaration(node) &&
  (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private) !== 0;

const isTicketType = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'Ticket';

const isTake = (call: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(call.expression) && isThisGate(call.expression.expression) && call.expression.name.text === 'ticket';

/** Which public operation a `this.gate.ticket()` call belongs to, or why it is not allowed there. */
function takeOwner(call: ts.CallExpression): string {
  const decl = call.parent;
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || decl.name.text !== 'ticket')
    return 'not `ticket = this.gate.ticket()`';
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0 || list.declarations.length !== 1) return 'not a lone const';
  const statement = list.parent;
  const block = statement.parent;
  if (!ts.isBlock(block) || block.statements[0] !== statement) return 'not the first statement of its block';
  const fn = block.parent;
  if (!ts.isFunctionLike(fn)) return 'in a nested block, not a function body';
  const name = methodName(fn);
  if (name === 'start') return 'in start itself, outside the run it shares';
  if (name !== undefined) return TAKERS.includes(name) ? name : `in ${name}, not a public operation`;
  // start() shares one pending run: its ticket is taken in the async function it starts.
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && methodName(enclosingFunction(fn)) === 'start') return 'start';
  return 'in a callback';
}

/** Every way session.ts could change or forge a status outside the rule, as readable lines. */
function statusWriteViolations(source: string): { takes: string[]; settles: number; violations: string[] } {
  const file = ts.createSourceFile('session.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const takes: string[] = [];
  const violations: string[] = [];
  let settles = 0;
  const at = (node: ts.Node, why: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    violations.push(`${line + 1}: ${why}: ${node.getText().split('\n')[0]}`);
  };

  // Private methods that carry a ticket, and the argument position it travels in.
  const carriers = new Map<string, number>();
  for (const node of file.statements.flatMap((s) => (ts.isClassDeclaration(s) ? [...s.members] : [])))
    if (isPrivateMethod(node) && ts.isIdentifier(node.name)) {
      const index = node.parameters.findIndex((p) => isTicketType(p.type));
      if (index >= 0) carriers.set(node.name.text, index);
    }

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && isTicketType(node)) {
      const param = node.parent;
      if (!ts.isParameter(param) || param.type !== node || !isPrivateMethod(param.parent)) at(node, 'Ticket named outside a private parameter');
      else if (!ts.isIdentifier(param.name) || param.name.text !== 'ticket') at(node, 'a Ticket parameter not named ticket');
    }
    if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name) && node.name.text === 'ticket') {
      const init = node.initializer;
      // Where the take stands is checked at the take itself, below.
      if (!ts.isVariableDeclaration(node) || init === undefined || !ts.isCallExpression(init) || !isTake(init))
        at(node, 'a ticket declared other than by the take');
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'ticket' && !(isPrivateMethod(node.parent) && isTicketType(node.type)))
      at(node, 'a ticket parameter outside a private method');
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left) && node.left.text === 'ticket')
      at(node, 'a ticket reassigned');
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && ts.isIdentifier(node.operand) && node.operand.text === 'ticket')
      at(node, 'a ticket reassigned');
    if (ts.isElementAccessExpression(node) && (node.expression.kind === ts.SyntaxKind.ThisKeyword || isThisGate(node.expression)))
      at(node, 'this or the gate indexed by name');
    if (ts.isIdentifier(node) && node.text === 'gate') {
      const ok = (ts.isPropertyDeclaration(node.parent) && node.parent.name === node) || (isThisGate(node.parent) && (node.parent as ts.PropertyAccessExpression).name === node);
      if (!ok) at(node, 'the gate reached other than as this.gate');
    }
    if (isThisGate(node)) {
      const use = node.parent;
      if (!ts.isPropertyAccessExpression(use) || !GATE_MEMBERS.has(use.name.text)) at(node, 'the gate used other than through its members');
      else if (use.name.text === 'ticket') {
        const call = use.parent;
        if (!ts.isCallExpression(call) || call.expression !== use || call.arguments.length !== 0) at(use, 'gate.ticket used other than called');
        else {
          const owner = takeOwner(call);
          if (TAKERS.includes(owner)) takes.push(owner);
          else at(call, `a ticket taken ${owner}`);
        }
      } else if (use.name.text === 'settle') {
        const call = use.parent;
        settles += 1;
        const first = ts.isCallExpression(call) && call.expression === use ? call.arguments[0] : undefined;
        if (first === undefined || !ts.isIdentifier(first) || first.text !== 'ticket' || (call as ts.CallExpression).arguments.length !== 2)
          at(use, 'a settle without its operation ticket');
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && carriers.has(node.name.text)) {
      const call = node.parent;
      const index = carriers.get(node.name.text) ?? -1;
      const arg = ts.isCallExpression(call) && call.expression === node ? call.arguments[index] : undefined;
      if (arg === undefined || !ts.isIdentifier(arg) || arg.text !== 'ticket') at(node, 'a ticket carrier called without the ticket');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'value')
      at(node, 'a .value assigned');
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'signal') at(node, 'a signal of its own');
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { takes, settles, violations };
}

describe('session.ts writes its status only through the gate', () => {
  const { takes, settles, violations } = statusWriteViolations(readFileSync(FILE, 'utf8'));

  it('breaks none of the rules', () => {
    expect(violations).toEqual([]);
  });

  it('takes exactly one ticket in each public operation, and settles at least eight writes', () => {
    expect([...takes].sort()).toEqual([...TAKERS].sort());
    expect(settles).toBeGreaterThanOrEqual(8);
  });
});

// The rules on their own: one compliant class, then one way round each rule, each caught.
const ok = (body: string, sub = `if (sub === undefined) {\n      this.gate.settle(ticket, 'signed-out');\n    }`) => `
class S {
  private readonly gate = new StatusGate();
  async boot() {
    const ticket = this.gate.ticket();
    await this.requireSub(ticket);
    ${body}
  }
  start() {
    return (async () => {
      const ticket = this.gate.ticket();
      return this.gate.settle(ticket, 'signed-out');
    })();
  }
  private async requireSub(ticket: Ticket) {
    const sub = await read();
    ${sub}
  }
}`;

describe('the rules', () => {
  it('pass a compliant class', () => {
    expect(statusWriteViolations(ok('return this.gate.settle(ticket, "signed-in");')).violations).toEqual([]);
  });

  it.each([
    ['a fresh take in a nested block', ok(''), `if (sub === undefined) {\n      const ticket = this.gate.ticket();\n      this.gate.settle(ticket, 'x');\n    }`, 'nested block'],
    ['a fresh take in a callback', ok('await then(() => { const ticket = this.gate.ticket(); this.gate.settle(ticket, "x"); });'), undefined, 'in a callback'],
    ['a take in a private method', ok('').replace('  private async requireSub', "  private async other() {\n    const ticket = this.gate.ticket();\n    this.gate.settle(ticket, 'x');\n  }\n  private async requireSub"), undefined, 'not a public operation'],
    ['a take after an await', ok('').replace('const ticket = this.gate.ticket();\n    await this.requireSub(ticket);', 'await read();\n    const ticket = this.gate.ticket();\n    await this.requireSub(ticket);'), undefined, 'first statement'],
    ['a let take', ok('').replace('const ticket = this.gate.ticket();\n    await', 'let ticket = this.gate.ticket();\n    await'), undefined, 'lone const'],
    ['a take called through .call', ok(''), `const ticket = this.gate.ticket.call(this.gate);`, 'other than called'],
    ['a ticket forged with a cast', ok(''), `const ticket = 1 as unknown as Ticket;`, 'Ticket named outside'],
    ['a ticket from an any', ok(''), `const ticket = JSON.parse('9');`, 'other than by the take'],
    ['a ticket reassigned', ok(''), `ticket = JSON.parse('9');`, 'reassigned'],
    ['a settle without the ticket', ok(''), `this.gate.settle(0 as never, 'x');`, 'settle without'],
    ['a settle through .call', ok(''), `this.gate.settle.call(this.gate, ticket, 'x');`, 'settle without'],
    ['the gate aliased', ok(''), `const g = this.gate;\n    g.settle(ticket, 'x');`, 'other than through its members'],
    ['the gate destructured', ok(''), `const { gate } = this;\n    gate.settle(ticket, 'x');`, 'other than as this.gate'],
    ['the gate indexed', ok(''), `this['gate'].settle(ticket, 'x');`, 'indexed by name'],
    ['a carrier passed a forged ticket', ok('').replace('this.requireSub(ticket)', "this.requireSub(JSON.parse('9'))"), undefined, 'carrier called without'],
    ['a Ticket parameter renamed', ok('').replace('requireSub(ticket: Ticket)', 'requireSub(_ticket: Ticket)'), `void _ticket;`, 'not named ticket'],
    ['a ticket parameter on a callback', ok('const w = (ticket: Ticket) => this.gate.settle(ticket, "x");'), undefined, 'outside a private method'],
    ['a .value assigned', ok(''), `(this.status as { value: string }).value = 'x';`, '.value assigned'],
    ['a signal of its own', ok('const own = signal(1);'), undefined, 'signal of its own'],
    ['a take named otherwise', ok('').replace('const ticket = this.gate.ticket();\n    await', 'const t = this.gate.ticket();\n    const ticket = t;\n    await'), undefined, 'not `ticket = this.gate.ticket()`'],
    ['a take after an await in the same const', ok('').replace('const ticket = this.gate.ticket();\n    await', 'const first = await read(), ticket = this.gate.ticket();\n    await'), undefined, 'lone const'],
    ['a take in start outside its run', ok('').replace('    return (async () => {\n      const ticket', '    const ticket = this.gate.ticket();\n    return (async () => {\n      const other'), undefined, 'start itself'],
    ['a take with an argument', ok('').replace('const ticket = this.gate.ticket();\n    await', 'const ticket = this.gate.ticket(1);\n    await'), undefined, 'other than called'],
    ['a ticket declared from another gate member', ok(''), `const ticket = this.gate.reloadRequired();`, 'other than by the take'],
    ['a ticket stepped', ok(''), `ticket++;`, 'reassigned'],
    ['the gate reached through an alias of this', ok(''), `const self = this;\n    self.gate.settle(ticket, 'x');`, 'other than as this.gate'],
    ['a member the gate does not offer', ok(''), `this.gate.reset();`, 'other than through its members'],
    ['a public method taking a Ticket', ok('').replace('  private async requireSub', "  async open(ticket: Ticket) {\n    this.gate.settle(ticket, 'x');\n  }\n  private async requireSub"), undefined, 'Ticket named outside a private parameter'],
    ['a settle with a renamed ticket', ok(''), `const t = ticket;\n    this.gate.settle(t, 'x');`, 'settle without'],
    ['a settle handed to another function', ok(''), `run(ticket, this.gate.settle);`, 'settle without'],
    ['a settle with no status', ok(''), `this.gate.settle(ticket);`, 'settle without'],
    ['a carrier given a renamed ticket', ok('').replace('await this.requireSub(ticket);', 'const t = ticket;\n    await this.requireSub(t);'), undefined, 'carrier called without'],
    ['a carrier handed to another function', ok('').replace('await this.requireSub(ticket);', 'await run(ticket, this.requireSub);'), undefined, 'carrier called without'],
  ])('catch %s', (_, source, sub, rule) => {
    const withSub = sub === undefined ? source : source.replace(/if \(sub === undefined\) \{[^}]*\}/, sub);
    expect(withSub).not.toBe(ok(''));
    expect(statusWriteViolations(withSub).violations.join('\n')).toContain(rule);
  });
});
