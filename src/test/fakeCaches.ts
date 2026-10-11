// An in-memory CacheStorage for tests: open/match/put/add/delete/keys, and caches.delete/keys.
// `add` fetches through the given function and refuses a response that is not ok, as Cache.add does.
export interface FakeCaches extends CacheStorage {
  readonly stores: Map<string, Map<string, Response>>;
  readonly added: Request[];
}

export function fakeCaches(fetcher: (request: Request) => Promise<Response> = async () => new Response('img')): FakeCaches {
  const stores = new Map<string, Map<string, Response>>();
  const added: Request[] = [];
  const keyOf = (r: RequestInfo | URL): string => new URL(typeof r === 'string' ? r : r instanceof URL ? r.href : r.url, 'http://localhost:3000/').href;
  const open = async (name: string): Promise<Cache> => {
    let store = stores.get(name);
    if (store === undefined) {
      store = new Map();
      stores.set(name, store);
    }
    const s = store;
    const cache = {
      match: async (r: RequestInfo | URL) => s.get(keyOf(r))?.clone(),
      put: async (r: RequestInfo | URL, res: Response) => {
        s.set(keyOf(r), res);
      },
      add: async (r: RequestInfo | URL) => {
        const request = r instanceof Request ? r : new Request(keyOf(r));
        added.push(request);
        const res = await fetcher(request);
        if (!res.ok) throw new TypeError(`Cache.add: ${res.status}`);
        s.set(keyOf(request), res);
      },
      delete: async (r: RequestInfo | URL) => s.delete(keyOf(r)),
      keys: async () => [...s.keys()].map((k) => new Request(k)),
    };
    return cache as unknown as Cache;
  };
  return {
    stores,
    added,
    open,
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    match: async () => undefined,
  } as unknown as FakeCaches;
}
