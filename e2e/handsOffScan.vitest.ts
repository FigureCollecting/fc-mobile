import { describe, expect, it } from 'vitest';
import { e2eSources, unguardedSites } from './handsOffScan';

describe('every browser context the e2e suites open is guarded', () => {
  const sources = e2eSources(import.meta.dirname);

  it('finds the specs', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(['fixtures.ts', 'auth/auth.spec.ts', 'pwa/pwa.spec.ts']));
  });

  it('finds nothing unguarded in any of them', () => {
    expect(sources.flatMap(unguardedSites)).toEqual([]);
  });
});
