// What `stack:up` and `stack:down` do, kept out of cli.ts (argv and exit codes
// only) so the tests can drive it: reuse a whole stack, start one in the
// background, stop one, and stop the coordinator a crashed one left behind.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readStackState, stackClient } from './client.js';
import { reapCoordinator } from './coordinator.js';
import { STACK_ROOT } from './paths.js';
import { coordinatorPidFile, startStack, type Stack, type StackOptions, type StackState } from './stack.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Whether pid is a live process. 0 and 1 never are: kill(0) is our own group, 1 is init. */
export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  if (alive(pid)) {
    try {
      process.kill(pid, sig);
    } catch {
      // exited between the check and the signal
    }
  }
}

export function summary(state: StackState): string {
  return [
    `fc-mobile stack is up (pid ${state.pid})`,
    `  app        ${state.origin}   (/api -> coordinator, else -> nginx)`,
    `  issuer     ${state.issuer.issuer}`,
    `  users      ${state.users.map((u) => `${u.preferredUsername} ${u.sub}`).join(', ')}`,
    `  coordinator ${state.coordinator.url}  ${state.coordinator.ref ?? state.coordinator.dir}  spine wire ${state.coordinator.spineWire}`,
    `  postgres   ${state.postgres.databaseUrl}  ${state.postgres.locale.collate}`,
    `  control    ${state.controlUrl}`,
    `  catalog    ${state.catalog.file}`,
    `  logs       ${state.logs.coordinator}`,
  ].join('\n');
}

export type Running =
  | { kind: 'none' }
  | { kind: 'up'; state: StackState }
  | { kind: 'degraded'; state: StackState; reason: string };

/** The stack the state file names: whole, running but not whole, or gone. */
export async function probeRunning(stateDir: string): Promise<Running> {
  const state = readStackState(stateDir);
  if (state === undefined) return { kind: 'none' };
  const health = await stackClient(state.controlUrl)
    .health()
    .catch(() => undefined);
  if (health === undefined) {
    if (!alive(state.pid)) return { kind: 'none' };
    return { kind: 'degraded', state, reason: `its process (pid ${state.pid}) is alive but its control API does not answer` };
  }
  const down = (['edge', 'coordinator'] as const).filter((piece) => !health[piece]);
  if (down.length === 0) return { kind: 'up', state };
  return { kind: 'degraded', state, reason: `${down.map((p) => `the ${p}`).join(' and ')} ${down.length === 1 ? 'is' : 'are'} down` };
}

export function degradedMessage(running: Extract<Running, { kind: 'degraded' }>): string {
  return (
    `a stack is running at ${running.state.origin} but ${running.reason}; ` +
    'start the piece again through the control API, or run `npm run stack:down` first'
  );
}

export interface DetachOptions {
  stateDir: string;
  /** Script run as `node --import tsx <entry> up`; default src/cli.ts. */
  entry?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  pollMs?: number;
}

export type UpResult = { ok: true; state: StackState; adopted: boolean } | { ok: false; message: string };

/** `stack:up --detach`: start the stack as a background process and wait for its state file. */
export async function upDetached(options: DetachOptions): Promise<UpResult> {
  const running = await probeRunning(options.stateDir);
  if (running.kind === 'up') return { ok: true, state: running.state, adopted: true };
  if (running.kind === 'degraded') return { ok: false, message: degradedMessage(running) };

  const log = path.join(options.stateDir, 'logs', 'stack.log');
  mkdirSync(path.dirname(log), { recursive: true });
  const fd = openSync(log, 'w');
  // tsx as a loader, not its CLI: the CLI forks a second node, and the pid the
  // stack records must be the one this process waits for and `down` signals.
  const child = spawn(process.execPath, ['--import', 'tsx', options.entry ?? path.join(STACK_ROOT, 'src', 'cli.ts'), 'up'], {
    cwd: STACK_ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...(options.env ?? process.env), FC_STACK_STATE_DIR: options.stateDir },
  });
  closeSync(fd);
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  while (!exited && Date.now() < deadline) {
    const state = readStackState(options.stateDir);
    if (state !== undefined && state.pid === child.pid) return { ok: true, state, adopted: false };
    await sleep(options.pollMs ?? 500);
  }
  if (!exited) signal(child.pid as number, 'SIGTERM');
  const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-40).join('\n');
  return { ok: false, message: `stack did not come up; last lines of ${log}:\n${tail}` };
}

export interface ForegroundDeps {
  start?: (options: StackOptions) => Promise<Stack>;
  signals?: Pick<NodeJS.EventEmitter, 'on'>;
  exit?: (code: number) => void;
}

/** `stack:up`: run until a signal or a control /shutdown, then tear down and exit. */
export async function upForeground(options: StackOptions, deps: ForegroundDeps = {}): Promise<Stack> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const stack = await (deps.start ?? startStack)(options);
  const stop = stack.stop;
  stack.stop = async () => {
    await stop();
    exit(0);
  };
  // SIGHUP too: the coordinator has its own session, so a closed terminal no
  // longer reaches it directly.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) (deps.signals ?? process).on(sig, () => void stack.stop());
  return stack;
}

export interface DownResult {
  ok: boolean;
  lines: string[];
}

/** `stack:down`: stop the recorded stack, then any coordinator it left behind. */
export async function stackDown(stateDir: string, options: { graceMs?: number } = {}): Promise<DownResult> {
  const graceMs = options.graceMs ?? 60_000;
  const lines: string[] = [];
  const state = readStackState(stateDir);
  if (state !== undefined) {
    const asked = await stackClient(state.controlUrl)
      .shutdown()
      .then(
        () => true,
        () => false,
      );
    if (!asked) signal(state.pid, 'SIGTERM');
    const deadline = Date.now() + graceMs;
    while (alive(state.pid) && Date.now() < deadline) await sleep(100);
    if (alive(state.pid)) {
      signal(state.pid, 'SIGKILL');
      lines.push(`stack pid ${state.pid} did not stop within ${graceMs} ms; killed it`);
    }
    rmSync(path.join(stateDir, 'stack.json'), { force: true });
  }
  // A stack killed without its teardown (SIGKILL, OOM) leaves its coordinator
  // listening against that stack's database; the next `up` would refuse the port.
  const reaped = await reapCoordinator(coordinatorPidFile(stateDir));
  const orphan = reaped !== undefined && reaped.outcome !== 'gone';
  if (orphan) lines.push(`coordinator pid ${reaped.pid} outlived its stack: ${reaped.outcome}`);
  if (reaped?.outcome === 'stuck') {
    return { ok: false, lines: [...lines, `stack is NOT down: coordinator group ${reaped.pid} survived SIGKILL`] };
  }
  lines.push(state === undefined && !orphan ? 'no stack is running' : 'stack is down');
  return { ok: true, lines };
}

