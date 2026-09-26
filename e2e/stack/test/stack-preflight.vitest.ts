// Where startStack runs its pre-flight: before the coordinator checkout and
// before any container. The starters are spies here, so a regression that
// moves the pre-flight later fails on the spy instead of starting Docker.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCheckout } from '../src/coordinator.js';
import { startPostgres } from '../src/postgres.js';
import { startStack } from '../src/stack.js';
import { startWeb } from '../src/web.js';
import { freePort, squat } from './procfixtures.js';

vi.mock('../src/coordinator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/coordinator.js')>()),
  prepareCheckout: vi.fn(() => {
    throw new Error('the coordinator checkout was prepared');
  }),
}));
vi.mock('../src/postgres.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/postgres.js')>()),
  startPostgres: vi.fn(async () => {
    throw new Error('postgres was started');
  }),
}));
vi.mock('../src/web.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/web.js')>()),
  startWeb: vi.fn(async () => {
    throw new Error('web was started');
  }),
}));

describe('stack start-up pre-flight', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it('refuses a held coordinator port before any checkout or container starts, keeping the last log as .1', async () => {
    const coordinatorPort = await freePort();
    const squatter = await squat(coordinatorPort);
    closers.push(() => squatter.close());
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-preflight-'));
    const log = path.join(stateDir, 'logs', 'coordinator.log');
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, 'the previous run\n');
    const lines: string[] = [];

    const outcome = await startStack({ portBase: coordinatorPort - 2, stateDir, log: (line) => lines.push(line) }).then(
      () => 'resolved',
      (err: Error) => err.message,
    );

    expect(outcome).toMatch(new RegExp(`^port ${coordinatorPort} is already in use.*npm run stack:down`));
    expect(vi.mocked(prepareCheckout)).not.toHaveBeenCalled();
    expect(vi.mocked(startPostgres)).not.toHaveBeenCalled();
    expect(vi.mocked(startWeb)).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('the previous run\n');
    expect(existsSync(log)).toBe(false);
  });
});
