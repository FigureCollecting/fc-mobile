// The real fc-coordinator, run from a checkout through tsx. A directory
// (a WK branch worktree) or a git ref of FigureCollecting/fc-coordinator; the
// default is a pinned develop sha so the stack is reproducible.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_COORDINATOR_REF = 'c0db861c7cc7d775f5f05a9e1acc8e41201c6a43';
export const DEFAULT_COORDINATOR_REPO = 'https://github.com/FigureCollecting/fc-coordinator.git';

export type Env = Record<string, string | undefined>;

export type Checkout =
  | { dir: string; source: 'dir' }
  | { dir: string; source: 'ref'; ref: string; repo: string };

export function resolveCheckout(options: { dir?: string; ref?: string }, env: Env, cacheDir: string): Checkout {
  const dir = options.dir ?? env['FC_COORDINATOR_DIR'];
  if (dir !== undefined && dir !== '') return { dir, source: 'dir' };
  const ref = options.ref ?? env['FC_COORDINATOR_REF'] ?? DEFAULT_COORDINATOR_REF;
  const label = /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 12) : ref.replace(/[^A-Za-z0-9._-]/g, '_');
  return {
    dir: path.join(cacheDir, `fc-coordinator-${label}`),
    source: 'ref',
    ref,
    repo: env['FC_COORDINATOR_REPO'] ?? DEFAULT_COORDINATOR_REPO,
  };
}

function run(cmd: string, args: string[], cwd: string, env: Env = process.env): void {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

/** Fetch the ref (a ref checkout only) and install dependencies when the lockfile changed. */
export function prepareCheckout(checkout: Checkout, env: Env = process.env): void {
  if (checkout.source === 'ref') {
    mkdirSync(checkout.dir, { recursive: true });
    if (!existsSync(path.join(checkout.dir, '.git'))) {
      run('git', ['init', '-q'], checkout.dir);
      run('git', ['remote', 'add', 'origin', checkout.repo], checkout.dir);
    }
    run('git', ['fetch', '-q', '--depth', '1', 'origin', checkout.ref], checkout.dir);
    run('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], checkout.dir);
  }
  const lock = path.join(checkout.dir, 'package-lock.json');
  const marker = path.join(checkout.dir, 'node_modules', '.stack-lock-sha256');
  const wanted = createHash('sha256').update(readFileSync(lock)).digest('hex');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === wanted) return;
  if (checkout.source === 'dir' && existsSync(path.join(checkout.dir, 'node_modules'))) return;
  run('npm', ['ci', '--no-audit', '--no-fund'], checkout.dir, env);
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, wanted);
}

/** h2c once the checkout's spine client imports createGrpcTransport (R4d), else Connect over h1. */
export function detectSpineWire(dir: string): 'h2c' | 'h1' {
  const file = path.join(dir, 'src', 'spine', 'spineReadClient.ts');
  if (!existsSync(file)) return 'h2c';
  const source = readFileSync(file, 'utf8');
  const imports = /import\s*\{([^}]*)\}\s*from\s*'@connectrpc\/connect-node'/g;
  for (const match of source.matchAll(imports)) {
    if (/\bcreateGrpcTransport\b/.test(match[1] as string)) return 'h2c';
  }
  return 'h1';
}

export interface CoordinatorWiring {
  port: number;
  databaseUrl: string;
  issuer: string;
  audience: string;
  jwksUri: string;
  origin: string;
  spineUrl: string;
  openfga: { url: string; storeId: string; token: string };
  entitlement: { pem: string; kid: string };
  extra?: Record<string, string>;
}

/** A clean environment: only PATH/HOME/TMPDIR are inherited, never a database or collector. */
export function coordinatorEnv(w: CoordinatorWiring, parent: Env = process.env): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR']) {
    const value = parent[key];
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    COORDINATOR_PORT: String(w.port),
    COORDINATOR_HOST: '127.0.0.1',
    COORDINATOR_ROUTE_PREFIX: '/api',
    COORDINATOR_PUBLIC_ORIGIN: w.origin,
    LOG_LEVEL: 'info',
    SERVICE_VERSION: 'stack',
    DATABASE_URL: w.databaseUrl,
    PGSSLMODE: 'disable',
    OIDC_ISSUER: w.issuer,
    OIDC_AUDIENCE: w.audience,
    OIDC_JWKS_URI: w.jwksUri,
    SPINE_READ_URL: w.spineUrl,
    OPENFGA_GRPC_URL: w.openfga.url,
    OPENFGA_STORE_ID: w.openfga.storeId,
    OPENFGA_API_TOKEN: w.openfga.token,
    ENTITLEMENT_SIGNING_KEY_PEM: w.entitlement.pem,
    ENTITLEMENT_SIGNING_KID: w.entitlement.kid,
    ...(w.extra ?? {}),
  };
}

export interface CoordinatorProcessOptions {
  dir: string;
  env: Record<string, string>;
  port: number;
  logFile: string;
  healthTimeoutMs?: number;
}

export interface CoordinatorProcess {
  url: string;
  running(): boolean;
  stop(): Promise<void>;
  start(): Promise<void>;
  restart(): Promise<void>;
}

const tail = (file: string, lines = 40): string =>
  existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n') : '';

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function startCoordinator(options: CoordinatorProcessOptions): Promise<CoordinatorProcess> {
  const cli = path.join(options.dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(cli)) throw new Error(`no tsx in ${options.dir}; run npm ci there first`);
  const url = `http://127.0.0.1:${options.port}`;
  let child: ChildProcess | undefined;

  const start = async (): Promise<void> => {
    const fd = openSync(options.logFile, 'a');
    const proc = spawn(process.execPath, [cli, 'src/server.ts'], {
      cwd: options.dir,
      env: options.env,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    child = proc;
    let exitCode: number | null = null;
    proc.once('exit', (code) => {
      exitCode = code ?? -1;
      if (child === proc) child = undefined;
    });
    const deadline = Date.now() + (options.healthTimeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      if (exitCode !== null) {
        throw new Error(`coordinator exited with code ${String(exitCode)} before it was healthy:\n${tail(options.logFile)}`);
      }
      if (await healthy(url)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    proc.kill('SIGKILL');
    throw new Error(`coordinator not healthy at ${url} after ${options.healthTimeoutMs ?? 90_000} ms:\n${tail(options.logFile)}`);
  };

  const stop = async (): Promise<void> => {
    const proc = child;
    if (proc === undefined) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => proc.kill('SIGKILL'), 12_000);
      proc.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  };

  await start();
  return {
    url,
    running: () => child !== undefined,
    stop,
    start: async () => {
      if (child === undefined) await start();
    },
    restart: async () => {
      await stop();
      await start();
    },
  };
}
