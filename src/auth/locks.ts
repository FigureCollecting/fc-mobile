export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** Web Locks when the browser has them (cross-tab); otherwise one queue per name in this tab only. */
export function defaultLocks(): LockManagerLike {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks === undefined ? new InTabLocks() : { request: (name, callback) => locks.request(name, callback) };
}

export class InTabLocks implements LockManagerLike {
  private readonly tails = new Map<string, Promise<unknown>>();

  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(name) ?? Promise.resolve()).then(callback, callback);
    this.tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }
}
