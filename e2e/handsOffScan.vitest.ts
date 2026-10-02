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
      ),
    ).toEqual([]);
    expect(scan('fixtures.ts', "import { test as base, expect, type BrowserContext } from '@playwright/test';")).toEqual([]);
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

  it('reads a guard in any statement list (a switch case too), and flags a context opened in a for header', () => {
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
      ),
    ).toEqual([
      'x.spec.ts:6: browser.newContext() opens a context that no blockHandsOff guards',
      'x.spec.ts:7: browser.newContext() opens a context that no blockHandsOff guards',
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
