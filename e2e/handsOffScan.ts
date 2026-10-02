import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Source {
  /** Relative to the e2e directory, with forward slashes. */
  file: string;
  code: string;
}

/** Every e2e source file under `root` the static check reads. */
export function e2eSources(root: string): Source[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.vitest.ts') && !f.split(path.sep).includes('node_modules'))
    .map((f) => ({ file: f.split(path.sep).join('/'), code: readFileSync(path.join(root, f), 'utf8') }));
}

/**
 * What keeps one e2e source file off the hands-off guard (e2e/handsOff.ts):
 * taking `test` straight from @playwright/test instead of e2e/fixtures.ts, or
 * launching a browser or opening a context with no blockHandsOff.
 */
export function unguardedSites({ file, code }: Source): string[] {
  const found: string[] = [];
  const direct =
    file !== 'fixtures.ts' &&
    Array.from(code.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'@playwright\/test'/gm)).some((m) => m[1]!.split(',').some((spec) => /^test\b/.test(spec.trim())));
  if (direct) found.push(`${file}: takes test straight from @playwright/test`);
  if (/\.(launch|launchPersistentContext|newContext)\(/.test(code) && !/\bblockHandsOff\(/.test(code)) {
    found.push(`${file}: launches a browser or opens a context with no blockHandsOff`);
  }
  return found;
}
