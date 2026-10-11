import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../version';

describe('APP_VERSION', () => {
  it("is package.json's version, injected at build", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
