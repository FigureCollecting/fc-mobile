// Port and process-group facts the stack needs to tell its own coordinator
// from something else on the port. Listener lookup reads /proc (Linux); where
// there is no /proc it reports "unknown" and callers fall back to liveness.
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';

/** Whether host:port can be bound right now. */
export function portFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

const read = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

/**
 * Pids holding a LISTEN socket on the port, among the processes this user can
 * inspect; undefined without /proc.
 */
export function portHolders(port: number, procRoot = '/proc'): number[] | undefined {
  const tables = ['tcp', 'tcp6'].map((t) => path.join(procRoot, 'net', t)).filter((f) => existsSync(f));
  if (tables.length === 0) return undefined;
  const suffix = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const inodes = new Set<string>();
  for (const table of tables) {
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      // sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
      const cols = line.trim().split(/\s+/);
      if (cols[1]?.endsWith(suffix) && cols[3] === '0A' && cols[9] !== undefined) inodes.add(cols[9]);
    }
  }
  if (inodes.size === 0) return [];
  const holders: number[] = [];
  for (const entry of readdirSync(procRoot)) {
    if (!/^\d+$/.test(entry)) continue;
    const fdDir = path.join(procRoot, entry, 'fd');
    const fds = read(() => readdirSync(fdDir)) ?? [];
    const holds = fds.some((fd) => {
      const inode = /^socket:\[(\d+)\]$/.exec(read(() => readlinkSync(path.join(fdDir, fd))) ?? '')?.[1];
      return inode !== undefined && inodes.has(inode);
    });
    if (holds) holders.push(Number(entry));
  }
  return holders;
}

/** The process group of a pid, from /proc/<pid>/stat; undefined when unreadable. */
export function processGroup(pid: number, procRoot = '/proc'): number | undefined {
  const stat = read(() => readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8'));
  if (stat === undefined) return undefined;
  // "pid (comm) state ppid pgrp ...": comm may hold spaces and parens.
  const pgrp = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
  return Number.isInteger(pgrp) ? pgrp : undefined;
}

/** "pid 123 (node server.js)", for error messages. */
export function describePid(pid: number, procRoot = '/proc'): string {
  const cmdline = read(() => readFileSync(path.join(procRoot, String(pid), 'cmdline'), 'utf8'));
  const command = cmdline?.split('\0').filter(Boolean).join(' ');
  return command ? `pid ${pid} (${command})` : `pid ${pid}`;
}

// kill(0) is the caller's own group and kill(-1) every process it may signal.
const isGroup = (pgid: number): boolean => Number.isInteger(pgid) && pgid > 1;

/** Whether any process in the group is still alive (and signalable by us). */
export function groupAlive(pgid: number): boolean {
  if (!isGroup(pgid)) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signal every process in the group; false when the group is already gone. */
export function signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
  if (!isGroup(pgid)) return false;
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Resolves true once the group is gone, false when the timeout passes first. */
export async function waitGroupGone(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}
