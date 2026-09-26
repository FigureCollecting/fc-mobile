// Fake coordinator checkouts and port probes for the process-lifecycle tests.
// Not a *.vitest.ts file, so no runner collects it. Every fixture process
// exits on its own after two minutes, so a failed run cannot leave it behind.
import * as http from 'node:http';
import * as net from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A checkout whose node_modules/tsx/dist/cli.mjs is the given script. */
export function fakeCoordinator(script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stack-fakecoord-'));
  mkdirSync(path.join(dir, 'node_modules', 'tsx', 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script);
  return dir;
}

const SELF_DESTRUCT = 'setTimeout(() => process.exit(0), 120_000).unref();';

/** Starts, says so, never listens. */
export const IDLE = `console.log('spawned ' + process.pid); setInterval(() => {}, 1000); ${SELF_DESTRUCT}\n`;

const listener = (ignoreTerm: boolean): string =>
  [
    ignoreTerm
      ? "process.on('SIGTERM', () => {});"
      : "process.on('SIGTERM', () => { console.log('drained ' + process.pid); process.exit(0); });",
    "require('node:http').createServer((req, res) => { res.statusCode = req.url === '/healthz' ? 200 : 404; res.end('{}'); })",
    ".listen(Number(process.env.COORDINATOR_PORT), '127.0.0.1');",
    SELF_DESTRUCT,
  ].join(' ');

const forking = (ignoreTerm: boolean): string =>
  [
    "import { spawn } from 'node:child_process';",
    "import { fileURLToPath } from 'node:url';",
    ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
    // The forked node's cmdline names the checkout, as tsx's preflight path does.
    "const checkout = fileURLToPath(new URL('../../../', import.meta.url));",
    `spawn(process.execPath, ['-e', ${JSON.stringify(listener(ignoreTerm))}, checkout], { stdio: 'inherit' });`,
    "console.log('spawned ' + process.pid);",
    'setInterval(() => {}, 1000);',
    SELF_DESTRUCT,
    '',
  ].join('\n');

/** Like tsx: the leader forks a second node, and that one owns the listener (and drains on SIGTERM). */
export const FORKING = forking(false);
/** FORKING, but neither process stops on SIGTERM. */
export const IGNORES_SIGTERM = forking(true);

/** Something else on the port: 200 to every request. */
export async function squat(port: number): Promise<{ close(): Promise<void> }> {
  const server = http.createServer((_req, res) => res.end('{"status":"ok"}'));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Whether anything answers /healthz with 200 on the port. */
export async function answers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Above PID_MAX_LIMIT (2^22): no process can hold it, so even a signal that
// escaped a fake-/proc test could not land anywhere.
export const FAKE_PID = 4_194_400;

type Sig = NodeJS.Signals | 0;

/** A /proc lookalike: per pid its group, kernel start time, state and argv. */
export function fakeProcRoot(procs: Record<number, { pgrp?: number; start: number; state?: string; argv: string[] }>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stack-fakeproc-'));
  for (const [pid, p] of Object.entries(procs)) {
    mkdirSync(path.join(root, pid));
    const pgrp = p.pgrp ?? Number(pid);
    writeFileSync(path.join(root, pid, 'stat'), `${pid} (node) ${p.state ?? 'S'} 1 ${pgrp} ${pgrp} 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${p.start}`);
    writeFileSync(path.join(root, pid, 'cmdline'), p.argv.map((a) => `${a}\0`).join(''));
  }
  return root;
}

/** Never touches the kernel: records each call and answers with answer(). */
export function fakeSignaller(answer: (target: number, signal: Sig) => boolean = () => false) {
  const calls: Array<{ target: number; signal: Sig }> = [];
  return Object.assign((target: number, signal: Sig) => (calls.push({ target, signal }), answer(target, signal)), { calls });
}

// Our own /proc reads, not src/procs.ts, so a broken helper under test cannot widen this guard.
function procStat(pid: number): { pgrp: number; start: number } | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { pgrp: Number(fields[2]), start: Number(fields[19]) };
  } catch {
    return undefined;
  }
}
// One stat read per process: a member exiting mid-scan drops out instead of
// failing a second read and making a live group look foreign.
const groupOf = (pgid: number): Array<{ pid: number; start: number }> =>
  readdirSync('/proc')
    .filter((e) => /^\d+$/.test(e))
    .map((e) => ({ pid: Number(e), stat: procStat(Number(e)) }))
    .flatMap(({ pid, stat }) => (stat?.pgrp === pgid ? [{ pid, start: stat.start }] : []));

/**
 * A signaller for real-process tests: records every call, and delivers only
 * to processes this test claimed with own()/ownGroup(), each re-checked by
 * pid AND kernel start time at delivery. Anything else is refused, never sent.
 */
export function ownSignaller() {
  const owned = new Map<number, number>();
  const owns = (m: { pid: number; start: number }): boolean => owned.get(m.pid) === m.start;
  const mine = (pid: number): boolean => {
    const start = procStat(pid)?.start;
    return start !== undefined && owns({ pid, start });
  };
  const deliver = (target: number, signal: Sig): boolean => {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      return false;
    }
  };
  const recorder = fakeSignaller((target, signal) => {
    if (target > 0) return mine(target) && deliver(target, signal);
    const members = groupOf(-target);
    return members.length > 0 && members.every(owns) && deliver(target, signal);
  });
  return Object.assign(recorder, {
    own: (pid: number): void => {
      const stat = procStat(pid);
      if (stat === undefined) throw new Error(`pid ${pid} is not running`);
      owned.set(pid, stat.start);
    },
    /** Claims every current member of the group. */
    ownGroup: (pgid: number): void => {
      const members = groupOf(pgid);
      if (members.length === 0) throw new Error(`group ${pgid} has no members`);
      for (const m of members) owned.set(m.pid, m.start);
    },
    /** SIGKILLs one owned pid outside the record, for arranging a test. */
    killOwned: (pid: number): void => {
      if (!mine(pid)) throw new Error(`pid ${pid} is not one this test spawned`);
      process.kill(pid, 'SIGKILL');
    },
    /** Pids in a group, for assertions. */
    members: (pgid: number): number[] => groupOf(pgid).map((m) => m.pid),
  });
}
