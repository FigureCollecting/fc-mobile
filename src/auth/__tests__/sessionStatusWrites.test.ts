// A source check on session.ts, standing in for a lint rule: its status changes only through
// the gate, each with the ticket its operation took first. A status write that skips the
// ticket, or takes a fresh one at the write, fails here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sessionSource = readFileSync(path.resolve(__dirname, '../session.ts'), 'utf8');

describe('session.ts writes its status only through the gate', () => {
  it('holds no signal of its own and assigns no .value', () => {
    expect(sessionSource).not.toMatch(/\bsignal\s*[<(]/);
    expect(sessionSource).not.toMatch(/\.value\s*=[^=]/);
    expect(sessionSource).not.toMatch(/this\.set\s*\(/);
    expect(sessionSource).not.toMatch(/^\s*(private\s+)?set\s*\(/m);
  });

  it('settles only with the ticket its operation took, never a fresh one', () => {
    const settles = [...sessionSource.matchAll(/\.settle\(([^,]*),/g)].map((m) => m[1]);
    expect(settles.length).toBeGreaterThanOrEqual(8);
    expect(settles.filter((arg) => arg !== 'ticket')).toEqual([]);
  });

  it('takes a ticket only as the first statement of a block, before any await', () => {
    const lines = sessionSource.split('\n');
    const takes = lines.flatMap((line, i) => (line.includes('.ticket()') ? [i] : []));
    expect(takes.length).toBeGreaterThanOrEqual(7);
    for (const i of takes) {
      expect(lines[i].trim()).toBe('const ticket = this.gate.ticket();');
      expect(lines[i - 1].trimEnd()).toMatch(/\{$/);
    }
  });
});
