import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { e2eSources, unguardedSites } from './handsOffScan';

const scan = (file: string, ...lines: string[]) => unguardedSites({ file, code: `${lines.join('\n')}\n` });

describe('every browser context the e2e suites open is guarded', () => {
  const sources = e2eSources(import.meta.dirname);

  it('finds the specs', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(['fixtures.ts', 'auth/auth.spec.ts', 'pwa/pwa.spec.ts', 'hands-off.spec.ts']));
  });

  it('finds nothing unguarded in any of them', () => {
    expect(sources.flatMap(unguardedSites)).toEqual([]);
  });
});

describe('unguardedSites: where test and browsers come from', () => {
  it('flags a default import, a double-quoted one, and a .js spec that requires Playwright', () => {
    expect(
      scan(
        'a.spec.ts',
        "import test, { expect } from '@playwright/test';",
        "test('x', async ({ browser }) => {",
        '  const page = await browser.newPage();',
        '  expect(page).toBeTruthy();',
        '});',
      ),
    ).toEqual([
      'a.spec.ts:1: imports the default export of @playwright/test',
      'a.spec.ts:3: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
    ]);
    expect(scan('b.spec.ts', 'import { test, expect } from "@playwright/test";')).toEqual(['b.spec.ts:1: imports test from @playwright/test']);
    expect(scan('c.spec.js', "const { test } = require('@playwright/test');")).toEqual(['c.spec.js:1: requires @playwright/test']);
  });

  it.each([
    ["import * as pw from '@playwright/test';", 'imports all of @playwright/test'],
    ["import { test as it } from '@playwright/test';", 'imports test from @playwright/test'],
    ["import { expect, test } from '@playwright/test';", 'imports test from @playwright/test'],
    ["import { chromium } from 'playwright';", 'imports chromium from playwright'],
    ["import { request } from '@playwright/test';", 'imports request from @playwright/test'],
    ["import { webkit } from 'playwright-core';", 'imports webkit from playwright-core'],
    ["import { test } from '@playwright/test/lib/index';", 'imports test from @playwright/test/lib/index'],
    ["const { chromium } = await import('playwright-core');", 'imports playwright-core at run time'],
    ["export { test } from '@playwright/test';", 're-exports @playwright/test'],
    ["export * from '@playwright/test';", 're-exports @playwright/test'],
    ["import pw = require('@playwright/test');", 'requires @playwright/test'],
    ["import { test } from '../node_modules/@playwright/test/index.js';", 'imports test from ../node_modules/@playwright/test/index.js'],
    ["import { chromium } from '/repo/node_modules/playwright-core/index.mjs';", 'imports chromium from /repo/node_modules/playwright-core/index.mjs'],
    ["import { chromium } from 'file:///repo/node_modules/playwright/index.mjs';", 'imports chromium from file:///repo/node_modules/playwright/index.mjs'],
    ["const { test } = createRequire(import.meta.url)('@playwright/test');", 'requires @playwright/test'],
    ["const { chromium } = load('playwright');", 'requires playwright'],
    ["const { chromium } = module.require('playwright-core');", 'requires playwright-core'],
  ])('flags %s', (code, what) => {
    expect(scan('x.spec.ts', code)).toEqual([`x.spec.ts:1: ${what}`]);
  });

  it('reads TSX, JSX and a namespace alias too', () => {
    expect(scan('x.spec.tsx', "import { test } from '@playwright/test';", 'const shown = <div>{test.name}</div>;')).toEqual([
      'x.spec.tsx:1: imports test from @playwright/test',
    ]);
    expect(scan('x.spec.jsx', "import { chromium } from 'playwright';", 'const shown = <div />;')).toEqual(['x.spec.jsx:1: imports chromium from playwright']);
    expect(scan('x.spec.ts', 'import Page = Types.Page;')).toEqual([]);
  });

  it('lets types and the harmless values through, and lets e2e/fixtures.ts take test', () => {
    expect(
      scan(
        'x.spec.ts',
        "import type { Page } from '@playwright/test';",
        "import { expect, devices, type Browser } from '@playwright/test';",
        "import { defineConfig } from '@playwright/test';",
        "export type { Page } from '@playwright/test';",
        "import 'playwright';",
        "const config = await import('../playwright.config.ts');",
        "import { stealth } from '../node_modules/playwright-extra/index.js';",
        "import { shot } from './playwright-helpers';",
        "import helper = require('./helper');",
      ),
    ).toEqual([]);
    expect(scan('fixtures.ts', "import { test as base, expect, type BrowserContext } from '@playwright/test';", "const { test } = require('@playwright/test');")).toEqual([]);
  });
});

