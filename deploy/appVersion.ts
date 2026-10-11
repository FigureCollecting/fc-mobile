// The app version is package.json's and nothing else's: vite.config.ts (every build) and
// vitest.config.ts (the tests) inject it as __APP_VERSION__, declared in src/vite-env.d.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

/** The `define` entry that replaces __APP_VERSION__ with package.json's version. */
export function appVersionDefine(): { __APP_VERSION__: string } {
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
  return { __APP_VERSION__: JSON.stringify(version) };
}
