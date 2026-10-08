// The real fc-coordinator, run from a checkout through tsx. A directory
// (a WK branch worktree) or a git ref of FigureCollecting/fc-coordinator; the
// default is a pinned develop sha so the stack is reproducible.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, REPO_ROOT } from './paths.js';
import {
  cmdlineIncludes,
  describePid,
  groupMembers,
  identifyProcess,
  isZombie,
  killSignaller,
  portFree,
  portHolders,
  processCwd,
  processGroup,
  processStartTime,
  signalGroup,
  waitGroupGone,
  type ProcessIdentity,
  type Signaller,
} from './procs.js';

// develop c7723a3 (WK-14a, #21): SyncService and CatalogService on contract 0.3.0, with WK-05c
// (#20, dc77344): commit_cursor on Delta (sync.proto rule 7), basis required on Push, HELD.
export const DEFAULT_COORDINATOR_REF = 'c7723a32522f58fb3f8a06145218c47f60a840c4';
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
  /** Records the running coordinator's process group, so `stack:down` can stop it after a crash. */
  pidFile?: string;
  healthTimeoutMs?: number;
  procRoot?: string;
  log?: (line: string) => void;
}

export interface CoordinatorProcess {
  url: string;
  /** The coordinator's process group (its leader's pid); undefined while stopped. */
  pid(): number | undefined;
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

function holders(port: number): string {
  const pids = portHolders(port);
  if (pids === undefined) return '';
  if (pids.length === 0) return ' by a process this user cannot inspect';
  return ` by ${pids.map((pid) => describePid(pid)).join(', ')}`;
}

// A ref coordinator runs from <harness checkout>/e2e/stack/node_modules/.cache/fc-mobile-stack/<ref>.
const CACHE_LAYOUT = path.join(path.sep, path.relative(REPO_ROOT, CACHE_DIR), path.sep);
// /proc reports a resolved cwd, so compare against the resolved checkout.
const THIS_CHECKOUT = realpathSync(REPO_ROOT);

/** Where a holder with this cwd was started from, for the advice; undefined when that is this checkout. */
export function holderOrigin(cwd: string, thisCheckout = THIS_CHECKOUT): string | undefined {
  const at = `${cwd}${path.sep}`.indexOf(CACHE_LAYOUT);
  const dir = at === -1 ? cwd : cwd.slice(0, at);
  if (dir === thisCheckout || dir.startsWith(`${thisCheckout}${path.sep}`)) return undefined;
  return at === -1 ? `the coordinator runs from ${cwd}` : `that checkout is ${dir}`;
}

/**
 * The stack:down advice for a held port. `stack:down` stops only what its own
 * checkout started, so name the other checkout when the holder's cwd reveals
 * it, else only the directory the holder runs from (FC_COORDINATOR_DIR).
 */
function stopOrphanAdvice(port: number): string {
  const base = 'run `npm run stack:down` in the checkout that started it';
  const note = (portHolders(port) ?? [])
    .map((pid) => processCwd(pid))
    .map((cwd) => (cwd === undefined ? undefined : holderOrigin(cwd)))
    .find((text) => text !== undefined);
  return note === undefined ? base : `${base} (${note})`;
}

/** Whether the port's listener belongs to the group; undefined when that cannot be read. */
function listenerInGroup(port: number, pgid: number, procRoot: string): boolean | undefined {
  return portHolders(port, procRoot)?.some((pid) => processGroup(pid, procRoot) === pgid);
}

/** Throws a `stack:down`-pointing error naming the holder when port is occupied; a no-op otherwise. */
export async function refuseIfPortHeld(port: number): Promise<void> {
  if (await portFree(port)) return;
  throw new Error(`port ${port} is already in use${holders(port)}; ${stopOrphanAdvice(port)}`);
}

/** Rotates an existing log out of the way instead of deleting it, so the previous run's tail survives. */
export function rotateLog(file: string): void {
  if (existsSync(file)) renameSync(file, `${file}.1`);
}

export async function startCoordinator(options: CoordinatorProcessOptions): Promise<CoordinatorProcess> {
  const cli = path.join(options.dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(cli)) throw new Error(`no tsx in ${options.dir}; run npm ci there first`);
  const url = `http://127.0.0.1:${options.port}`;
  const procRoot = options.procRoot ?? '/proc';
  const log = options.log ?? ((line: string) => console.warn(`[stack] ${line}`));
  let child: ChildProcess | undefined;

  const clearPidFile = (pid: number): void => {
    const file = options.pidFile;
    if (file === undefined || !existsSync(file)) return;
    if (readPidFile(file)?.pid === pid) rmSync(file, { force: true });
  };

  const start = async (): Promise<void> => {
    // A 200 on /healthz proves only that something answers. An orphan from a
    // crashed stack answers too, against that stack's database.
    await refuseIfPortHeld(options.port);
    const fd = openSync(options.logFile, 'a');
    // Its own process group: tsx forks a second node that holds the port and
    // outlives a leader killed alone, so every stop signals the group.
    const proc = spawn(process.execPath, [cli, 'src/server.ts'], {
      cwd: options.dir,
      env: options.env,
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    closeSync(fd);
    const pid = proc.pid as number;
    child = proc;
    if (options.pidFile !== undefined) {
      // Every process in the group (the leader through cli, tsx's fork through
      // its preflight path) names the checkout directory: the needle that
      // tells this stack's coordinator from a pid reused by anything else.
      const identity = identifyProcess(pid, procRoot);
      if (identity !== undefined) writeFileSync(options.pidFile, JSON.stringify({ ...identity, needle: path.join(options.dir, path.sep) }));
      else log(`cannot record coordinator pid ${pid} (no /proc: process identity is Linux-only); stack:down will not stop it if this stack dies`);
    }
    let exitCode: number | null = null;
    proc.once('exit', (code) => {
      exitCode = code ?? -1;
      if (child === proc) child = undefined;
      signalGroup(pid, 'SIGKILL');
      clearPidFile(pid);
    });
    const deadline = Date.now() + (options.healthTimeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      if (exitCode !== null) {
        throw new Error(`coordinator exited with code ${String(exitCode)} before it was healthy:\n${tail(options.logFile)}`);
      }
      if (await healthy(url)) {
        if (exitCode === null && listenerInGroup(options.port, pid, procRoot) !== false) return;
        signalGroup(pid, 'SIGKILL');
        throw new Error(
          `${url}/healthz answered, but the listener is not the coordinator this stack started (pid ${pid}): ` +
            `port ${options.port} is held${holders(options.port)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    signalGroup(pid, 'SIGKILL');
    throw new Error(`coordinator not healthy at ${url} after ${options.healthTimeoutMs ?? 90_000} ms:\n${tail(options.logFile)}`);
  };

  const stop = async (): Promise<void> => {
    const proc = child;
    if (proc === undefined) return;
    const pid = proc.pid as number;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => signalGroup(pid, 'SIGKILL'), 12_000);
      proc.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      signalGroup(pid, 'SIGTERM');
    });
    await waitGroupGone(pid, 5_000);
  };

  await start();
  return {
    url,
    pid: () => child?.pid,
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

export type ReapOutcome = 'gone' | 'stopped' | 'killed' | 'stuck';

interface PidFileIdentity extends ProcessIdentity {
  /** The coordinator's checkout directory, with a trailing separator. */
  needle: string;
}

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** Parses a pid file's identity; undefined for a missing field, invalid JSON or an unreadable file. */
function readPidFile(pidFile: string): PidFileIdentity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(pidFile) ?? '');
  } catch {
    return undefined;
  }
  const { pid, startTime, needle } = (parsed ?? {}) as Partial<PidFileIdentity>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) return undefined;
  if (typeof startTime !== 'number' || typeof needle !== 'string') return undefined;
  return { pid, startTime, needle };
}

/** A recorded group to check before signalling: legacy files carry no start time. */
interface PidRecord {
  pid: number;
  startTime?: number;
  needles: Array<string | RegExp>;
}

function readPidRecord(pidFile: string, legacyPatterns: RegExp[]): PidRecord | undefined {
  // Before identities were recorded the file held only the pid.
  const legacy = /^(\d+)\s*$/.exec(readText(pidFile) ?? '');
  if (legacy !== null) {
    const pid = Number(legacy[1]);
    return pid > 1 ? { pid, needles: legacyPatterns } : undefined;
  }
  const identity = readPidFile(pidFile);
  return identity === undefined ? undefined : { pid: identity.pid, startTime: identity.startTime, needles: [identity.needle] };
}

/**
 * Whether the recorded group is still a coordinator from this checkout directory:
 * a leader whose stat is readable (zombie too) must keep its recorded start time;
 * a live leader must name the directory, else some member must (tsx's fork).
 */
function stillOurs(record: PidRecord, procRoot: string): boolean {
  const names = (pid: number): boolean => record.needles.some((needle) => cmdlineIncludes(pid, needle, procRoot));
  const startTime = processStartTime(record.pid, procRoot);
  if (startTime !== undefined && record.startTime !== undefined && startTime !== record.startTime) return false;
  if (startTime !== undefined && !isZombie(record.pid, procRoot)) return names(record.pid);
  return groupMembers(record.pid, procRoot).some(names);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tsx paths this checkout's coordinators run with: under its ref cache, and under FC_COORDINATOR_DIR when set. */
export function legacyCoordinatorPatterns(env: Env): RegExp[] {
  const tsx = escapeRegExp(path.join(path.sep, 'node_modules', 'tsx', path.sep));
  const dir = env['FC_COORDINATOR_DIR'];
  return [
    new RegExp(`${escapeRegExp(path.join(CACHE_DIR, 'fc-coordinator-'))}[^${escapeRegExp(path.sep)}]+${tsx}`),
    ...(dir === undefined || dir === '' ? [] : [new RegExp(escapeRegExp(path.join(dir, 'node_modules', 'tsx', path.sep)))]),
  ];
}

export interface ReapOptions {
  graceMs?: number;
  /** How long to wait for the group after SIGKILL. */
  killWaitMs?: number;
  procRoot?: string;
  /** Sends every signal and liveness probe. */
  kill?: Signaller;
  /** What a legacy plain-integer pid file's coordinator runs with (legacyCoordinatorPatterns). */
  legacyPatterns?: RegExp[];
}

/**
 * Stop the coordinator group a pid file names, for a stack that died without
 * its teardown. SIGTERM first so it drains, then SIGKILL after the grace. A
 * group that is no longer provably this checkout's is reported gone and never
 * signalled; the pid file stays until the group is gone.
 */
export async function reapCoordinator(
  pidFile: string,
  options: ReapOptions = {},
): Promise<{ pid: number; outcome: ReapOutcome } | undefined> {
  const { graceMs = 12_000, killWaitMs = 5_000, procRoot = '/proc', kill = killSignaller, legacyPatterns = [] } = options;
  if (!existsSync(pidFile)) return undefined;
  const record = readPidRecord(pidFile, legacyPatterns);
  if (record === undefined) {
    rmSync(pidFile, { force: true });
    return undefined;
  }
  const { pid } = record;
  let outcome: ReapOutcome = 'gone';
  if (stillOurs(record, procRoot) && signalGroup(pid, 'SIGTERM', kill)) {
    outcome = 'stopped';
    if (!(await waitGroupGone(pid, graceMs, kill, procRoot))) {
      signalGroup(pid, 'SIGKILL', kill);
      outcome = (await waitGroupGone(pid, killWaitMs, kill, procRoot)) ? 'killed' : 'stuck';
    }
  }
  if (outcome !== 'stuck') rmSync(pidFile, { force: true });
  return { pid, outcome };
}
