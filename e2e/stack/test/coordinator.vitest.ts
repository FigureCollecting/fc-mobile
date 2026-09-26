import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coordinatorEnv,
  DEFAULT_COORDINATOR_REF,
  detectSpineWire,
  prepareCheckout,
  reapCoordinator,
  refuseIfPortHeld,
  resolveCheckout,
  rotateLog,
  startCoordinator,
  type CoordinatorProcess,
} from '../src/coordinator.js';
import { STACK_ROOT } from '../src/paths.js';
import { portFree, processStartTime } from '../src/procs.js';
import {
  answers,
  FAKE_PID,
  fakeCoordinator,
  fakeProcRoot,
  fakeSignaller,
  FORKING,
  freePort,
  IDLE,
  IGNORES_SIGTERM,
  isAlive,
  ownSignaller,
  squat,
  waitFor,
} from './procfixtures.js';

const scratch = (): string => mkdtempSync(path.join(tmpdir(), 'stack-coord-'));

function checkoutWith(client: string | undefined): string {
  const dir = scratch();
  if (client !== undefined) {
    mkdirSync(path.join(dir, 'src', 'spine'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'spine', 'spineReadClient.ts'), client);
  }
  return dir;
}

describe('coordinator checkout resolution', () => {
  it('pins the default to a full develop sha', () => {
    expect(DEFAULT_COORDINATOR_REF).toMatch(/^[0-9a-f]{40}$/);
  });

  it('prefers an explicit directory, then the environment', () => {
    expect(resolveCheckout({ dir: '/w/coord' }, {}, '/cache')).toEqual({ dir: '/w/coord', source: 'dir' });
    expect(resolveCheckout({}, { FC_COORDINATOR_DIR: '/env/coord' }, '/cache')).toEqual({ dir: '/env/coord', source: 'dir' });
  });

  it('maps a ref to a cache directory, defaulting to the pinned sha and the org repo', () => {
    expect(resolveCheckout({}, {}, '/cache')).toEqual({
      dir: `/cache/fc-coordinator-${DEFAULT_COORDINATOR_REF.slice(0, 12)}`,
      source: 'ref',
      ref: DEFAULT_COORDINATOR_REF,
      repo: 'https://github.com/FigureCollecting/fc-coordinator.git',
    });
    expect(resolveCheckout({ ref: 'WK-05' }, { FC_COORDINATOR_REPO: 'https://example/fork.git' }, '/cache')).toMatchObject({
      dir: '/cache/fc-coordinator-WK-05',
      ref: 'WK-05',
      repo: 'https://example/fork.git',
    });
    expect(resolveCheckout({}, { FC_COORDINATOR_REF: 'feat/x y' }, '/c').dir).toBe('/c/fc-coordinator-feat_x_y');
  });
});

describe('spine wire detection', () => {
  it('reads h1 from the Connect-over-HTTP/1.1 client that develop ships', () => {
    const dir = checkoutWith(
      "import { createConnectTransport } from '@connectrpc/connect-node';\n// NEVER createGrpcTransport here\n",
    );
    expect(detectSpineWire(dir)).toBe('h1');
  });

  it('reads h2c once the client imports createGrpcTransport (R4d)', () => {
    const dir = checkoutWith("import {\n  createGrpcTransport,\n  Http2SessionManager,\n} from '@connectrpc/connect-node';\n");
    expect(detectSpineWire(dir)).toBe('h2c');
  });

  it('assumes the target h2c wire when the file is missing', () => {
    expect(detectSpineWire(checkoutWith(undefined))).toBe('h2c');
  });
});