describe('unguardedSites: each context a file opens, at its own call', () => {
  it('flags an unguarded context even when another one in the file is guarded', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ browser }) => {",
        '  const context = await browser.newContext();',
        '  await blockHandsOff(context);',
        '});',
        "test('b', async ({ browser }) => {",
        '  const context = await browser.newContext();',
        '  await context.newPage();',
        '});',
        "test('c', async ({ browser }) => {",
        '  await browser.newContext();',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:6: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:10: browser.newContext() opens a context that no blockHandsOff guards',
    ]);
  });

  it('wants the guard after the context opens, in the same block', () => {
    expect(
      scan(
        'x.spec.ts',
        'async function a(browser) {',
        '  const context = await browser.newContext();',
        '  return context;',
        '}',
        'async function b(context) {',
        '  await blockHandsOff(context);',
        '}',
      ),
    ).toEqual(['x.spec.ts:2: browser.newContext() opens a context that no blockHandsOff guards']);
  });

  it('takes blockHandsOff or guardContext as the guard, inline or on the next lines', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ browser, context, page }) => {",
        '  const one = await browser.newContext();',
        '  try {',
        '    await guardContext(one, [], async () => {',
        '      await one.newPage();',
        '    });',
        '  } finally {',
        '    await one.close();',
        '  }',
        '  const { blocked } = await blockHandsOff(await browser.newContext());',
        '  const decoder = await page.context().newPage();',
        '  const side = await context.newPage();',
        '  const otherContext = await browser.newContext();',
        '  await blockHandsOff(otherContext);',
        '  await otherContext.newPage();',
        '});',
      ),
    ).toEqual([]);
  });

  it('trusts a context by the name `context` or by its guard, not by a name that ends in Context', () => {
    expect(scan('x.spec.ts', 'async function visit(context, otherContext) {', '  await context.newPage();', '  await otherContext.newPage();', '}')).toEqual([
      'x.spec.ts:3: otherContext.newPage() opens a page in a context of its own that no blockHandsOff guards',
    ]);
  });

  it('reads a guard in any statement list (a switch case too), and flags a context opened in a for header or as the body of an if', () => {
    expect(
      scan(
        'x.spec.ts',
        'switch (kind) {',
        "  case 'a':",
        '    const context = await browser.newContext();',
        '    await blockHandsOff(context);',
        '}',
        'for (const other = await browser.newContext(); ; ) break;',
        'if (ready) for (const third = await browser.newContext(); ; ) break;',
        'if (ready) var fourth = await browser.newContext();',
        'await blockHandsOff(fourth);',
      ),
    ).toEqual([
      'x.spec.ts:6: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:7: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:8: browser.newContext() opens a context that no blockHandsOff guards',
    ]);
  });

  it('wants the guard before any other use of the context, and blockHandsOff awaited', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ browser, playwright }) => {",
        '  const late = await browser.newContext();',
        '  const p = await late.newPage();',
        "  await p.goto('/');",
        '  await blockHandsOff(late);',
        '  const unawaited = await browser.newContext();',
        '  blockHandsOff(unawaited);',
        '  const page = await browser.newPage();',
        "  await page.goto('/');",
        '  await blockHandsOff(page.context());',
        '  const api = await playwright.request.newContext();',
        "  await api.get('/');",
        '  refuseHandsOffRequests(api);',
        '  const first = await browser.newContext(), second = await first.newPage();',
        '  await blockHandsOff(first);',
        '  const ok = await browser.newContext();',
        '  await blockHandsOff(ok);',
        '  await ok.newPage();',
        '  const okApi = await playwright.request.newContext();',
        '  refuseHandsOffRequests(okApi);',
        '  await okApi.get(\'/\');',
        '  const labelled = await browser.newContext();',
        '  log.labelled = { labelled: 1 };',
        '  const { labelled: alias } = other;',
        '  await (blockHandsOff(labelled));',
        '  const pg = await browser.newPage();',
        '  await blockHandsOff(pg.mainFrame());',
        '  const pg2 = await browser.newPage();',
        '  await blockHandsOff(wrap(pg2.context));',
        '  const second = await browser.newContext();',
        '  await blockHandsOff(other, second);',
        '  for (const looped = await browser.newContext(); ; ) break;',
        '  await blockHandsOff(looped);',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:6: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:8: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
      'x.spec.ts:11: playwright.request.newContext() opens an API request context that no refuseHandsOffRequests guards',
      'x.spec.ts:14: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:26: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
      'x.spec.ts:28: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
      'x.spec.ts:30: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:32: browser.newContext() opens a context that no blockHandsOff guards',
    ]);
  });

  it('wants the guard on every path: not under a condition, a loop or a callback', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ browser }) => {",
        '  const one = await browser.newContext();',
        '  if (ready) await blockHandsOff(one);',
        '  const two = await browser.newContext();',
        '  ready && (await blockHandsOff(two));',
        '  const three = await browser.newContext();',
        '  for (const _ of [1]) await blockHandsOff(three);',
        '  const four = await browser.newContext();',
        '  setTimeout(async () => await blockHandsOff(four));',
        '  const five = await browser.newContext();',
        '  try {',
        '    await blockHandsOff(five);',
        '  } catch {',
        '    await five.close();',
        '  }',
        '  const six = await browser.newContext();',
        '  try {',
        '    await six.newPage();',
        '  } finally {',
        '    await blockHandsOff(six);',
        '  }',
        '  const seven = await browser.newContext();',
        '  try {',
        '    await other();',
        '  } finally {',
        '    await blockHandsOff(seven);',
        '  }',
        '  const eight = await browser.newContext();',
        '  {',
        '    await blockHandsOff(eight);',
        '  }',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:4: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:6: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:8: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:16: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:22: browser.newContext() opens a context that no blockHandsOff guards',
    ]);
  });

  it('flags a persistent context with the rules but no guard, even one named context', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        "  const context = await playwright.chromium.launchPersistentContext('/tmp/p', { args: HANDS_OFF_LAUNCH_ARGS });",
        '  await context.newPage();',
        '});',
      ),
    ).toEqual(['x.spec.ts:2: playwright.chromium.launchPersistentContext() opens a context that no blockHandsOff guards']);
  });

  it('takes only playwright.request (or request) as an API request context, not a browser whose name mentions request', () => {
    expect(scan('x.spec.ts', 'const ctx = await requestBrowser.newContext();', 'refuseHandsOffRequests(ctx);')).toEqual([
      'x.spec.ts:1: requestBrowser.newContext() opens a context that no blockHandsOff guards',
    ]);
  });

  it("flags a browser's own page unless its context is guarded", () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ browser }) => {",
        '  const page = await browser.newPage();',
        '  await blockHandsOff(page.context());',
        '  const other = await browser.newPage();',
        '  await (await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS })).newPage();',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:4: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
      'x.spec.ts:5: (await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS })).newPage() opens a page in a context of its own that no blockHandsOff guards',
    ]);
  });

  it('flags an API request context of its own unless refuseHandsOffRequests guards it', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright, request }) => {",
        '  const api = await playwright.request.newContext();',
        '  const guarded = await playwright.request.newContext();',
        '  refuseHandsOffRequests(guarded);',
        '  const wrong = await request.newContext();',
        '  await blockHandsOff(wrong);',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: playwright.request.newContext() opens an API request context that no refuseHandsOffRequests guards',
      'x.spec.ts:5: request.newContext() opens an API request context that no refuseHandsOffRequests guards',
    ]);
  });
});

