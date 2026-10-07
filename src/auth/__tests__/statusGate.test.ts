// The auth status has one writer. Every write carries a ticket taken when its operation
// started, and reloadRequired() voids every ticket taken before it, so nothing an operation
// worked out earlier can replace 'reload-required'. These tests pin that at run time and at
// compile time: tsc -b checks this file, so an unused @ts-expect-error fails the build.
import type { Signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import type { AuthSession } from '../session';
import { StatusGate, type AuthStatus } from '../statusGate';

describe('StatusGate', () => {
  it('starts loading and writes a status carrying a ticket of the current generation', () => {
    const gate = new StatusGate();
    expect(gate.status.value).toBe('loading');
    expect(gate.settle(gate.ticket(), 'signed-in')).toBe('signed-in');
    expect(gate.status.value).toBe('signed-in');
  });

  it('drops a status whose ticket was taken before reloadRequired(), and says what stands', () => {
    const gate = new StatusGate();
    const ticket = gate.ticket();
    gate.reloadRequired();
    expect(gate.status.value).toBe('reload-required');
    for (const status of ['signed-in', 'signed-out', 'offline', 'reauth-required'] as const) {
      expect(gate.settle(ticket, status)).toBe('reload-required');
    }
    expect(gate.status.value).toBe('reload-required');
  });

  it('takes a status from an operation that started after the reload request', () => {
    const gate = new StatusGate();
    const before = gate.ticket();
    gate.reloadRequired();
    const after = gate.ticket();
    expect(gate.settle(after, 'signed-in')).toBe('signed-in');
    expect(gate.settle(before, 'offline')).toBe('signed-in');
    gate.reloadRequired();
    expect(gate.settle(after, 'offline')).toBe('reload-required');
  });

  it('notifies subscribers of each change and of nothing a stale ticket tried', () => {
    const gate = new StatusGate();
    const seen: AuthStatus[] = [];
    const stop = gate.status.subscribe((s) => seen.push(s));
    const stale = gate.ticket();
    gate.reloadRequired();
    gate.settle(stale, 'signed-in');
    gate.settle(gate.ticket(), 'signed-out');
    stop();
    expect(seen).toEqual(['loading', 'reload-required', 'signed-out']);
  });

  it('has a read-only status: a write forced past the type throws and changes nothing', () => {
    const gate = new StatusGate();
    expect(() => {
      (gate.status as Signal<AuthStatus>).value = 'signed-in';
    }).toThrow(TypeError);
    expect(gate.status.value).toBe('loading');
  });

  it('refuses at compile time any status write that carries no ticket', () => {
    // Never called: tsc -b is what runs these. Each line must stay a type error.
    const compileOnly = (gate: StatusGate, session: AuthSession): void => {
      // @ts-expect-error the gate's status is read-only
      gate.status.value = 'signed-in';
      // @ts-expect-error the session's status is read-only
      session.status.value = 'signed-in';
      // @ts-expect-error a status alone is not a write
      gate.settle('signed-in');
      // @ts-expect-error a bare number is not a ticket
      gate.settle(0, 'signed-in');
      // @ts-expect-error the session has no direct writer
      session.set('signed-in');
      // @ts-expect-error nor a guarded one to call from outside
      session.settle(gate.ticket(), 'signed-in');
    };
    expect(compileOnly).toBeTypeOf('function');
  });
});