describe('coordinator environment', () => {
  const env = coordinatorEnv(
    {
      port: 8482,
      databaseUrl: 'postgres://coordinator:pw@localhost:1/fccoord',
      issuer: 'http://127.0.0.1:8481/application/o/fc-coordinator/',
      audience: 'fc-coordinator',
      jwksUri: 'http://127.0.0.1:8481/application/o/fc-coordinator/jwks/',
      origin: 'http://localhost:8480',
      spineUrl: 'http://127.0.0.1:8483',
      openfga: { url: 'http://127.0.0.1:8485', storeId: 'stack-store', token: 'tok' },
      entitlement: { pem: 'PEM', kid: 'ent-stack' },
      extra: { MEDIA_PUBLIC_BASE_URL: 'http://localhost:8480/media' },
    },
    { PATH: '/usr/bin', HOME: '/home/x', DATABASE_URL: 'postgres://prod', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector' },
  );

  it('wires every dependency the coordinator reads', () => {
    expect(env).toMatchObject({
      COORDINATOR_PORT: '8482',
      COORDINATOR_HOST: '127.0.0.1',
      COORDINATOR_ROUTE_PREFIX: '/api',
      COORDINATOR_PUBLIC_ORIGIN: 'http://localhost:8480',
      DATABASE_URL: 'postgres://coordinator:pw@localhost:1/fccoord',
      PGSSLMODE: 'disable',
      OIDC_ISSUER: 'http://127.0.0.1:8481/application/o/fc-coordinator/',
      OIDC_AUDIENCE: 'fc-coordinator',
      OIDC_JWKS_URI: 'http://127.0.0.1:8481/application/o/fc-coordinator/jwks/',
      SPINE_READ_URL: 'http://127.0.0.1:8483',
      OPENFGA_GRPC_URL: 'http://127.0.0.1:8485',
      OPENFGA_STORE_ID: 'stack-store',
      OPENFGA_API_TOKEN: 'tok',
      ENTITLEMENT_SIGNING_KEY_PEM: 'PEM',
      ENTITLEMENT_SIGNING_KID: 'ent-stack',
      MEDIA_PUBLIC_BASE_URL: 'http://localhost:8480/media',
      PATH: '/usr/bin',
      HOME: '/home/x',
    });
  });

  it('never inherits a database or telemetry target from the parent shell', () => {
    expect(env['DATABASE_URL']).not.toBe('postgres://prod');
    expect(env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBeUndefined();
  });
});

describe('coordinator process', () => {
  it('fails with the log tail when the process exits before it is healthy', async () => {
    const dir = fakeCoordinator("console.error('boom: OIDC_ISSUER is required'); process.exit(3);\n");
    await expect(
      startCoordinator({ dir, env: { PATH: process.env['PATH'] ?? '' }, port: await freePort(), logFile: path.join(dir, 'coordinator.log') }),
    ).rejects.toThrow(/exited with code 3[\s\S]*OIDC_ISSUER is required/);
  });

  it('fails when the checkout has no installed dependencies', async () => {
    await expect(startCoordinator({ dir: scratch(), env: {}, port: 1, logFile: path.join(scratch(), 'c.log') })).rejects.toThrow(
      /npm ci/,
    );
  });

  it('times out when nothing becomes healthy, and kills what it started', async () => {
    const dir = fakeCoordinator(IDLE);
    const logFile = path.join(dir, 'c.log');
    await expect(startCoordinator({ dir, env: {}, port: await freePort(), logFile, healthTimeoutMs: 600 })).rejects.toThrow(/not healthy/);
    const pid = Number(/spawned (\d+)/.exec(readFileSync(logFile, 'utf8'))?.[1]);
    await waitFor(() => !isAlive(pid));
  });
});

describe('coordinator process ownership', () => {
  const started: CoordinatorProcess[] = [];
  const squatters: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    for (const c of started.splice(0)) await c.stop();
    for (const s of squatters.splice(0)) await s.close();
  });
  const env = (port: number): Record<string, string> => ({ PATH: process.env['PATH'] ?? '', COORDINATOR_PORT: String(port) });

  it('refuses to spawn when the port is already bound, and names the holder', async () => {
    const port = await freePort();
    squatters.push(await squat(port));
    const dir = fakeCoordinator(IDLE);
    const logFile = path.join(dir, 'c.log');
    const outcome = await startCoordinator({ dir, env: env(port), port, logFile, healthTimeoutMs: 5_000 }).then(
      (c) => (started.push(c), 'resolved'),
      (err: Error) => err.message,
    );
    expect(outcome).toMatch(new RegExp(`port ${port} is already in use`));
    expect(outcome).toMatch(/stack:down/);
    if (existsSync('/proc/net/tcp')) expect(outcome).toMatch(new RegExp(`pid ${process.pid}\\b`));
    expect(existsSync(logFile)).toBe(false);
  });

  it.skipIf(!existsSync('/proc/net/tcp'))('rejects a /healthz answer that does not come from its own child', async () => {
    const port = await freePort();
    const dir = fakeCoordinator(IDLE);
    const logFile = path.join(dir, 'c.log');
    const outcome = startCoordinator({ dir, env: env(port), port, logFile, healthTimeoutMs: 20_000 }).then(
      (c) => (started.push(c), 'resolved'),
      (err: Error) => err.message,
    );
    await waitFor(() => existsSync(logFile) && readFileSync(logFile, 'utf8').includes('spawned'));
    squatters.push(await squat(port));
    expect(await outcome).toMatch(/answered, but the listener is not the coordinator this stack started \(pid \d+\)/);
    const pid = Number(/spawned (\d+)/.exec(readFileSync(logFile, 'utf8'))?.[1]);
    await waitFor(() => !isAlive(pid));
  });

  it('stops the whole process group with SIGTERM, so the listener drains even when the leader does not relay', async () => {
    const port = await freePort();
    const logFile = path.join(scratch(), 'c.log');
    const coordinator = await startCoordinator({ dir: fakeCoordinator(FORKING), env: env(port), port, logFile });
    started.push(coordinator);
    expect(await answers(port)).toBe(true);
    await coordinator.stop();
    expect(coordinator.running()).toBe(false);
    expect(await answers(port)).toBe(false);
    expect(readFileSync(logFile, 'utf8')).toMatch(/drained \d+/);
  });

  it('records its pid, start time and checkout in the pid file while it runs', async () => {
    const port = await freePort();
    const dir = fakeCoordinator(FORKING);
    const pidFile = path.join(scratch(), 'coordinator.pid');
    const coordinator = await startCoordinator({ dir, env: env(port), port, logFile: path.join(scratch(), 'c.log'), pidFile });
    started.push(coordinator);
    const identity = JSON.parse(readFileSync(pidFile, 'utf8')) as { pid: number; startTime: number; needle: string };
    expect(identity.pid).toBe(coordinator.pid());
    expect(typeof identity.startTime).toBe('number');
    expect(identity.needle).toContain(dir);
    await coordinator.restart();
    const after = JSON.parse(readFileSync(pidFile, 'utf8')) as { pid: number };
    expect(after.pid).toBe(coordinator.pid());
    expect(after.pid).not.toBe(identity.pid);
    await coordinator.stop();
    expect(existsSync(pidFile)).toBe(false);
    expect(coordinator.pid()).toBeUndefined();
  });

  it('warns, and records nothing, when it cannot read the process identity (no /proc)', async () => {
    const port = await freePort();
    const pidFile = path.join(scratch(), 'coordinator.pid');
    const lines: string[] = [];
    const coordinator = await startCoordinator({
      dir: fakeCoordinator(FORKING),
      env: env(port),
      port,
      logFile: path.join(scratch(), 'c.log'),
      pidFile,
      procRoot: scratch(),
      log: (line) => lines.push(line),
    });
    started.push(coordinator);
    expect(existsSync(pidFile)).toBe(false);
    expect(lines).toEqual([expect.stringMatching(new RegExp(`cannot record coordinator pid ${coordinator.pid()}.*Linux-only.*stack:down`))]);
  });

  it('prints that warning on stderr when no log is given', async () => {
    const port = await freePort();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const options = { dir: fakeCoordinator(FORKING), env: env(port), port, logFile: path.join(scratch(), 'c.log') };
      started.push(await startCoordinator({ ...options, pidFile: path.join(scratch(), 'coordinator.pid'), procRoot: scratch() }));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[stack\] cannot record coordinator pid \d+/));
    } finally {
      warn.mockRestore();
    }
  });

  it('kills the group when the leader dies on its own and leaves a child behind', async () => {
    const port = await freePort();
    const pidFile = path.join(scratch(), 'coordinator.pid');
    const coordinator = await startCoordinator({ dir: fakeCoordinator(FORKING), env: env(port), port, logFile: path.join(scratch(), 'c.log'), pidFile });
    started.push(coordinator);
    process.kill(coordinator.pid() as number, 'SIGKILL');
    await waitFor(() => !coordinator.running());
    await waitFor(async () => !(await answers(port)), 5_000);
    await waitFor(() => !existsSync(pidFile), 5_000);
  });
});