describe('unguardedSites: the resolver rules under every Chromium', () => {
  it('flags a launch without them, and launchOptions that replace them', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        '  const b = await playwright.chromium.launch();',
        "  const c = await playwright.chromium.launch({ args: ['--x'] });",
        '  const d = await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS });',
        "  const e = await playwright.chromium.launchPersistentContext(dir, { channel: 'chromium' });",
        '  await blockHandsOff(e);',
        "  const f = await playwright.chromium.launchPersistentContext(dir, { args: [...HANDS_OFF_LAUNCH_ARGS, '--x'] });",
        '  await blockHandsOff(f);',
        '});',
        'test.use({ launchOptions: { args: [] } });',
        'test.use({ launchOptions: { args: HANDS_OFF_LAUNCH_ARGS, slowMo: 1 } });',
        'test.use({ launchOptions });',
      ),
    ).toEqual([
      'x.spec.ts:2: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:3: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:5: playwright.chromium.launchPersistentContext() launches without the hands-off resolver rules',
      "x.spec.ts:10: launchOptions replaces the project's launch args and its hands-off resolver rules",
      "x.spec.ts:12: launchOptions replaces the project's launch args and its hands-off resolver rules",
    ]);
  });

  it('reads the args as code: the HANDS_OFF_LAUNCH_ARGS identifier itself, in args, and not replaced after', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        '  await playwright.chromium.launch({ args: [/* HANDS_OFF_LAUNCH_ARGS */] });',
        '  await playwright.chromium.launch({ ignoreDefaultArgs: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS, ...more });',
        '  await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS, [key]: [] });',
        '  await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS.slice(1) });',
        "  await playwright.chromium.launch({ args: ['HANDS_OFF_LAUNCH_ARGS'] });",
        '  await playwright.chromium.launch({ args });',
        '  await playwright.chromium.launch({ args: otherArgs });',
        '  await playwright.chromium.launch({ args: [...otherArgs] });',
        '  await playwright.chromium.launch({ ...more, args: HANDS_OFF_LAUNCH_ARGS });',
        "  await playwright.chromium.launch({ 'args': ['--x', ...HANDS_OFF_LAUNCH_ARGS], slowMo: 1 });",
        "  await playwright.chromium.launch({ ['args']: HANDS_OFF_LAUNCH_ARGS });",
        '});',
        "test.use({ launchOptions: { /* HANDS_OFF_LAUNCH_ARGS */ args: ['--disable-gpu'] } });",
        "test.use({ 'launchOptions': { args: [] } });",
        "test.use({ ['launchOptions']: { args: [] } });",
        'test.use({ [`launchOptions`]: { args: [] } });',
        'test.use({ launchOptions: { args: HANDS_OFF_LAUNCH_ARGS, ...more } });',
        "test.use({ 'launchOptions': { ...more, 'args': HANDS_OFF_LAUNCH_ARGS } });",
      ),
    ).toEqual([
      'x.spec.ts:2: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:3: playwright.chromium.launch() launches without the hands-off resolver rules',
      "x.spec.ts:3: ignoreDefaultArgs can take the hands-off resolver rules off Chromium's command line",
      'x.spec.ts:4: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:5: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:6: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:7: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:8: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:9: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:10: playwright.chromium.launch() launches without the hands-off resolver rules',
      'x.spec.ts:11: playwright.chromium.launch() launches with options spread in or under a computed name, which the scan cannot read',
      "x.spec.ts:15: launchOptions replaces the project's launch args and its hands-off resolver rules",
      "x.spec.ts:16: launchOptions replaces the project's launch args and its hands-off resolver rules",
      "x.spec.ts:17: launchOptions replaces the project's launch args and its hands-off resolver rules",
      "x.spec.ts:18: launchOptions replaces the project's launch args and its hands-off resolver rules",
      "x.spec.ts:19: launchOptions replaces the project's launch args and its hands-off resolver rules",
      'x.spec.ts:20: launchOptions holds options spread in or under a computed name, which the scan cannot read',
    ]);
  });

  it('flags args that spread HANDS_OFF_LAUNCH_ARGS beside one that replaces its rules, goes round them, or cannot be read', () => {
    const overridden = 'playwright.chromium.launch() launches with an arg that replaces or goes round the hands-off resolver rules, or one the scan cannot read';
    const env = "env replaces the browser's environment, which can carry a proxy that goes round the hands-off resolver rules";
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        "  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, '--host-resolver-rules=MAP * 127.0.0.1'] });",
        "  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, '--proxy-server=http://127.0.0.1:3128'] });",
        "  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, '--proxy-pac-url=http://127.0.0.1/p.pac'] });",
        "  await playwright.chromium.launch({ args: ['--proxy-auto-detect', ...HANDS_OFF_LAUNCH_ARGS] });",
        "  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, '-host-rules=MAP vndb.org 192.0.2.1'] });",
        "  await playwright.chromium.launch({ args: ['--', ...HANDS_OFF_LAUNCH_ARGS] });",
        '  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, extra] });',
        '  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, `--proxy-server=${proxy}`] });',
        '  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, ...more] });',
        "  await playwright.chromium.launch({ args: [...HANDS_OFF_LAUNCH_ARGS, '--disable-gpu', `--lang=en`, '--no-proxy-server', ...HANDS_OFF_LAUNCH_ARGS] });",
        "  await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS, env: { ...process.env, http_proxy: 'http://127.0.0.1:3128' } });",
        '});',
        "test.use({ launchOptions: { args: [...HANDS_OFF_LAUNCH_ARGS, '--Proxy-Server=http://127.0.0.1:3128'] } });",
        "test.use({ launchOptions: { args: HANDS_OFF_LAUNCH_ARGS, 'env': {} } });",
        "spawn('node', [], { env: { http_proxy: 'http://127.0.0.1:3128' } });",
        "export default { webServer: { command: 'vite', env: { PORT: '5173' } } };",
      ),
    ).toEqual([
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => `x.spec.ts:${line}: ${overridden}`),
      `x.spec.ts:12: ${env}`,
      'x.spec.ts:14: launchOptions carries an arg that replaces or goes round the hands-off resolver rules, or one the scan cannot read',
      `x.spec.ts:15: ${env}`,
    ]);
  });

  it("flags ignoreDefaultArgs wherever it is written, before or after the args: Playwright takes each arg it names off Chromium's command line, the rules among them", () => {
    const ignored = "can take the hands-off resolver rules off Chromium's command line";
    expect(
      scan(
        'x.spec.ts',
        'test.use({ launchOptions: { args: HANDS_OFF_LAUNCH_ARGS, ignoreDefaultArgs: HANDS_OFF_LAUNCH_ARGS } });',
        'test.use({ launchOptions: { ignoreDefaultArgs: [...HANDS_OFF_LAUNCH_ARGS], args: HANDS_OFF_LAUNCH_ARGS } });',
        "test('a', async ({ playwright }) => {",
        '  await playwright.chromium.launch({ args: HANDS_OFF_LAUNCH_ARGS, ignoreDefaultArgs: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.launch({ ignoreDefaultArgs: true, args: HANDS_OFF_LAUNCH_ARGS });',
        "  const c = await playwright.chromium.launchPersistentContext(dir, { 'ignoreDefaultArgs': HANDS_OFF_LAUNCH_ARGS, args: HANDS_OFF_LAUNCH_ARGS });",
        '  await blockHandsOff(c);',
        "  const d = await playwright.chromium.launchPersistentContext(dir, { args: HANDS_OFF_LAUNCH_ARGS, ['ignoreDefaultArgs']: HANDS_OFF_LAUNCH_ARGS });",
        '  await blockHandsOff(d);',
        '  const options = { ignoreDefaultArgs };',
        '  await playwright.chromium.launch({ ...options, args: HANDS_OFF_LAUNCH_ARGS });',
        '  defaults.ignoreDefaultArgs = HANDS_OFF_LAUNCH_ARGS;',
        "  defaults['ignoreDefaultArgs'] = HANDS_OFF_LAUNCH_ARGS;",
        '});',
      ),
    ).toEqual([
      ...[1, 2, 4, 5, 6, 8, 10].map((line) => `x.spec.ts:${line}: ignoreDefaultArgs ${ignored}`),
      'x.spec.ts:11: playwright.chromium.launch() launches with options spread in or under a computed name, which the scan cannot read',
      `x.spec.ts:12: defaults.ignoreDefaultArgs ${ignored}`,
      `x.spec.ts:13: defaults['ignoreDefaultArgs'] ${ignored}`,
    ]);
  });

  it('flags executablePath wherever it is written: a browser binary the scan cannot check, which may leave out the args it is given', () => {
    const binary = 'executablePath launches a browser binary the scan cannot check, which may leave out the args it is given';
    expect(
      scan(
        'x.spec.ts',
        "test.use({ launchOptions: { args: HANDS_OFF_LAUNCH_ARGS, executablePath: '/opt/chromium-wrapper' } });",
        "test('a', async ({ playwright }) => {",
        "  await playwright.chromium.launch({ executablePath: '/opt/chromium-wrapper', args: HANDS_OFF_LAUNCH_ARGS });",
        "  const c = await playwright.chromium.launchPersistentContext(dir, { args: HANDS_OFF_LAUNCH_ARGS, ['executablePath']: wrapper });",
        '  await blockHandsOff(c);',
        "  const paths = { 'executablePath': wrapper };",
        '  await playwright.chromium.launch({ ...paths, args: HANDS_OFF_LAUNCH_ARGS });',
        '});',
      ),
    ).toEqual([
      ...[1, 3, 4, 6].map((line) => `x.spec.ts:${line}: ${binary}`),
      'x.spec.ts:7: playwright.chromium.launch() launches with options spread in or under a computed name, which the scan cannot read',
    ]);
  });

  it('fails closed on launch options it cannot read in full: a spread or a computed name anywhere in them, before the args too', () => {
    const call = 'launches with options spread in or under a computed name, which the scan cannot read';
    const held = 'launchOptions holds options spread in or under a computed name, which the scan cannot read';
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        '  await playwright.chromium.launch({ ...new Quiet(), args: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.launch({ ...viaProxy, args: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.launch({ [key]: [], args: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.launch({ ...{ slowMo: 1 }, args: HANDS_OFF_LAUNCH_ARGS });',
        '  const c = await playwright.chromium.launchPersistentContext(dir, { ...o, args: HANDS_OFF_LAUNCH_ARGS });',
        '  await blockHandsOff(c);',
        '  await playwright.chromium.launch({ get [key]() { return []; }, args: HANDS_OFF_LAUNCH_ARGS });',
        "  await playwright.chromium.launch({ slowMo: 1, 'headless': true, ['channel']: 'chromium', args: HANDS_OFF_LAUNCH_ARGS });",
        '});',
        'test.use({ launchOptions: { ...viaProxy, args: HANDS_OFF_LAUNCH_ARGS } });',
        'test.use({ launchOptions: { [key]: true, args: HANDS_OFF_LAUNCH_ARGS } });',
        'test.use({ launchOptions: { slowMo: 1, args: HANDS_OFF_LAUNCH_ARGS } });',
        // Not an object literal at all: flagged as launching without the rules.
        'test.use({ launchOptions: options });',
        "test('b', async ({ playwright }) => { await playwright.chromium.launch(new Quiet()); });",
      ),
    ).toEqual([
      ...[2, 3, 4, 5].map((line) => `x.spec.ts:${line}: playwright.chromium.launch() ${call}`),
      `x.spec.ts:6: playwright.chromium.launchPersistentContext() ${call}`,
      `x.spec.ts:8: playwright.chromium.launch() ${call}`,
      `x.spec.ts:11: ${held}`,
      `x.spec.ts:12: ${held}`,
      "x.spec.ts:14: launchOptions replaces the project's launch args and its hands-off resolver rules",
      'x.spec.ts:15: playwright.chromium.launch() launches without the hands-off resolver rules',
    ]);
  });

  it('reads a class field as it reads a key in an object: one spread into launch options carries its options with it', () => {
    expect(
      scan(
        'x.spec.ts',
        'class Quiet { ignoreDefaultArgs = HANDS_OFF_LAUNCH_ARGS; }',
        "class Wrapped { executablePath = '/tmp/wrapper-that-drops-args'; }",
        "class Proxied { static proxy = { server: 'http://127.0.0.1:3128' }; }",
        "class Engine { browserName = 'firefox'; }",
        'class Getter { get ignoreDefaultArgs() { return true; } }',
        'class Options { launchOptions = { args: [] }; }',
        "class Plain { args = HANDS_OFF_LAUNCH_ARGS; slowMo = 1; browserName = 'chromium'; }",
      ),
    ).toEqual([
      "x.spec.ts:1: ignoreDefaultArgs can take the hands-off resolver rules off Chromium's command line",
      'x.spec.ts:2: executablePath launches a browser binary the scan cannot check, which may leave out the args it is given',
      'x.spec.ts:3: proxy sends requests through a proxy, which looks the hands-off hosts up itself',
      "x.spec.ts:4: browserName = 'firefox' may pick a browser other than chromium, which has no hands-off resolver rules",
      "x.spec.ts:5: ignoreDefaultArgs can take the hands-off resolver rules off Chromium's command line",
      "x.spec.ts:6: launchOptions replaces the project's launch args and its hands-off resolver rules",
    ]);
  });

  it('checks launchOptions in e2e/fixtures.ts too', () => {
    expect(scan('fixtures.ts', 'export const t = base.extend({});', "t.use({ launchOptions: { args: ['--x'] } });")).toEqual([
      "fixtures.ts:2: launchOptions replaces the project's launch args and its hands-off resolver rules",
    ]);
  });

  it('flags every other way to a browser: a launcher named, bound or destructured, a browser server, connect, CDP, _android', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        "  await playwright.chromium['launch']();",
        "  await playwright.chromium['launch']({ args: HANDS_OFF_LAUNCH_ARGS });",
        '  const launch = playwright.chromium.launch.bind(playwright.chromium);',
        '  const { launchPersistentContext } = playwright.chromium;',
        '  const server = await playwright.chromium.launchServer({ args: HANDS_OFF_LAUNCH_ARGS });',
        '  await playwright.chromium.connect(server.wsEndpoint());',
        "  await chromium.connectOverCDP('http://127.0.0.1:9222');",
        "  await playwright.webkit['connect']('ws://127.0.0.1:1');",
        '  const [device] = await playwright._android.devices();',
        "  await device.connect('coordinator.v1.CompareService', 'Compare', {});",
        '  const open = browser.newContext.bind(browser);',
        '  const { newPage, launchServer: serve } = browser;',
        '  const { _electron } = playwright;',
        "  await chromium.connect('ws://127.0.0.1:1');",
        "  const { 'launch': quoted, ['newPage']: computed } = playwright.chromium;",
        '});',
      ),
    ).toEqual([
      "x.spec.ts:2: playwright.chromium['launch']() launches without the hands-off resolver rules",
      'x.spec.ts:4: playwright.chromium.launch is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:5: launchPersistentContext is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:6: playwright.chromium.launchServer() opens a browser the scan cannot check',
      'x.spec.ts:7: playwright.chromium.connect() opens a browser the scan cannot check',
      'x.spec.ts:8: chromium.connectOverCDP() opens a browser the scan cannot check',
      "x.spec.ts:9: playwright.webkit['connect']() opens a browser the scan cannot check",
      'x.spec.ts:10: playwright._android opens a browser the scan cannot check',
      'x.spec.ts:12: browser.newContext is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:13: newPage is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:13: launchServer is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:14: _electron opens a browser the scan cannot check',
      'x.spec.ts:15: chromium.connect() opens a browser the scan cannot check',
      'x.spec.ts:16: launch is taken, not called, so the scan cannot check what it opens',
      'x.spec.ts:16: newPage is taken, not called, so the scan cannot check what it opens',
    ]);
  });

  it("flags the worker's default launch options (a private API): the worker's browser and every launch in the worker start from them", () => {
    expect(
      scan(
        'x.spec.ts',
        'test.beforeAll(({ playwright }) => {',
        "  playwright._defaultLaunchOptions.args = ['--host-resolver-rules=MAP * 127.0.0.1'];",
        "  Object.assign(playwright['_defaultLaunchOptions'], options);",
        '  const { _defaultLaunchOptions: defaults } = playwright;',
        '  const { _defaultLaunchOptions } = pw;',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: playwright._defaultLaunchOptions takes the launch options every browser in the worker starts from, a private API the scan cannot check',
      "x.spec.ts:3: playwright['_defaultLaunchOptions'] takes the launch options every browser in the worker starts from, a private API the scan cannot check",
      'x.spec.ts:4: _defaultLaunchOptions takes the launch options every browser in the worker starts from, a private API the scan cannot check',
      'x.spec.ts:5: _defaultLaunchOptions takes the launch options every browser in the worker starts from, a private API the scan cannot check',
    ]);
  });

  it("flags the worker's launch options' private holds wherever their names are written (a string, a key, a binding, _browserOptions too), and a private or unreadable fixture in test.extend or test.use", () => {
    const taken = 'takes the launch options every browser in the worker starts from, a private API the scan cannot check';
    expect(
      scan(
        'x.spec.ts',
        'test.beforeAll(({ playwright }) => {',
        "  Reflect.get(playwright, '_defaultLaunchOptions').args = [];",
        "  Reflect.set(playwright, '_defaultLaunchOptions', {});",
        '  Object.assign(playwright, { _defaultLaunchOptions: {} });',
        '  Object.defineProperty(playwright, `_defaultLaunchOptions`, { value: {} });',
        "  Object.getOwnPropertyDescriptor(playwright, '_defaultLaunchOptions')!.value.args = [];",
        "  const key = '_defaultLaunchOptions';",
        '});',
        "const t = test.extend({ _browserOptions: [async ({}, use) => use({}), { scope: 'worker', auto: true }] });",
        "test.use({ _optionConnectOptions: { wsEndpoint: 'ws://127.0.0.1:1' } });",
        "const u = base.extend({ [`_combined${'ContextOptions'}`]: async ({}, use) => use({}) });",
        'const { _browserOptions: options } = fixtures;',
        'playwright._browserOptions = {};',
        "const v = test.extend({ handsOffNote: async ({}, use) => use('fine'), 'quoted': 1, ['computed']: 2 });",
        "const record = { _id: 'u1', '_defaultLaunchOptionsLike': 1 };",
        'test.use({ viewport_note: 1 });',
        "app.use('/x', { _mounted: true });",
        'const holds = { x_defaultLaunchOptions: 1, y_browserOptions: 2 };',
      ),
    ).toEqual([
      `x.spec.ts:2: '_defaultLaunchOptions' ${taken}`,
      `x.spec.ts:3: '_defaultLaunchOptions' ${taken}`,
      `x.spec.ts:4: _defaultLaunchOptions ${taken}`,
      `x.spec.ts:5: \`_defaultLaunchOptions\` ${taken}`,
      `x.spec.ts:6: '_defaultLaunchOptions' ${taken}`,
      `x.spec.ts:7: '_defaultLaunchOptions' ${taken}`,
      `x.spec.ts:9: _browserOptions ${taken}`,
      'x.spec.ts:10: _optionConnectOptions overrides a private Playwright fixture, which the scan cannot check',
      "x.spec.ts:11: [`_combined${'ContextOptions'}`] overrides a fixture by a name the scan cannot read",
      `x.spec.ts:12: _browserOptions ${taken}`,
      `x.spec.ts:13: playwright._browserOptions ${taken}`,
    ]);
  });

  it("reads test.use's and test.extend's first argument through `as`, `satisfies`, `!`, a type assertion and parentheses", () => {
    const fixture = 'overrides a private Playwright fixture, which the scan cannot check';
    expect(
      scan(
        'x.spec.ts',
        'test.use({ _combinedContextOptions: async ({}, use) => use({}) } as any);',
        'test.use(({ _reuseContext: true }));',
        'test.use({ [k]: {} } as any);',
        'test.use({ _reuseContext: true } satisfies object);',
        'const t = test.extend({ _contextReuseMode: 1 }!);',
        'const u = test.extend(<any>({ _optionConnectOptions: {} }) as never);',
        "app.use('/x', { _mounted: true } as any);",
      ),
    ).toEqual([
      `x.spec.ts:1: _combinedContextOptions ${fixture}`,
      `x.spec.ts:2: _reuseContext ${fixture}`,
      'x.spec.ts:3: [k] overrides a fixture by a name the scan cannot read',
      `x.spec.ts:4: _reuseContext ${fixture}`,
      `x.spec.ts:5: _contextReuseMode ${fixture}`,
      `x.spec.ts:6: _optionConnectOptions ${fixture}`,
    ]);
  });

  it('fails closed on a member it cannot name: a computed key on a Playwright object, or in a destructuring', () => {
    const unnamed = 'takes a member by a name the scan cannot read';
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright, browser, context, page, request }) => {",
        "  const k = 'launch';",
        '  await playwright.chromium[k]();',
        '  const { [k]: go } = playwright.chromium;',
        '  await playwright[engine].launch({ args: HANDS_OFF_LAUNCH_ARGS });',
        '  await (browser)[open]();',
        '  await context[method]();',
        '  await page.context()[method]();',
        '  await page[method]();',
        '  await request[method]();',
        '  const first = items[i] ?? browser.contexts()[0];',
        "  const { ['viewport']: size, [`baseURL`]: base } = settings;",
        '  const { [name]: value } = settings;',
        '  const [{ viewport }] = sizes;',
        '});',
      ),
    ).toEqual([
      `x.spec.ts:3: playwright.chromium[k] ${unnamed}`,
      `x.spec.ts:4: [k]: go ${unnamed}`,
      `x.spec.ts:5: playwright[engine] ${unnamed}`,
      `x.spec.ts:6: (browser)[open] ${unnamed}`,
      `x.spec.ts:7: context[method] ${unnamed}`,
      `x.spec.ts:8: page.context()[method] ${unnamed}`,
      `x.spec.ts:9: page[method] ${unnamed}`,
      `x.spec.ts:10: request[method] ${unnamed}`,
      `x.spec.ts:13: [name]: value ${unnamed}`,
    ]);
  });

  it('flags a launch of firefox or webkit, which ignore the resolver rules even when given them', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ playwright }) => {",
        '  await playwright.firefox.launch({ args: HANDS_OFF_LAUNCH_ARGS });',
        "  const context = await webkit.launchPersistentContext(dir, { args: HANDS_OFF_LAUNCH_ARGS });",
        '  await blockHandsOff(context);',
        "  await playwright['chromium'].launch({ args: HANDS_OFF_LAUNCH_ARGS });",
        '  await browserType.launch({ args: HANDS_OFF_LAUNCH_ARGS });',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: playwright.firefox.launch() launches a browser other than chromium, which has no hands-off resolver rules',
      'x.spec.ts:3: webkit.launchPersistentContext() launches a browser other than chromium, which has no hands-off resolver rules',
    ]);
  });

  it('flags a browser other than chromium, a proxy and connectOptions, in test.use or anywhere else', () => {
    expect(
      scan(
        'x.spec.ts',
        "test.use({ browserName: 'firefox' });",
        "test.use({ defaultBrowserType: 'webkit' });",
        'test.use({ browserName });',
        "test.use({ browserName: 'chromium', channel: 'chrome' });",
        "test.use({ ...devices['Desktop Firefox'] });",
        "test.use({ ...devices['iPhone 15'], isMobile: true });",
        'test.use({ ...devices[name] });',
        "test.use({ ...devices['Pixel 7'], ...settings['Desktop Firefox'], ...iphone });",
        "test.use({ proxy: { server: 'http://127.0.0.1:3128' } });",
        "test.use({ 'connectOptions': { wsEndpoint: 'ws://127.0.0.1:1' } });",
        "const context = await browser.newContext({ proxy: { server: 'http://127.0.0.1:3128' } });",
        'await blockHandsOff(context);',
      ),
    ).toEqual([
      "x.spec.ts:1: browserName: 'firefox' may pick a browser other than chromium, which has no hands-off resolver rules",
      "x.spec.ts:2: defaultBrowserType: 'webkit' may pick a browser other than chromium, which has no hands-off resolver rules",
      'x.spec.ts:3: browserName may pick a browser other than chromium, which has no hands-off resolver rules',
      "x.spec.ts:5: ...devices['Desktop Firefox'] may pick a browser other than chromium, which has no hands-off resolver rules",
      "x.spec.ts:6: ...devices['iPhone 15'] may pick a browser other than chromium, which has no hands-off resolver rules",
      'x.spec.ts:7: ...devices[name] may pick a browser other than chromium, which has no hands-off resolver rules',
      'x.spec.ts:9: proxy sends requests through a proxy, which looks the hands-off hosts up itself',
      'x.spec.ts:10: connectOptions opens a browser the scan cannot check',
      'x.spec.ts:11: proxy sends requests through a proxy, which looks the hands-off hosts up itself',
    ]);
  });

  it('honours a hands-off-scan: note on the statement under it, only in hands-off.spec.ts (whose browsers all end at a sentinel)', () => {
    const noted = ['// hands-off-scan: the sentinel catches the rest.', 'const b = await playwright.chromium.launch();'];
    expect(scan('hands-off.spec.ts', ...noted)).toEqual([]);
    expect(scan('other.spec.ts', ...noted)).toEqual(['other.spec.ts:2: playwright.chromium.launch() launches without the hands-off resolver rules']);
    expect(scan('hands-off.spec.ts', ...noted, 'const c = await playwright.chromium.launch();')).toEqual([
      'hands-off.spec.ts:3: playwright.chromium.launch() launches without the hands-off resolver rules',
    ]);
    expect(scan('hands-off.spec.ts', '// a note of another kind', 'const c = await playwright.chromium.launch();')).toEqual([
      'hands-off.spec.ts:2: playwright.chromium.launch() launches without the hands-off resolver rules',
    ]);
    expect(
      scan(
        'hands-off.spec.ts',
        '// hands-off-scan: a note on a test does not cover the calls in it.',
        "test('a', async ({ playwright, browser }) => {",
        '  const b = await playwright.chromium.launch();',
        '  const page = await browser.newPage();',
        '});',
      ),
    ).toEqual([
      'hands-off.spec.ts:3: playwright.chromium.launch() launches without the hands-off resolver rules',
      'hands-off.spec.ts:4: browser.newPage() opens a page in a context of its own that no blockHandsOff guards',
    ]);
  });
});

