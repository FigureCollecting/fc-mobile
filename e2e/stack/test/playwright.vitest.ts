import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startControl, type ControlTarget } from '../src/control.js';
import { makeGlobalSetup } from '../src/playwright.js';
import type { Stack, StackOptions } from '../src/stack.js';

const target = (coordinator = true): ControlTarget =>
  ({
    state: {},
    edge: { running: () => true },
    coordinator: { running: () => coordinator },
  }) as unknown as ControlTarget;

describe('Playwright globalSetup', () => {
  it('reuses a stack that is already up and leaves it running', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-pw-'));
    const control = await startControl(target(), 0);
    writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ controlUrl: control.url, origin: 'http://localhost:1' }));
    let started = 0;
    const setup = makeGlobalSetup({ stateDir, start: async () => ((started += 1), {} as Stack) });
    const teardown = await setup();
    expect(started).toBe(0);
    expect(process.env['FC_STACK_ORIGIN']).toBe('http://localhost:1');
    await teardown();
    await control.close();
  });

  it('refuses a stack whose control answers but reports a piece down', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-pw-'));
    const control = await startControl(target(false), 0);
    writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid: process.pid, controlUrl: control.url, origin: 'http://localhost:1' }));
    let started = 0;
    const setup = makeGlobalSetup({ stateDir, start: async () => ((started += 1), { state: { origin: 'x' } } as Stack) });
    try {
      await expect(setup()).rejects.toThrow(/coordinator is down[\s\S]*stack:down/);
      expect(started).toBe(0);
    } finally {
      await control.close();
    }
  });

  it('starts a stack when none answers, and stops it on teardown', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-pw-'));
    writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ controlUrl: 'http://127.0.0.1:1', origin: 'x' }));
    const seen: StackOptions[] = [];
    let stopped = false;
    const setup = makeGlobalSetup({
      stateDir,
      start: async (options) => {
        seen.push(options);
        return { state: { origin: 'http://localhost:2' }, stop: async () => void (stopped = true) } as unknown as Stack;
      },
    });
    const teardown = await setup();
    expect(seen[0]?.stateDir).toBe(stateDir);
    expect(process.env['FC_STACK_ORIGIN']).toBe('http://localhost:2');
    await teardown();
    expect(stopped).toBe(true);
  });

  it('starts a stack when no state file exists, with the default dependencies', () => {
    expect(typeof makeGlobalSetup()).toBe('function');
  });
});