describe('reaping a coordinator whose stack is gone', () => {
  const dir = scratch();
  // stop() signals only the group its own startCoordinator spawned: cleanup after a failed assertion.
  const orphans: CoordinatorProcess[] = [];
  afterEach(async () => {
    for (const c of orphans.splice(0)) await c.stop();
  });
  // What the pid file records: this checkout's coordinator directory.
  const NEEDLE = '/checkouts/this/fc-coordinator-abc/';
  const record = (name: string, identity: unknown): string => {
    const file = path.join(dir, name);
    writeFileSync(file, typeof identity === 'string' ? identity : JSON.stringify(identity));
    return file;
  };
  const leaderArgv = ['node', `${NEEDLE}node_modules/tsx/dist/cli.mjs`, 'src/server.ts'];
  const forkedArgv = ['node', '--require', `${NEEDLE}node_modules/tsx/dist/preflight.cjs`, 'src/server.ts'];
  // Delivers SIGTERM, then reports the group gone.
  const obliging = () => fakeSignaller((_t, signal) => signal === 'SIGTERM');

  it('does nothing without a pid file, and clears an unreadable one', async () => {
    const kill = fakeSignaller();
    expect(await reapCoordinator(path.join(dir, 'none.pid'), { kill })).toBeUndefined();
    const junk = record('junk.pid', 'not a pid\n');
    expect(await reapCoordinator(junk, { kill })).toBeUndefined();
    expect(existsSync(junk)).toBe(false);
    expect(kill.calls).toEqual([]);
  });

  it('clears a pid file whose identity is malformed, incomplete or names pid 0/1', async () => {
    const kill = fakeSignaller();
    for (const identity of [{ pid: 'not-a-number' }, { pid: 12345 }, { pid: 1, startTime: 1, needle: NEEDLE }, '1\n', '0\n']) {
      const file = record('bad.pid', identity);
      expect(await reapCoordinator(file, { kill })).toBeUndefined();
      expect(existsSync(file)).toBe(false);
    }
    expect(kill.calls).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)('clears a pid file it cannot read', async () => {
    const kill = fakeSignaller();
    const file = record('unreadable.pid', `${FAKE_PID}\n`);
    chmodSync(file, 0o000);
    expect(await reapCoordinator(file, { kill })).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    expect(kill.calls).toEqual([]);
  });

  it('reports a recorded group that already exited, and clears its pid file', async () => {
    const kill = fakeSignaller();
    const gone = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
    const stale = record('stale.pid', { pid: gone, startTime: 1, needle: NEEDLE });
    expect(await reapCoordinator(stale, { kill })).toEqual({ pid: gone, outcome: 'gone' });
    expect(existsSync(stale)).toBe(false);
    expect(kill.calls).toEqual([]);
  });

  it('never signals a live pid whose start time moved on: the pid was reused', async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID]: { start: 999, argv: leaderArgv } });
    const kill = fakeSignaller();
    const file = record('reused.pid', { pid: FAKE_PID, startTime: 777, needle: NEEDLE });
    expect(await reapCoordinator(file, { procRoot, kill })).toEqual({ pid: FAKE_PID, outcome: 'gone' });
    expect(kill.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("never signals a live pid whose cmdline does not name this checkout's coordinator", async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID]: { start: 999, argv: ['node', '/elsewhere/server.js'] } });
    const kill = fakeSignaller();
    const file = record('foreign.pid', { pid: FAKE_PID, startTime: 999, needle: NEEDLE });
    expect(await reapCoordinator(file, { procRoot, kill })).toEqual({ pid: FAKE_PID, outcome: 'gone' });
    expect(kill.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('signals the group only through the injected signaller once start time and cmdline both match', async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID]: { start: 999, argv: leaderArgv } });
    const kill = obliging();
    const file = record('match.pid', { pid: FAKE_PID, startTime: 999, needle: NEEDLE });
    expect(await reapCoordinator(file, { procRoot, kill })).toEqual({ pid: FAKE_PID, outcome: 'stopped' });
    expect(kill.calls).toEqual([
      { target: -FAKE_PID, signal: 'SIGTERM' },
      { target: -FAKE_PID, signal: 0 },
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it('stops an orphaned group whose leader died alone, found by a member naming this checkout', async () => {
    const zombie = { [FAKE_PID]: { start: 999, state: 'Z', argv: [] } };
    for (const leader of [{}, zombie]) {
      const procRoot = fakeProcRoot({
        ...leader,
        [FAKE_PID + 1]: { pgrp: FAKE_PID, start: 1_000, argv: forkedArgv },
        [FAKE_PID + 2]: { start: 1_001, argv: forkedArgv },
      });
      const kill = obliging();
      const file = record('orphan.pid', { pid: FAKE_PID, startTime: 999, needle: NEEDLE });
      expect(await reapCoordinator(file, { procRoot, kill })).toEqual({ pid: FAKE_PID, outcome: 'stopped' });
      expect(kill.calls[0]).toEqual({ target: -FAKE_PID, signal: 'SIGTERM' });
      expect(existsSync(file)).toBe(false);
    }
  });

  it("leaves a leaderless group alone when no member names this checkout's coordinator", async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID + 1]: { pgrp: FAKE_PID, start: 1_000, argv: ['node', '/elsewhere/worker.js'] } });
    const kill = fakeSignaller();
    const file = record('strangers.pid', { pid: FAKE_PID, startTime: 999, needle: NEEDLE });
    expect(await reapCoordinator(file, { procRoot, kill })).toEqual({ pid: FAKE_PID, outcome: 'gone' });
    expect(kill.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('keeps the pid file while the group survives SIGKILL', async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID]: { start: 999, argv: leaderArgv } });
    const kill = fakeSignaller(() => true);
    const file = record('stuck.pid', { pid: FAKE_PID, startTime: 999, needle: NEEDLE });
    expect(await reapCoordinator(file, { procRoot, kill, graceMs: 50, killWaitMs: 50 })).toEqual({ pid: FAKE_PID, outcome: 'stuck' });
    expect(kill.calls.filter((c) => c.signal !== 0)).toEqual([
      { target: -FAKE_PID, signal: 'SIGTERM' },
      { target: -FAKE_PID, signal: 'SIGKILL' },
    ]);
    expect(existsSync(file)).toBe(true);
  });

  it('checks a legacy plain-integer pid file against the coordinator directories before signalling', async () => {
    const procRoot = fakeProcRoot({ [FAKE_PID]: { start: 999, argv: leaderArgv } });
    const foreign = fakeSignaller();
    const file = record('legacy.pid', `${FAKE_PID}\n`);
    expect(await reapCoordinator(file, { procRoot, kill: foreign, legacyNeedles: ['/checkouts/other/'] })).toEqual({ pid: FAKE_PID, outcome: 'gone' });
    expect(foreign.calls).toEqual([]);
    expect(existsSync(file)).toBe(false);

    const kill = obliging();
    record('legacy.pid', `${FAKE_PID}\n`);
    expect(await reapCoordinator(file, { procRoot, kill, legacyNeedles: ['/checkouts/other/', NEEDLE] })).toEqual({ pid: FAKE_PID, outcome: 'stopped' });
    expect(kill.calls[0]).toEqual({ target: -FAKE_PID, signal: 'SIGTERM' });
  });

  it('leaves a real process with the right cmdline but a different start time alive', async () => {
    const checkout = fakeCoordinator(IDLE);
    const child = spawn(process.execPath, [path.join(checkout, 'node_modules', 'tsx', 'dist', 'cli.mjs')], { detached: true, stdio: 'ignore' });
    const pid = child.pid as number;
    try {
      await waitFor(() => processStartTime(pid) !== undefined);
      const kill = ownSignaller();
      kill.own(pid);
      const file = record('real-reused.pid', { pid, startTime: (processStartTime(pid) as number) + 1, needle: `${checkout}${path.sep}` });
      expect(await reapCoordinator(file, { kill })).toEqual({ pid, outcome: 'gone' });
      expect(kill.calls).toEqual([]);
      expect(existsSync(file)).toBe(false);
      expect(isAlive(pid)).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('stops a real orphaned group after its stack and then its leader were killed', async () => {
    const stateDir = scratch();
    const port = await freePort();
    const host = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(STACK_ROOT, 'test', 'fixtures', 'crash', 'host.ts'), fakeCoordinator(FORKING), String(port), stateDir],
      { cwd: STACK_ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    host.stdout.on('data', (b: Buffer) => (out += b.toString()));
    const pidFile = path.join(stateDir, 'coordinator.pid');
    const kill = ownSignaller();
    let pid = 0;
    try {
      await waitFor(() => out.includes('up') || host.exitCode !== null, 30_000);
      pid = (JSON.parse(readFileSync(pidFile, 'utf8')) as { pid: number }).pid;
      kill.ownGroup(pid);
      expect(kill.members(pid).length).toBeGreaterThan(1);
      host.kill('SIGKILL');
      await once(host, 'exit');
      kill.killOwned(pid);
      // Dead, or a zombie its new parent has not reaped yet: either way the leader is gone.
      await waitFor(() => {
        try {
          return /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
        } catch {
          return true;
        }
      });
      expect(await answers(port)).toBe(true);

      expect(await reapCoordinator(pidFile, { kill, graceMs: 5_000 })).toEqual({ pid, outcome: 'stopped' });
      expect(kill.calls[0]).toEqual({ target: -pid, signal: 'SIGTERM' });
      expect(await answers(port)).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      host.kill('SIGKILL');
      if (pid > 1 && kill.members(pid).length > 0) kill(-pid, 'SIGKILL');
    }
  }, 60_000);

  it('SIGTERMs a live group, and SIGKILLs one that ignores it', async () => {
    for (const [script, outcome] of [
      [FORKING, 'stopped'],
      [IGNORES_SIGTERM, 'killed'],
    ] as const) {
      const port = await freePort();
      const pidFile = path.join(scratch(), 'coordinator.pid');
      const orphan = await startCoordinator({
        dir: fakeCoordinator(script),
        env: { PATH: process.env['PATH'] ?? '', COORDINATOR_PORT: String(port) },
        port,
        logFile: path.join(scratch(), 'c.log'),
        pidFile,
      });
      orphans.push(orphan);
      const pid = orphan.pid() as number;
      const kill = ownSignaller();
      kill.ownGroup(pid);
      expect(await reapCoordinator(pidFile, { kill, graceMs: 1_000 })).toEqual({ pid, outcome });
      expect(await answers(port)).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
    }
  });
});

describe('log rotation', () => {
  it('renames an existing log to .1 instead of deleting it, and is a no-op without one', () => {
    const file = path.join(scratch(), 'coordinator.log');
    writeFileSync(file, 'previous run\n');
    rotateLog(file);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('previous run\n');

    // A second rotation with no current log must not touch the old .1.
    rotateLog(file);
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('previous run\n');
  });
});

describe('port refusal', () => {
  it('passes silently when the port is free', async () => {
    await expect(refuseIfPortHeld(await freePort())).resolves.toBeUndefined();
  });

  it('names the checkout to run stack:down in, for a holder inside this checkout', async () => {
    const port = await freePort();
    const squatter = await squat(port); // in-process: its cwd is this checkout's own STACK_ROOT
    try {
      const message = await refuseIfPortHeld(port).then(() => 'resolved', (err: Error) => err.message);
      expect(message).toMatch(/port \d+ is already in use/);
      expect(message).toMatch(/run `npm run stack:down` in the checkout that started it$/);
    } finally {
      await squatter.close();
    }
  });

  /** A listener on port whose cwd is dir; killed after the test. */
  async function holderIn(dir: string, port: number) {
    mkdirSync(dir, { recursive: true });
    const child = spawn(
      process.execPath,
      ['-e', `require('node:http').createServer((_q,r)=>r.end('ok')).listen(${port}, '127.0.0.1')`],
      { cwd: dir, stdio: 'ignore' },
    );
    await waitFor(async () => !(await portFree(port)));
    return child;
  }
  const refusal = (port: number): Promise<string> => refuseIfPortHeld(port).then(() => 'resolved', (err: Error) => err.message);

  it.skipIf(!existsSync('/proc/net/tcp'))("names the other harness checkout when the holder runs from that checkout's coordinator cache", async () => {
    const port = await freePort();
    const other = realpathSync(scratch());
    const child = await holderIn(path.join(other, 'e2e', 'stack', 'node_modules', '.cache', 'fc-mobile-stack', 'fc-coordinator-c0db861c7cc7'), port);
    try {
      const message = await refusal(port);
      expect(message).toContain(`run \`npm run stack:down\` in the checkout that started it (that checkout is ${other})`);
      expect(message).not.toContain('runs from');
    } finally {
      child.kill('SIGKILL');
    }
  });

  it.skipIf(!existsSync('/proc/net/tcp'))('says where the coordinator runs from when no harness checkout can be recovered (FC_COORDINATOR_DIR)', async () => {
    const port = await freePort();
    const worktree = path.join(realpathSync(scratch()), 'fc-coordinator-wk05');
    const child = await holderIn(worktree, port);
    try {
      const message = await refusal(port);
      expect(message).toContain(`(the coordinator runs from ${worktree})`);
      expect(message).not.toContain('that checkout is');
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('coordinator checkout preparation', () => {
  function upstreamRepo(): { dir: string; sha: string } {
    const dir = scratch();
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake-coordinator', version: '0.0.0', private: true }));
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=stack', '-c', 'user.email=stack@test', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], { cwd: dir });
    git('init', '-q', '-b', 'develop');
    git('add', '.');
    git('commit', '-q', '-m', 'fixture');
    return { dir, sha: git('rev-parse', 'HEAD') };
  }

  it('fetches a ref, installs once, and skips the install while the lockfile is unchanged', () => {
    const upstream = upstreamRepo();
    const checkout = resolveCheckout({ ref: upstream.sha }, { FC_COORDINATOR_REPO: upstream.dir }, scratch());
    prepareCheckout(checkout);
    const marker = path.join(checkout.dir, 'node_modules', '.stack-lock-sha256');
    expect(existsSync(marker)).toBe(true);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout.dir, encoding: 'utf8' }).trim()).toBe(upstream.sha);
    const stamp = statSync(marker).mtimeMs;
    prepareCheckout(checkout);
    expect(statSync(marker).mtimeMs).toBe(stamp);
  });

  it('leaves a working directory with node_modules alone and installs into one without', () => {
    const upstream = upstreamRepo();
    mkdirSync(path.join(upstream.dir, 'node_modules'));
    prepareCheckout({ dir: upstream.dir, source: 'dir' });
    expect(existsSync(path.join(upstream.dir, 'node_modules', '.stack-lock-sha256'))).toBe(false);

    const bare = upstreamRepo();
    prepareCheckout({ dir: bare.dir, source: 'dir' });
    expect(existsSync(path.join(bare.dir, 'node_modules', '.stack-lock-sha256'))).toBe(true);
  });

  it('names the failing git step for a ref that does not exist', () => {
    const upstream = upstreamRepo();
    const checkout = resolveCheckout({ ref: 'no-such-branch' }, { FC_COORDINATOR_REPO: upstream.dir }, scratch());
    expect(() => prepareCheckout(checkout)).toThrow(/git fetch .* failed/);
  });
});