describe('unguardedSites: routes, which run newest first, so ahead of the hands-off guard', () => {
  it('flags a route that sends a request on, fetches it itself, or has a handler the scan cannot read', () => {
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ page, context }) => {",
        "  await page.route('**/*', (route) => route.continue());",
        "  await context.route('**/*', async (route) => route.fulfill({ response: await route.fetch() }));",
        "  await context.routeWebSocket('**', (ws) => ws.connectToServer());",
        "  await page.route('**/*', (route) => route.fallback({ url: 'http://localhost/x' }));",
        "  await page.routeFromHAR('e2e/x.har');",
        "  await page.route('**/api/**', handler);",
        "  await page.route('**/api/**', (route) => route.fulfill({ status: 200 }));",
        "  await page.route('**/api/**', (route) => route.fallback());",
        "  await context.route('**/api/**', async (route) => route.abort('blockedbyclient'));",
        "  await page.unroute('**/api/**');",
        "  await page.route('**/x', function (route) { return route.abort(); });",
        "  await context.routeWebSocket('**', onSocket);",
        "  await page.route('**/y', (route) => route.fulfill({ body: cache.fetch() }));",
        '  await withApi(url, (api) => api.fetch(url));',
        '});',
      ),
    ).toEqual([
      'x.spec.ts:2: route.continue() sends a routed request on, ahead of the hands-off guard',
      'x.spec.ts:3: route.fetch() fetches a routed request itself, outside the hands-off guards',
      'x.spec.ts:4: ws.connectToServer() sends a routed request on, ahead of the hands-off guard',
      'x.spec.ts:5: route.fallback() sends a routed request on with changes, ahead of the hands-off guard',
      'x.spec.ts:6: page.routeFromHAR() can send requests on, ahead of the hands-off guard',
      'x.spec.ts:7: page.route() takes a handler the scan cannot read',
      'x.spec.ts:13: context.routeWebSocket() takes a handler the scan cannot read',
    ]);
  });

  it("flags unroute and unrouteAll on anything but the page: either can take the hands-off route guard off a context", () => {
    const off = 'can take the hands-off route guard off a context';
    expect(
      scan(
        'x.spec.ts',
        "test('a', async ({ page, context, browser }) => {",
        "  await context.unrouteAll({ behavior: 'ignoreErrors' });",
        '  await page.context().unrouteAll();',
        '  await context.unroute(/vndb/i);',
        '  const ctx = await browser.newContext();',
        '  await blockHandsOff(ctx);',
        "  await ctx.unroute('**/*');",
        '  await browser.contexts()[0].unrouteAll();',
        "  await page.unroute('**/api/**');",
        '  await page.unrouteAll();',
        '});',
      ),
    ).toEqual([
      `x.spec.ts:2: context.unrouteAll() ${off}`,
      `x.spec.ts:3: page.context().unrouteAll() ${off}`,
      `x.spec.ts:4: context.unroute() ${off}`,
      `x.spec.ts:7: ctx.unroute() ${off}`,
      `x.spec.ts:8: browser.contexts()[0].unrouteAll() ${off}`,
    ]);
  });

  it('honours a hands-off-scan: note in e2e/handsOff.ts, the guard itself', () => {
    const noted = ['// hands-off-scan: the guard connects only what is not hands-off.', 'if (!isHandsOffUrl(ws.url())) return ws.connectToServer();'];
    expect(scan('handsOff.ts', ...noted)).toEqual([]);
    expect(scan('other.ts', ...noted)).toEqual(['other.ts:2: ws.connectToServer() sends a routed request on, ahead of the hands-off guard']);
  });
});

