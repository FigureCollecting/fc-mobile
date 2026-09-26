// Where startStack runs its pre-flight: the port refusal first, with no side
// effects, then the log rotation, both before the checkout and any container.
// The starters are spies, so moving either step later fails on a spy.
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

  const seededState = (): { stateDir: string; log: string } => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-preflight-'));
    const log = path.join(stateDir, 'logs', 'coordinator.log');
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, 'the previous run\n');
    writeFileSync(`${log}.1`, 'an older run\n');
    return { stateDir, log };
  };

  it('refuses a held coordinator port before any checkout or container starts, touching no log', async () => {
    const coordinatorPort = await freePort();
    const squatter = await squat(coordinatorPort);
    closers.push(() => squatter.close());
    const { stateDir, log } = seededState();
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
    // A refused start may be this checkout's own live stack: its log stays put.
    expect(readFileSync(log, 'utf8')).toBe('the previous run\n');
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('an older run\n');
    const fresh = path.join(mkdtempSync(path.join(tmpdir(), 'stack-preflight-')), 'state');
    await expect(startStack({ portBase: coordinatorPort - 2, stateDir: fresh, log: () => {} })).rejects.toThrow(/already in use/);
    expect(existsSync(fresh)).toBe(false);
  });

  it('rotates the last coordinator log to .1 before the checkout, once the port is free', async () => {
    const coordinatorPort = await freePort();
    const { stateDir, log } = seededState();
    const seen: Array<{ current: boolean; previous: string }> = [];
    vi.mocked(prepareCheckout).mockImplementationOnce(() => {
      seen.push({ current: existsSync(log), previous: readFileSync(`${log}.1`, 'utf8') });
      throw new Error('stopped at the checkout');
    });

    const outcome = await startStack({ portBase: coordinatorPort - 2, stateDir, log: () => {} }).then(
      () => 'resolved',
      (err: Error) => err.message,
    );

    expect(outcome).toBe('stopped at the checkout');
    expect(seen).toEqual([{ current: false, previous: 'the previous run\n' }]);
    expect(vi.mocked(startPostgres)).not.toHaveBeenCalled();
  });
});
