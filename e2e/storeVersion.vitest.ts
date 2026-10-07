// The stack's auth e2e stands in for a newer build by opening the local store one
// version up. It cannot import the store (Playwright does not bundle the app's ?raw
// imports), so this pins its literal to the store's version.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_DB_VERSION } from '../src/storage/localDb';

describe('the auth e2e newer build', () => {
  it('opens the local store one version above the one this build ships', () => {
    const spec = fs.readFileSync(path.join(import.meta.dirname, 'auth/auth.spec.ts'), 'utf8');
    const m = /^const NEWER_VERSION = (\d+);$/m.exec(spec);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LOCAL_DB_VERSION + 1);
  });
});
