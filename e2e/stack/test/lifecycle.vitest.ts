import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startControl, type ControlTarget } from '../src/control.js';
import { startCoordinator } from '../src/coordinator.js';
import { alive, probeRunning, stackDown, summary, upDetached, upForeground } from '../src/lifecycle.js';
import { STACK_ROOT } from '../src/paths.js';
import { processStartTime } from '../src/procs.js';
import { coordinatorPidFile, type Stack, type StackState } from '../src/stack.js';
import { answers, fakeCoordinator, FORKING, freePort, isAlive, waitFor } from './procfixtures.js';

const scratch = (): string => mkdtempSync(path.join(tmpdir(), 'stack-life-'));
const FAKE_STACK = path.join(STACK_ROOT, 'test', 'fixtures', 'fake-stack.ts');

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A control API reporting the given health, recorded in a state file for pid. */
async function recordedStack(health: { edge: boolean; coordinator: boolean }, pid = process.pid): Promise<string> {
  const stateDir = scratch();
  const target = { state: {}, edge: { running: () => health.edge }, coordinator: { running: () => health.coordinator } };
  const control = await startControl(target as unknown as ControlTarget, 0);
  closers.push(() => control.close());
  writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid, controlUrl: control.url, origin: 'http://localhost:7' }));
  return stateDir;
}

function silentStack(pid: number, startTime = processStartTime(pid) ?? -1): string {
  const stateDir = scratch();
  writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid, startTime, controlUrl: 'http://127.0.0.1:9', origin: 'http://localhost:7' }));
  return stateDir;
}

/** The pid of a process that has already exited. */
const deadPid = (): number => Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));

describe('liveness', () => {
  it('never reports pid 0 or 1 alive: signalling them reaches our own group, or init', () => {
    expect(alive(process.pid)).toBe(true);
    for (const pid of [0, 1, -1, Number.NaN]) expect(alive(pid)).toBe(false);
    expect(alive(deadPid())).toBe(false);
  });
});

describe('probing the recorded stack', () => {
  it('finds none without a state file, or when its process is gone and control is silent', async () => {
    expect(await probeRunning(scratch())).toEqual({ kind: 'none' });
    expect(await probeRunning(silentStack(deadPid()))).toEqual({ kind: 'none' });
  });

  it('finds a whole stack when control reports edge and coordinator up', async () => {
    const running = await probeRunning(await recordedStack({ edge: true, coordinator: true }));
    expect(running.kind).toBe('up');
  });

  it('names what is down in a stack that answers but is not whole', async () => {
    expect(await probeRunning(await recordedStack({ edge: true, coordinator: false }))).toMatchObject({
      kind: 'degraded',
      reason: 'the coordinator is down',
    });
    expect(await probeRunning(await recordedStack({ edge: false, coordinator: false }))).toMatchObject({
      kind: 'degraded',
      reason: 'the edge and the coordinator are down',
    });
  });

  it('calls a live process with a silent control API degraded, not gone', async () => {
    expect(await probeRunning(silentStack(process.pid))).toMatchObject({
      kind: 'degraded',
      reason: `its process (pid ${process.pid}) is alive but its control API does not answer`,
    });
  });
});

describe('stack:up --detach', () => {
  const run = (stateDir: string, mode: string, timeoutMs?: number) =>
    upDetached({ stateDir, entry: FAKE_STACK, env: { ...process.env, FAKE_STACK: mode }, timeoutMs, pollMs: 50 });

  it('reports a whole running stack instead of starting another', async () => {
    const stateDir = await recordedStack({ edge: true, coordinator: true });
    expect(await run(stateDir, 'fail')).toMatchObject({ ok: true, adopted: true, state: { origin: 'http://localhost:7' } });
    expect(existsSync(path.join(stateDir, 'logs', 'stack.log'))).toBe(false);
  });

  it('refuses to start over a stack that is running but not whole', async () => {
    const result = await run(await recordedStack({ edge: true, coordinator: false }), 'ok');
    expect(result).toMatchObject({ ok: false });
    expect(result.ok || result.message).toMatch(/http:\/\/localhost:7 .*the coordinator is down.*stack:down/);
  });

  it('starts the stack in the background and returns once its state file names it', async () => {
    const stateDir = silentStack(deadPid());
    const result = await run(stateDir, 'ok');
    expect(result).toMatchObject({ ok: true, adopted: false });
    const pid = (result as { state: StackState }).state.pid;
    closers.push(() => void process.kill(pid, 'SIGTERM'));
    expect(pid).not.toBe(process.pid);
    expect(isAlive(pid)).toBe(true);
  });

  it('prints the log tail when the stack exits before it is up', async () => {
    const result = await run(scratch(), 'fail');
    expect(result).toMatchObject({ ok: false });
    expect(result.ok || result.message).toMatch(/did not come up[\s\S]*boom: docker is not running/);
  });

  it('gives up after the timeout and stops what it started', async () => {
    const stateDir = scratch();
    const result = await run(stateDir, 'hang', 1_500);
    expect(result.ok || result.message).toMatch(/did not come up/);
    const pid = Number(/started (\d+)/.exec(readFileSync(path.join(stateDir, 'logs', 'stack.log'), 'utf8'))?.[1]);
    await waitFor(() => !isAlive(pid), 5_000);
  });
});

