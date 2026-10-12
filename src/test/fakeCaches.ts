// An in-memory CacheStorage for tests: open/match/put/add/delete/keys, and caches.delete/keys, with
// `fetch`, the network behind it: both `fetch` and `add` ask the given function, and `added` records
// every request either asked. `add` refuses a response that is not ok, and stores it only once its
// whole body has arrived, as Cache.add does.
// Matching honours Vary as Chromium does (measured in e2e/pwa (b)): a response stored with
// `Vary: Origin` for a request that carried an Origin matches a query without one (a bare url) only
// with { ignoreVary: true }.
export interface FakeCaches extends CacheStorage {
  readonly stores: Map<string, Map<string, Response>>;
  readonly added: Request[];
  /** The network: install it as the global fetch (vi.stubGlobal('fetch', storage.fetch)). */
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function fakeCaches(fetcher: (request: Request) => Promise<Response> = async () => new Response('img')): FakeCaches {
  const stores = new Map<string, Map<string, Response>>();
  const asked = new Map<string, Map<string, Request>>();
  const added: Request[] = [];
  const keyOf = (r: RequestInfo | URL): string => new URL(typeof r === 'string' ? r : r instanceof URL ? r.href : r.url, 'http://localhost:3000/').href;
  const requestOf = (r: RequestInfo | URL): Request => (r instanceof Request ? r : new Request(keyOf(r)));
  const open = async (name: string): Promise<Cache> => {
    let store = stores.get(name);
    if (store === undefined) {
      store = new Map();
      stores.set(name, store);
      asked.set(name, new Map());
    }
    const s = store;
    const q = asked.get(name)!;
    const hit = (r: RequestInfo | URL, options?: CacheQueryOptions): string | undefined => {
      const key = keyOf(r);
      const res = s.get(key);
      if (res === undefined) return undefined;
      if (options?.ignoreVary === true) return key;
      const query = requestOf(r);
      const stored = q.get(key);
      for (const name of (res.headers.get('vary') ?? '').split(',').map((h) => h.trim()).filter((h) => h !== '')) {
        if (name === '*' || query.headers.get(name) !== (stored?.headers.get(name) ?? null)) return undefined;
      }
      return key;
    };
    const keep = (request: Request, res: Response) => {
      s.set(keyOf(request), res);
      q.set(keyOf(request), request);
    };
    const cache = {
      match: async (r: RequestInfo | URL, options?: CacheQueryOptions) => {
        const key = hit(r, options);
        return key === undefined ? undefined : s.get(key)?.clone();
      },
      put: async (r: RequestInfo | URL, res: Response) => keep(requestOf(r), res),
      add: async (r: RequestInfo | URL) => {
        const request = requestOf(r);
        added.push(request);
        const res = await fetcher(request);
        if (!res.ok) throw new TypeError(`Cache.add: ${res.status}`);
        keep(request, res.body === null ? res : new Response(await res.arrayBuffer(), res));
      },
      delete: async (r: RequestInfo | URL, options?: CacheQueryOptions) => {
        const key = hit(r, options);
        if (key === undefined) return false;
        q.delete(key);
        return s.delete(key);
      },
      keys: async () => [...s.keys()].map((k) => q.get(k) ?? new Request(k)),
    };
    return cache as unknown as Cache;
  };
  return {
    stores,
    added,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request && init === undefined ? input : new Request(input, init);
      added.push(request);
      return fetcher(request);
    },
    open,
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    match: async () => undefined,
  } as unknown as FakeCaches;
}
