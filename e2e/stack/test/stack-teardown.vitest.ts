import { mkdtempSync, existsSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startStack } from '../src/stack.js';

const free = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

describe('stack start-up failure', () => {
  it('tears down everything that started when a later piece fails', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'stack-fail-'));
    const lines: string[] = [];
    await expect(
      startStack({
        portBase: 19480,
        stateDir,
        webDist: mkdtempSync(path.join(tmpdir(), 'stack-nodist-')),
        log: (line) => lines.push(line),
      }),
    ).rejects.toThrow(/no index\.html/);
    expect(lines).toContain('postgres: starting');
    expect(lines).toContain('web: starting');
    for (const port of [19481, 19483, 19484, 19485]) expect(await free(port)).toBe(true);
    expect(existsSync(path.join(stateDir, 'stack.json'))).toBe(false);
  }, 300_000);
});