describe('stack:up in the foreground', () => {
  it('stops the stack and exits on SIGINT, SIGTERM and SIGHUP', async () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const signals = new EventEmitter();
      const exits: number[] = [];
      let stopped = 0;
      const stack = await upForeground(
        { stateDir: '/s' },
        {
          start: async (options) => ({ state: { origin: options.stateDir }, stop: async () => void (stopped += 1) }) as unknown as Stack,
          signals,
          exit: (code) => void exits.push(code),
        },
      );
      expect(stack.state.origin).toBe('/s');
      signals.emit(signal);
      await waitFor(() => exits.length === 1);
      expect([stopped, exits[0]]).toEqual([1, 0]);
    }
  });

  it('stops the stack immediately once start resolves, when a signal arrived while it was still starting', async () => {
    const signals = new EventEmitter();
    const exits: number[] = [];
    let stopped = 0;
    let resolveStart!: () => void;
    const starting = new Promise<void>((resolve) => (resolveStart = resolve));

    const upPromise = upForeground(
      { stateDir: '/s' },
      {
        start: async (options) => {
          // A signal fires here, before start() has resolved.
          signals.emit('SIGTERM');
          await starting;
          return { state: { origin: options.stateDir }, stop: async () => void (stopped += 1) } as unknown as Stack;
        },
        signals,
        exit: (code) => void exits.push(code),
      },
    );
    // Give the signal handler (registered before start()) a turn, then let
    // start() resolve.
    await new Promise((r) => setTimeout(r, 20));
    resolveStart();

    await upPromise;
    await waitFor(() => exits.length === 1);
    expect([stopped, exits[0]]).toEqual([1, 0]);
  });
});

describe('stack:down', () => {
  it('says so when nothing is running', async () => {
    expect(await stackDown(scratch())).toEqual({ ok: true, lines: ['no stack is running'] });
  });

  it('asks a live stack to shut down through control and waits for its process', async () => {
    const stateDir = scratch();
    let asked = 0;
    const target = { state: {}, stop: async () => void (asked += 1) } as unknown as ControlTarget;
    const control = await startControl(target, 0);
    closers.push(() => control.close());
    writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid: deadPid(), controlUrl: control.url }));
    expect(await stackDown(stateDir)).toEqual({ ok: true, lines: ['stack is down'] });
    expect(asked).toBe(1);
    expect(existsSync(path.join(stateDir, 'stack.json'))).toBe(false);
  });

  it('SIGTERMs a stack whose control is silent, and SIGKILLs one that outlives the grace', async () => {
    for (const [script, killed] of [
      ['setInterval(() => {}, 1000)', false],
      ["process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", true],
    ] as const) {
      const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 300));
      const stateDir = silentStack(child.pid as number);
      const result = await stackDown(stateDir, { graceMs: 600 });
      expect(result.ok).toBe(true);
      expect(result.lines.some((l) => /did not stop .*killed/.test(l))).toBe(killed);
      await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    }
  });

  it('never signals a stack pid whose recorded start time no longer matches: pid reuse guard', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 300));
      // A start time that is not this child's real one, as if the recorded
      // pid had since been reused by an unrelated process.
      const stateDir = silentStack(child.pid as number, 1);
      const result = await stackDown(stateDir, { graceMs: 300 });
      expect(result.ok).toBe(true);
      expect(result.lines.some((l) => /did not stop|killed/.test(l))).toBe(false);
      expect(result.lines.some((l) => l.includes('is stale'))).toBe(true);
      expect(existsSync(path.join(stateDir, 'stack.json'))).toBe(false);
      expect(isAlive(child.pid as number)).toBe(true);
    } finally {
      child.kill('SIGKILL');
      await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    }
  });

  it('stops the coordinator a crashed stack left behind', async () => {
    const stateDir = silentStack(deadPid());
    const port = await freePort();
    mkdirSync(stateDir, { recursive: true });
    const orphan = await startCoordinator({
      dir: fakeCoordinator(FORKING),
      env: { PATH: process.env['PATH'] ?? '', COORDINATOR_PORT: String(port) },
      port,
      logFile: path.join(stateDir, 'c.log'),
      pidFile: coordinatorPidFile(stateDir),
    });
    const pid = orphan.pid() as number;
    const result = await stackDown(stateDir);
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([`coordinator pid ${pid} outlived its stack: stopped`, 'stack is down']);
    expect(orphan.running()).toBe(false);
    expect(await answers(port)).toBe(false);
  });

  it('reports a coordinator pid file whose group already exited as nothing running', async () => {
    const stateDir = scratch();
    writeFileSync(coordinatorPidFile(stateDir), `${deadPid()}\n`);
    expect(await stackDown(stateDir)).toEqual({ ok: true, lines: ['no stack is running'] });
  });
});

describe('summary', () => {
  it('lists every endpoint a person needs', () => {
    const text = summary({
      pid: 42,
      origin: 'http://localhost:8480',
      controlUrl: 'http://127.0.0.1:8489',
      issuer: { issuer: 'http://127.0.0.1:8481/application/o/fc-coordinator/' },
      users: [{ preferredUsername: 'alice', sub: 'sub-a' }],
      coordinator: { url: 'http://127.0.0.1:8482', dir: '/c', spineWire: 'h1' },
      postgres: { databaseUrl: 'postgres://x', locale: { collate: 'en_US.UTF-8' } },
      catalog: { file: '/cat.json' },
      logs: { coordinator: '/coord.log' },
    } as unknown as StackState);
    expect(text).toMatch(/^fc-mobile stack is up \(pid 42\)/);
    for (const part of ['http://localhost:8480', 'alice sub-a', '/c  spine wire h1', 'en_US.UTF-8', 'http://127.0.0.1:8489', '/cat.json', '/coord.log']) {
      expect(text).toContain(part);
    }
  });
});
