// Every e2e test runs under the shipped CSP and fails on any violation the
// page reports. The listener is installed before the app's first script.
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { guardContext, refuseHandsOffLookups, refuseHandsOffRequests, refuseRoundTheRules, refuseRoundTheRulesAtEachLaunch } from './handsOff';

export { expect };

// This worker's own DNS (Node's fetch and http, Playwright's API requests) has no address for a hands-off host.
refuseHandsOffLookups();

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
  sample: string;
}

/** Records every securitypolicyviolation any page of `context` reports. */
export async function watchCsp(context: BrowserContext): Promise<CspViolation[]> {
  const seen: CspViolation[] = [];
  await context.exposeBinding('__fcCspViolation', (_source, v: CspViolation) => {
    seen.push(v);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const report = (window as unknown as { __fcCspViolation: (v: unknown) => void }).__fcCspViolation;
      report({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile}:${e.lineNumber}`,
        sample: e.sample,
      });
    });
  });
  return seen;
}

/**
 * Every context aborts its pages' and workers' requests to the hands-off hosts
 * before they are sent (e2e/handsOff.ts), and the test fails if one got past
 * that route guard (a redirect hop); handsOffBlocked lists what it stopped.
 * Specs that must not run under the CSP check (e2e/auth) take this one.
 */
export const guardedTest = base.extend<{ handsOffBlocked: string[] }, { handsOffWorker: void }>({
  // No worker starts with a proxy in its environment or a browser to connect to: either goes round the resolver rules.
  handsOffWorker: [
    async ({ connectOptions }, use) => {
      refuseRoundTheRules(process.env, connectOptions);
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  // And each launch in the worker, its own browser's and a spec's alike, checks again as it starts: the environment can change after the worker starts.
  playwright: [
    async ({ playwright, connectOptions }, use) => {
      refuseRoundTheRulesAtEachLaunch(playwright, connectOptions);
      await use(playwright);
    },
    { scope: 'worker', box: true },
  ],
  handsOffBlocked: async ({}, use) => {
    await use([]);
  },
  context: async ({ context, handsOffBlocked, baseURL }, use) => {
    await guardContext(context, handsOffBlocked, use, baseURL);
  },
  request: async ({ request, handsOffBlocked, baseURL }, use) => {
    refuseHandsOffRequests(request, handsOffBlocked, baseURL);
    await use(request);
  },
});

export const test = guardedTest.extend<{ cspViolations: CspViolation[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const seen = await watchCsp(context);
      await use(seen);
      expect(seen, 'securitypolicyviolation events').toEqual([]);
    },
    { auto: true },
  ],
});
