// Every e2e test runs under the shipped CSP and fails on any violation the
// page reports. The listener is installed before the app's first script.
import * as playwrightLibrary from '@playwright/test';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { guardContext, lockInheritedOptions, refuseHandsOffLookups, refuseHandsOffRequests, refuseRoundTheRules, refuseRoundTheRulesAtEachLaunch } from './handsOff';

export { expect };

// This worker's own DNS (Node's fetch and http, Playwright's API requests) has no address for a hands-off host.
refuseHandsOffLookups();
// Each launch in the worker, its own browser's and a spec's alike, from when this module loads: before the code of any spec that imports it, a launch taken as that spec loads included (the worker's playwright fixture is these same browser types).
// It checks the environment, Object.prototype, the options it starts from and a Chromium's args as it is called, and the first two again as it resolves (refuseRoundTheRulesAtEachLaunch); connecting to a browser, Electron and Android are refused.
refuseRoundTheRulesAtEachLaunch(playwrightLibrary, undefined);

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
  // No worker starts with a proxy in its environment, a variable that sends a launch elsewhere, or a browser to connect to: each goes round the resolver rules.
  // Nor with a name on Object.prototype, which then takes none for the rest of the worker: Playwright reads launch and context options inherited from it.
  handsOffWorker: [
    async ({ connectOptions }, use) => {
      refuseRoundTheRules(process.env, connectOptions);
      lockInheritedOptions();
      await use();
    },
    { scope: 'worker', auto: true },
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