describe('unguardedSites: the shapes each check reads through', () => {
  const inTest = (...lines: string[]) => scan('x.spec.ts', "test('x', async ({ playwright, browser }) => {", ...lines, '});');

  it.each([
    ['parentheses round a browser type', ['await (playwright.firefox).launch({ args: HANDS_OFF_LAUNCH_ARGS });'], ['x.spec.ts:2: (playwright.firefox).launch() launches a browser other than chromium, which has no hands-off resolver rules']],
    ['a launcher handed on as an argument, not called', ['const b = await Reflect.apply(playwright.chromium.launch, playwright.chromium, []);'], ['x.spec.ts:2: playwright.chromium.launch is taken, not called, so the scan cannot check what it opens']],
    ["a context given to a guard as its second argument, not its first", ['await blockHandsOff(blocked, await browser.newContext());'], ['x.spec.ts:2: browser.newContext() opens a context that no blockHandsOff guards']],
    ['a browser context from a name that only ends in request', ['const api = await myrequest.newContext();', 'await blockHandsOff(api);'], []],
    ['a context in parentheses, then guarded', ['const ctx = (await browser.newContext());', 'await blockHandsOff(ctx);'], []],
  ])('%s', (_, lines, found) => {
    expect(inTest(...lines)).toEqual(found);
  });
});

describe('e2eSources', () => {
  it('reads every JS and TS source outside node_modules, specs or not', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'e2e-sources-'));
    try {
      const files = ['a.spec.ts', 'b.spec.js', 'c.spec.mjs', 'd.tsx', 'e.cjs', 'f.vitest.ts', 'sub/g.mts', 'node_modules/x/h.ts', 'i.png', 'j.json'];
      for (const f of files) {
        mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
        writeFileSync(path.join(root, f), `// ${f}\n`);
      }
      const sources = e2eSources(root);
      expect(sources.map((s) => s.file)).toEqual(['a.spec.ts', 'b.spec.js', 'c.spec.mjs', 'd.tsx', 'e.cjs', 'f.vitest.ts', 'sub/g.mts']);
      expect(sources[1]).toEqual({ file: 'b.spec.js', code: '// b.spec.js\n' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
