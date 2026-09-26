// A typed client for the control API, for Playwright workers and scripts that
// run in a different process from the stack.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FaultRule, EdgeLogEntry } from './edge.js';
import type { IssuerEvent, IssuerSettings } from './issuer.js';
import type { FgaCall, Tuple } from './openfga.js';
import type { SpineCall } from './spine.js';
import { STACK_ROOT } from './paths.js';
import type { StackState } from './stack.js';

export interface StackClient {
  state(): Promise<StackState>;
  health(): Promise<{ edge: boolean; coordinator: boolean }>;
  shutdown(): Promise<void>;
  edge: {
    stop(): Promise<void>;
    start(): Promise<void>;
    fault(rule: FaultRule): Promise<void>;
    faults(): Promise<FaultRule[]>;
    clearFaults(): Promise<void>;
    releaseHung(): Promise<void>;
    /** Entries after `since` (a seq from cursor()), or all that are kept. */
    log(since?: number): Promise<EdgeLogEntry[]>;
    /** The last logged seq: mark a point with this, then read log(mark). */
    cursor(): Promise<number>;
  };
  coordinator: { stop(): Promise<void>; start(): Promise<void>; restart(): Promise<void> };
  web: { stop(): Promise<void>; start(): Promise<void> };
  issuer: {
    loginAs(sub: string): Promise<void>;
    revokeUser(sub: string): Promise<number>;
    configure(patch: Partial<IssuerSettings>): Promise<IssuerSettings>;
    log(since?: number): Promise<IssuerEvent[]>;
    cursor(): Promise<number>;
  };
  spine: { calls(): Promise<SpineCall[]>; clearCalls(): Promise<void> };
  openfga: {
    tuples(): Promise<Tuple[]>;
    write(tuple: Tuple): Promise<void>;
    remove(tuple: Tuple): Promise<void>;
    calls(): Promise<FgaCall[]>;
  };
}

export function stackClient(controlUrl: string): StackClient {
  const call = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${controlUrl}${route}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    const parsed = (await res.json()) as T & { error?: string };
    if (res.status >= 400) throw new Error(`control ${method} ${route}: ${res.status} ${String(parsed.error)}`);
    return parsed;
  };
  const done = async (method: string, route: string, body?: unknown): Promise<void> => {
    await call(method, route, body);
  };
  const after = (route: string, since?: number): string => (since === undefined ? route : `${route}?since=${since}`);
  const cursor = async (route: string): Promise<number> => (await call<{ seq: number }>('GET', route)).seq;
  return {
    state: () => call('GET', '/state'),
    health: () => call('GET', '/health'),
    shutdown: () => done('POST', '/shutdown'),
    edge: {
      stop: () => done('POST', '/edge/stop'),
      start: () => done('POST', '/edge/start'),
      fault: (rule) => done('POST', '/edge/faults', rule),
      faults: () => call('GET', '/edge/faults'),
      clearFaults: () => done('DELETE', '/edge/faults'),
      releaseHung: () => done('POST', '/edge/release'),
      log: (since) => call('GET', after('/edge/log', since)),
      cursor: () => cursor('/edge/cursor'),
    },
    coordinator: {
      stop: () => done('POST', '/coordinator/stop'),
      start: () => done('POST', '/coordinator/start'),
      restart: () => done('POST', '/coordinator/restart'),
    },
    web: { stop: () => done('POST', '/web/stop'), start: () => done('POST', '/web/start') },
    issuer: {
      loginAs: (sub) => done('POST', '/issuer/login-as', { sub }),
      revokeUser: async (sub) => (await call<{ revoked: number }>('POST', '/issuer/revoke-user', { sub })).revoked,
      configure: (patch) => call('POST', '/issuer/configure', patch),
      log: (since) => call('GET', after('/issuer/log', since)),
      cursor: () => cursor('/issuer/cursor'),
    },
    spine: { calls: () => call('GET', '/spine/calls'), clearCalls: () => done('DELETE', '/spine/calls') },
    openfga: {
      tuples: () => call('GET', '/openfga/tuples'),
      write: (tuple) => done('POST', '/openfga/tuples', tuple),
      remove: (tuple) => done('DELETE', '/openfga/tuples', tuple),
      calls: () => call('GET', '/openfga/calls'),
    },
  };
}

/** The state file a running stack wrote, or undefined when none is up. */
export function readStackState(stateDir: string = path.join(STACK_ROOT, '.state')): StackState | undefined {
  const file = path.join(stateDir, 'stack.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StackState) : undefined;
}
