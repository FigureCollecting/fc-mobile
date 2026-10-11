import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_CHECK_MS } from '../updates';

const ROOT = path.resolve(__dirname, '../../..');

/** The README's "## Updates" section, up to the next "## " heading. */
function updatesSection(): string {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = readme.indexOf('\n## Updates\n');
  expect(start, 'README has an "## Updates" section').toBeGreaterThanOrEqual(0);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

describe('README "Updates" states what the update code does', () => {
  it('names every check: hourly, on reconnect, on return to the foreground, and the Settings action', () => {
    const doc = updatesSection();
    expect(UPDATE_CHECK_MS).toBe(60 * 60 * 1000);
    expect(doc).toMatch(/every hour/);
    expect(doc).toMatch(/`online`/);
    expect(doc).toMatch(/`visibilitychange`/);
    expect(doc).toMatch(/\*\*Check for update\*\*/);
    expect(doc).toMatch(/backgrounded tab or a closed app/);
  });

  it('says plainly that no push and no periodic background sync is used, and the code registers none', () => {
    expect(updatesSection()).toMatch(/No push and no periodic background sync/);
    const src = path.join(ROOT, 'src');
    const code = (readdirSync(src, { recursive: true }) as string[]).filter(
      (f) => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f),
    );
    expect(code.length).toBeGreaterThan(0);
    for (const f of code) expect(readFileSync(path.join(src, f), 'utf8'), f).not.toMatch(/periodicSync|periodicsync/);
  });
});
