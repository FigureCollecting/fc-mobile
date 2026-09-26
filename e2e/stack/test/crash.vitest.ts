// A stack that dies without running its teardown (SIGKILL, OOM) leaves the
// coordinator it spawned listening. `stack:down` has to find and stop it.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STACK_ROOT } from '../src/paths.js';
import { answers, fakeCoordinator, FORKING, freePort, waitFor } from './procfixtures.js';

const tsx = (script: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: STACK_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

describe('a crashed stack', () => {
  it('leaves its coordinator listening, and stack:down stops it', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-crash-'));
    const port = await freePort();
    const host = tsx(path.join(STACK_ROOT, 'test', 'fixtures', 'crash', 'host.ts'), [fakeCoordinator(FORKING), String(port), stateDir]);
    let out = '';
    host.stdout.on('data', (b: Buffer) => (out += b.toString()));
    host.stderr.on('data', (b: Buffer) => (out += b.toString()));
    await waitFor(() => out.includes('up') || host.exitCode !== null, 30_000);
    expect(out).toContain('up');

    host.kill('SIGKILL');
    await once(host, 'exit');
    expect(await answers(port)).toBe(true);

    const down = spawnSync(process.execPath, ['--import', 'tsx', path.join(STACK_ROOT, 'src', 'cli.ts'), 'down'], {
      cwd: STACK_ROOT,
      env: { ...process.env, FC_STACK_STATE_DIR: stateDir },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(down.status, down.stderr).toBe(0);
    expect(await answers(port)).toBe(false);
    expect(down.stdout).toMatch(/coordinator pid \d+ .*stopped/);
    expect(down.stdout).toMatch(/stack is down/);
    expect(existsSync(path.join(stateDir, 'stack.json'))).toBe(false);
    expect(existsSync(path.join(stateDir, 'coordinator.pid'))).toBe(false);
  }, 90_000);
});
