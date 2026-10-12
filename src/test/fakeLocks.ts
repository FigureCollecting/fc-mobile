// An in-memory LockManager (Web Locks) the "documents" of a test share, as the documents of one
// origin share the browser's: exclusive locks only, granted per name in the order asked; a request
// whose signal aborts while it waits rejects with the signal's reason and never runs; a lock is
// released when its callback settles. Install it on navigator with installFakeLocks.
export interface FakeLocks {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
  /** The name of every request, in the order asked. */
  readonly asked: string[];
}

export function fakeLocks(): FakeLocks {
  const queues = new Map<string, Promise<void>>();
  const asked: string[] = [];
  return {
    asked,
    async request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
      asked.push(name);
      options.signal?.throwIfAborted();
      const before = queues.get(name) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((res) => (release = res));
      queues.set(name, before.then(() => mine));
      try {
        await new Promise<void>((res, rej) => {
          const signal = options.signal;
          const abort = () => rej(signal!.reason);
          signal?.addEventListener('abort', abort, { once: true });
          void before.then(() => {
            signal?.removeEventListener('abort', abort);
            res();
          });
        });
      } catch (err) {
        release();
        throw err;
      }
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };
}

/** Put a LockManager on navigator (jsdom has none) until the returned function takes it away. */
export function installFakeLocks(locks: FakeLocks = fakeLocks()): () => void {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return () => {
    delete (navigator as unknown as { locks?: unknown }).locks;
  };
}
