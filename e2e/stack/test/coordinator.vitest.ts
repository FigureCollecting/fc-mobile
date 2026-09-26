import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  coordinatorEnv,
  DEFAULT_COORDINATOR_REF,
  detectSpineWire,
  prepareCheckout,
  reapCoordinator,
  resolveCheckout,
  startCoordinator,
  type CoordinatorProcess,
} from '../src/coordinator.js';
import { answers, fakeCoordinator, FORKING, freePort, IDLE, IGNORES_SIGTERM, isAlive, squat, waitFor } from './procfixtures.js';

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

  it('records its process group in the pid file while it runs', async () => {
    const port = await freePort();
    const pidFile = path.join(scratch(), 'coordinator.pid');
    const coordinator = await startCoordinator({ dir: fakeCoordinator(FORKING), env: env(port), port, logFile: path.join(scratch(), 'c.log'), pidFile });
    started.push(coordinator);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(pid).toBe(coordinator.pid());
    await coordinator.restart();
    expect(Number(readFileSync(pidFile, 'utf8'))).toBe(coordinator.pid());
    expect(coordinator.pid()).not.toBe(pid);
    await coordinator.stop();
    expect(existsSync(pidFile)).toBe(false);
    expect(coordinator.pid()).toBeUndefined();
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

  it('does nothing without a pid file, and clears an unreadable one', async () => {
    expect(await reapCoordinator(path.join(dir, 'none.pid'))).toBeUndefined();
    const junk = path.join(dir, 'junk.pid');
    writeFileSync(junk, 'not a pid\n');
    expect(await reapCoordinator(junk)).toBeUndefined();
    expect(existsSync(junk)).toBe(false);
  });

  it('reports a recorded group that already exited, and clears its pid file', async () => {
    const stale = path.join(dir, 'stale.pid');
    const gone = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    writeFileSync(stale, `${gone}\n`);
    expect(await reapCoordinator(stale)).toEqual({ pid: Number(gone), outcome: 'gone' });
    expect(existsSync(stale)).toBe(false);
  });

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
      const pid = orphan.pid() as number;
      expect(await reapCoordinator(pidFile, 1_000)).toEqual({ pid, outcome });
      expect(await answers(port)).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
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
