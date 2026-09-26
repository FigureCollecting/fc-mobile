import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coordinatorEnv,
  DEFAULT_COORDINATOR_REF,
  detectSpineWire,
  prepareCheckout,
  resolveCheckout,
  startCoordinator,
} from '../src/coordinator.js';

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
    const dir = scratch();
    mkdirSync(path.join(dir, 'node_modules', 'tsx', 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), "console.error('boom: OIDC_ISSUER is required'); process.exit(3);\n");
    await expect(
      startCoordinator({ dir, env: { PATH: process.env['PATH'] ?? '' }, port: 1, logFile: path.join(dir, 'coordinator.log') }),
    ).rejects.toThrow(/exited with code 3[\s\S]*OIDC_ISSUER is required/);
  });

  it('fails when the checkout has no installed dependencies', async () => {
    await expect(startCoordinator({ dir: scratch(), env: {}, port: 1, logFile: path.join(scratch(), 'c.log') })).rejects.toThrow(
      /npm ci/,
    );
  });

  it('times out when nothing becomes healthy', async () => {
    const dir = scratch();
    mkdirSync(path.join(dir, 'node_modules', 'tsx', 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'setInterval(() => {}, 1000);\n');
    await expect(
      startCoordinator({ dir, env: {}, port: 9, logFile: path.join(dir, 'c.log'), healthTimeoutMs: 600 }),
    ).rejects.toThrow(/not healthy/);
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
