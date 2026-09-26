import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describePid, groupAlive, portFree, portHolders, processGroup, signalGroup, waitGroupGone } from '../src/procs.js';
import { freePort } from './procfixtures.js';

const hasProc = existsSync('/proc/net/tcp');

async function listen(port = 0): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return server;
}
const close = (server: net.Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

/** A /proc lookalike: one listener on :8682 held by pid 100, an established socket held by 200. */
function fakeProc(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stack-proc-'));
  mkdirSync(path.join(root, 'net'));
  writeFileSync(
    path.join(root, 'net', 'tcp'),
    [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:21EA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0 100 0 0 10 0',
      '   1: 0100007F:21EA 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 222 1 0 20 4 30 10 -1',
      '   2: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 333 1 0 100 0 0 10 0',
      '',
    ].join('\n'),
  );
  const fds = (pid: string, targets: string[]): void => {
    mkdirSync(path.join(root, pid, 'fd'), { recursive: true });
    targets.forEach((t, i) => symlinkSync(t, path.join(root, pid, 'fd', String(i))));
  };
  fds('100', ['pipe:[5]', 'socket:[111]']);
  fds('200', ['socket:[222]']);
  fds('300', ['socket:[333]']);
  mkdirSync(path.join(root, '400'));
  mkdirSync(path.join(root, 'self'));
  writeFileSync(path.join(root, '100', 'stat'), '100 (node (tsx) x) S 1 4242 4242 0 -1 4194560');
  writeFileSync(path.join(root, '100', 'cmdline'), 'node\0server.js\0');
  writeFileSync(path.join(root, '200', 'stat'), 'garbage');
  return root;
}

describe('port probes', () => {
  it('reports a bound port as taken and a released one as free', async () => {
    const server = await listen();
    const { port } = server.address() as net.AddressInfo;
    expect(await portFree(port)).toBe(false);
    await close(server);
    expect(await portFree(port)).toBe(true);
  });

  it('finds the listener among the sockets in /proc, ignoring other states and ports', () => {
    expect(portHolders(8682, fakeProc())).toEqual([100]);
    expect(portHolders(9999, fakeProc())).toEqual([]);
  });

  it('reports unknown where there is no /proc', () => {
    expect(portHolders(8682, mkdtempSync(path.join(tmpdir(), 'stack-noproc-')))).toBeUndefined();
  });

  it.skipIf(!hasProc)('names this process as the holder of a port it listens on', async () => {
    const server = await listen();
    const { port } = server.address() as net.AddressInfo;
    expect(portHolders(port)).toContain(process.pid);
    await close(server);
    expect(portHolders(await freePort())).toEqual([]);
  });
});

describe('process facts', () => {
  it('reads the process group past a command name holding spaces and parens', () => {
    const root = fakeProc();
    expect(processGroup(100, root)).toBe(4242);
    expect(processGroup(200, root)).toBeUndefined();
    expect(processGroup(999, root)).toBeUndefined();
  });

  it.skipIf(!hasProc)('agrees with ps about the real process group', () => {
    const ps = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
    expect(processGroup(process.pid)).toBe(ps);
  });

  it('describes a pid with its command line when it can read one', () => {
    const root = fakeProc();
    expect(describePid(100, root)).toBe('pid 100 (node server.js)');
    expect(describePid(999, root)).toBe('pid 999');
  });
});

describe('process groups', () => {
  it('never treats 0 or 1 as a group: kill(0) is our own group and kill(-1) is every process', () => {
    for (const pgid of [0, 1, -5, Number.NaN]) {
      expect(groupAlive(pgid)).toBe(false);
      expect(signalGroup(pgid, 'SIGCONT')).toBe(false);
    }
  });

  it('sees a group while it lives, signals it, and waits for it to go', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    const pgid = child.pid as number;
    expect(groupAlive(pgid)).toBe(true);
    expect(await waitGroupGone(pgid, 100)).toBe(false);
    expect(signalGroup(pgid, 'SIGTERM')).toBe(true);
    expect(await waitGroupGone(pgid, 5_000)).toBe(true);
    expect(groupAlive(pgid)).toBe(false);
    expect(signalGroup(pgid, 'SIGTERM')).toBe(false);
  });
});
