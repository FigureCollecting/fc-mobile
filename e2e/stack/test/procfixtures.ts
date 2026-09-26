// Fake coordinator checkouts and port probes for the process-lifecycle tests.
// Not a *.vitest.ts file, so no runner collects it. Every fixture process
// exits on its own after two minutes, so a failed run cannot leave it behind.
import * as http from 'node:http';
import * as net from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
    `spawn(process.execPath, ['-e', ${JSON.stringify(listener(ignoreTerm))}], { stdio: 'inherit' });`,
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
