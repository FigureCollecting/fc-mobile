// The searcher builds the index on the page while a build is quick, and in a worker once a build
// takes more than 50 ms (WK-15), answering queries from wherever the index lives.
import { describe, expect, it, vi } from 'vitest';
import { LocalSearcher, WORKER_THRESHOLD_MS, type WorkerLike } from '../searcher';
import { createWorkerHandler, type FromWorker, type ToWorker } from '../workerHandler';
import type { SearchDoc } from '../ngram';

const DOCS: SearchDoc[] = [
  { id: 'a', fields: ['Hatsune Miku'] },
  { id: 'b', fields: ['Rem'] },
];

/** A clock that reports `took` ms across each index build. */
function clockTaking(...took: number[]) {
  let t = 0;
  let call = 0;
  return () => {
    const now = t;
    if (call % 2 === 0) t += took[Math.min(call / 2, took.length - 1)] ?? 0;
    call += 1;
    return now;
  };
}

/** A worker on the real handler, answering on a later task like a real one. */
function fakeWorker() {
  const listeners: Array<(e: { data: FromWorker }) => void> = [];
  const received: ToWorker[] = [];
  const handle = createWorkerHandler((msg) => setTimeout(() => listeners.forEach((l) => l({ data: msg })), 0));
  const worker: WorkerLike & { received: ToWorker[] } = {
    received,
    postMessage: (msg) => {
      received.push(msg as ToWorker);
      handle(msg as ToWorker);
    },
    addEventListener: (_type, fn) => void listeners.push(fn as never),
    terminate: vi.fn(),
  };
  return worker;
}

describe('LocalSearcher', () => {
  it('stays on the page while a build takes 50 ms or less', async () => {
    const makeWorker = vi.fn(fakeWorker);
    const s = new LocalSearcher({ now: clockTaking(WORKER_THRESHOLD_MS), makeWorker });
    s.update(DOCS);
    expect(s.mode).toBe('main');
    expect(await s.search('miku')).toEqual(['a']);
    expect(makeWorker).not.toHaveBeenCalled();
  });

  it('moves the index to a worker once a build takes more than 50 ms, and answers from it', async () => {
    const worker = fakeWorker();
    const s = new LocalSearcher({ now: clockTaking(WORKER_THRESHOLD_MS + 1), makeWorker: () => worker });
    s.update(DOCS);
    expect(s.mode).toBe('worker');
    expect(worker.received.map((m) => m.type)).toEqual(['build']);
    expect(await s.search('rem')).toEqual(['b']);
    s.update([{ id: 'c', fields: ['Spike'] }]);
    expect(await s.search('spike')).toEqual(['c']);
    expect(worker.received.map((m) => m.type)).toEqual(['build', 'query', 'build', 'query']);
  });

  it('answers two queries in flight each with its own result', async () => {
    const s = new LocalSearcher({ now: clockTaking(99), makeWorker: fakeWorker });
    s.update(DOCS);
    expect(await Promise.all([s.search('miku'), s.search('rem')])).toEqual([['a'], ['b']]);
  });

  it('stays on the page when no worker can be made, however slow the build', async () => {
    const s = new LocalSearcher({ now: clockTaking(500) });
    s.update(DOCS);
    expect(s.mode).toBe('main');
    expect(await s.search('miku')).toEqual(['a']);
  });

  it('falls back to the page when the worker fails, rebuilding from the last documents', async () => {
    let fail: ((e: unknown) => void) | undefined;
    const worker: WorkerLike = {
      postMessage: () => undefined,
      addEventListener: (type, fn) => {
        if (type === 'error') fail = fn as never;
      },
      terminate: vi.fn(),
    };
    const s = new LocalSearcher({ now: clockTaking(99, 1), makeWorker: () => worker });
    s.update(DOCS);
    const pending = s.search('miku');
    fail!(new Event('error'));
    expect(s.mode).toBe('main');
    expect(worker.terminate).toHaveBeenCalled();
    expect(await pending).toEqual(['a']);
    expect(await s.search('rem')).toEqual(['b']);
  });

  it('finds nothing before any build, and nothing after dispose', async () => {
    const worker = fakeWorker();
    const s = new LocalSearcher({ now: clockTaking(99), makeWorker: () => worker });
    expect(await s.search('miku')).toEqual([]);
    s.update(DOCS);
    s.dispose();
    expect(worker.terminate).toHaveBeenCalled();
    expect(await s.search('miku')).toEqual([]);
  });
});

describe('the worker handler', () => {
  it('builds, answers a query by id, and answers nothing before a build', () => {
    const out: FromWorker[] = [];
    const handle = createWorkerHandler((m) => out.push(m));
    handle({ type: 'query', id: 1, query: 'miku' });
    handle({ type: 'build', docs: DOCS });
    handle({ type: 'query', id: 2, query: 'miku' });
    expect(out).toEqual([
      { type: 'result', id: 1, ids: [] },
      { type: 'result', id: 2, ids: ['a'] },
    ]);
  });
});
