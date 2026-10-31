import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContextValues, type UnaryRequest } from '@connectrpc/connect';
import { kActionTrace, newSpanId, newTraceId, traceInterceptor, traceparent } from '../trace';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const part = (header: string | null, i: 1 | 2): string => header!.split('-')[i]!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('random W3C trace ids', () => {
  it('formats a version-00, sampled traceparent from a 16-byte trace id and an 8-byte span id', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    const trace = newTraceId();
    const header = traceparent(trace);
    expect(header).toMatch(TRACEPARENT);
    expect(part(header, 1)).toBe(trace);
  });

  it('draws every id from crypto.getRandomValues, never Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const csprng = vi.spyOn(crypto, 'getRandomValues');
    newTraceId();
    newSpanId();
    expect(csprng.mock.calls.map(([bytes]) => (bytes as Uint8Array).length)).toEqual([16, 8]);
    expect(random).not.toHaveBeenCalled();
  });

  it('draws again when the bytes come back all zero (an invalid id), for trace and span alike', () => {
    const real = crypto.getRandomValues.bind(crypto);
    const csprng = vi.spyOn(crypto, 'getRandomValues');
    csprng.mockImplementationOnce((bytes) => bytes);
    expect(newTraceId()).not.toBe('0'.repeat(32));
    expect(csprng).toHaveBeenCalledTimes(2);
    csprng.mockClear();
    csprng.mockImplementationOnce((bytes) => bytes).mockImplementationOnce((bytes) => real(bytes as Uint8Array<ArrayBuffer>));
    expect(newSpanId()).not.toBe('0'.repeat(16));
    expect(csprng).toHaveBeenCalledTimes(2);
  });

  it('gives 1,000 distinct trace ids and 1,000 distinct span ids', () => {
    expect(new Set(Array.from({ length: 1000 }, newTraceId)).size).toBe(1000);
    expect(new Set(Array.from({ length: 1000 }, newSpanId)).size).toBe(1000);
  });

  it('takes no input to derive an id from: no account, device, key, client id, version or clock', () => {
    expect(newTraceId.length).toBe(0);
    expect(newSpanId.length).toBe(0);
    expect(traceparent.length).toBe(1);
  });

  it('mints a fresh span for every header, and a fresh trace in place of one that is not a valid trace id', () => {
    const trace = newTraceId();
    expect(part(traceparent(trace), 2)).not.toBe(part(traceparent(trace), 2));
    for (const bad of ['0'.repeat(32), 'A'.repeat(32), 'abc', `${trace}-x`, '']) {
      const header = traceparent(bad);
      expect(header).toMatch(TRACEPARENT);
      expect(part(header, 1)).not.toBe(bad);
      expect(part(header, 1)).not.toBe('0'.repeat(32));
    }
  });
});

describe('the Connect trace interceptor', () => {
  const run = (contextValues = createContextValues()): string | null => {
    const req = { header: new Headers(), contextValues } as unknown as UnaryRequest;
    let sent: string | null = null;
    void traceInterceptor()((r) => {
      sent = r.header.get('traceparent');
      return Promise.resolve({} as never);
    })(req);
    return sent;
  };

  it('has no default trace: an unscoped call is never on a page-lifetime id', () => {
    expect(kActionTrace.defaultValue).toBeUndefined();
    const a = run();
    const b = run();
    expect(a).toMatch(TRACEPARENT);
    expect(b).toMatch(TRACEPARENT);
    expect(part(a, 1)).not.toBe(part(b, 1));
  });

  it('puts calls scoped to one action trace on that trace, each with its own span', () => {
    const trace = newTraceId();
    const a = run(createContextValues().set(kActionTrace, trace));
    const b = run(createContextValues().set(kActionTrace, trace));
    expect(part(a, 1)).toBe(trace);
    expect(part(b, 1)).toBe(trace);
    expect(part(a, 2)).not.toBe(part(b, 2));
  });
});

// The header goes to our own API only. Nothing but src/auth/trace.ts writes it, and nothing
// wraps the page's fetch, so the raw fetches (images, the service worker, the update check,
// the IdP) cannot carry one.
describe('source: one writer of the trace header, and no wrapped fetch', () => {
  const SRC = path.resolve(__dirname, '../..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' || e.name === 'test' ? [] : sources(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
    });
  const offenders = (pattern: RegExp): string[] =>
    sources(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (!/^\s*(\/\/|\/?\*)/.test(line) && pattern.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : [])),
    );

  it('names the traceparent header in src/auth/trace.ts only', () => {
    expect(new Set(offenders(/traceparent/i).map((at) => at.split(':')[0]))).toEqual(new Set(['auth/trace.ts']));
  });

  it('never replaces window.fetch or globalThis.fetch', () => {
    expect(offenders(/\b(window|globalThis|self)\.fetch\s*=[^=]/)).toEqual([]);
  });
});
