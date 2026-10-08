// On-device search (WK-15): the n-gram index is built on the page while a build takes at most
// 50 ms, and in a worker once one takes longer, so a large collection never stalls a frame.
// Queries go wherever the index lives. A worker that fails hands back to the page for good.
import { NgramIndex, type SearchDoc } from './ngram';
import type { FromWorker, ToWorker } from './workerHandler';

export const WORKER_THRESHOLD_MS = 50;

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void;
  terminate(): void;
}

export interface SearcherDeps {
  now?: () => number;
  /** Absent where no Worker exists: the index then stays on the page. */
  makeWorker?: () => WorkerLike;
}

export function browserWorker(): (() => WorkerLike) | undefined {
  if (typeof Worker === 'undefined') return undefined;
  return () => new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export class LocalSearcher {
  private readonly now: () => number;
  private readonly makeWorker: (() => WorkerLike) | undefined;
  private index: NgramIndex | undefined;
  private docs: SearchDoc[] = [];
  private worker: WorkerLike | undefined;
  private nextId = 1;
  private readonly waiting = new Map<number, { query: string; resolve: (ids: string[]) => void }>();
  private disposed = false;
  private workerFailed = false;

  constructor(deps: SearcherDeps = {}) {
    this.now = deps.now ?? (() => performance.now());
    this.makeWorker = deps.makeWorker;
  }

  get mode(): 'main' | 'worker' {
    return this.worker === undefined ? 'main' : 'worker';
  }

  update(docs: SearchDoc[]): void {
    this.docs = docs;
    if (this.disposed) return;
    if (this.worker !== undefined) {
      this.post({ type: 'build', docs });
      return;
    }
    const started = this.now();
    this.index = NgramIndex.build(docs);
    if (this.now() - started > WORKER_THRESHOLD_MS && this.makeWorker !== undefined && !this.workerFailed) this.startWorker(docs);
  }

  search(query: string): Promise<string[]> {
    if (this.disposed) return Promise.resolve([]);
    if (this.worker === undefined) return Promise.resolve(this.index?.search(query) ?? []);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, { query, resolve });
      this.post({ type: 'query', id, query });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = undefined;
    this.index = undefined;
    for (const w of this.waiting.values()) w.resolve([]);
    this.waiting.clear();
  }

  private startWorker(docs: SearchDoc[]): void {
    const worker = this.makeWorker!();
    this.worker = worker;
    this.index = undefined;
    worker.addEventListener('message', ((event: MessageEvent<FromWorker>) => {
      const w = this.waiting.get(event.data.id);
      this.waiting.delete(event.data.id);
      w?.resolve(event.data.ids);
    }) as never);
    worker.addEventListener('error', (() => this.fallBack(worker)) as never);
    this.post({ type: 'build', docs });
  }

  // The worker failed: build on the page from the last documents and answer what it left waiting.
  private fallBack(worker: WorkerLike): void {
    worker.terminate();
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.workerFailed = true;
    this.index = NgramIndex.build(this.docs);
    for (const w of this.waiting.values()) w.resolve(this.index.search(w.query));
    this.waiting.clear();
  }

  private post(message: ToWorker): void {
    this.worker!.postMessage(message);
  }
}
