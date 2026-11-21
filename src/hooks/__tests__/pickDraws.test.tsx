// PICK-SLOW (CHAL4 SHOULD-1/2): each drawing of the case reads the withheld records first (withheldAddresses). Here that read
// is held or refused on cue, so a drawing's check answers after a later one, after the run's own answer, or never. The kept
// list reads are NOT held, as in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useCollectionImages } from '../useCollectionImages';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, OWNED_MEDIA_CACHE, withheldAddresses, withheldAmong } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';
import { makeTestQueryClient } from '../../test/testUtils';

vi.mock('../../media/keptImages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../media/keptImages')>();
  return { ...actual, withheldAddresses: vi.fn(actual.withheldAddresses) };
});
const { withheldAddresses: readWithheld } = await vi.importActual<typeof import('../../media/keptImages')>('../../media/keptImages');

const D = 'https://images.figurecollecting.com/d';
const SUB = 'user-a';
const N = 20;
const hx = (n: number, salt: string) => `${salt}${n.toString(16).padStart(4, '0')}`.padEnd(64, salt);
const at = (n: number, salt: string) => `${D}/${hx(n, salt)}`;
/** Per figure i: a (the primary, masked by e), b, c, d; `drop` = addresses no list carries any more. */
const lists = (drop: string[] = []) =>
  create(GetProductImagesResponseSchema, {
    products: Array.from({ length: N }, (_, i) => ({
      headId: headOf(i),
      images: [
        { derivativeId: hx(i, 'a'), role: 'gallery', primary: true, url: at(i, 'a'), width: 600, height: 800, mask: { maskId: hx(i, 'e'), contentType: 'image/png', url: at(i, 'e') } },
        { derivativeId: hx(i, 'b'), role: 'gallery', primary: false, url: at(i, 'b'), width: 600, height: 800 },
        { derivativeId: hx(i, 'c'), role: 'gallery', primary: false, url: at(i, 'c'), width: 600, height: 800 },
        { derivativeId: hx(i, 'd'), role: 'gallery', primary: false, url: at(i, 'd'), width: 600, height: 800 },
      ].filter((img) => !drop.includes(img.url)),
    })),
  });
const a0 = at(0, 'a');
const b0 = at(0, 'b');
const c0 = at(0, 'c');
const d0 = at(0, 'd');
const a7 = at(7, 'a');
const nm = (u: string | undefined) => (u === undefined ? '-' : u.slice(D.length + 1, D.length + 2) + parseInt(u.slice(D.length + 2, D.length + 6), 16));
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
let storage: FakeCaches;

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
  vi.mocked(withheldAddresses).mockImplementation(readWithheld);
  renderHook(() => useOnlineStatus());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localSession.value = undefined;
});

async function opened() {
  const r = await localRig();
  r.clients.getProductImages.mockResolvedValue(lists());
  await seedFigures(r, Array.from({ length: N }, (_, i) => ({ title: `F${i}` })));
  const client = makeTestQueryClient();
  const frames: string[] = [];
  const { result, unmount } = renderHook(
    () => {
      const answer = useCollectionImages();
      frames.push(nm(answer.get(headOf(0))?.url));
      return answer;
    },
    { wrapper: queryWrapper(client) },
  );
  await waitFor(() => expect(result.current.size).toBe(N), { timeout: 5000 });
  const idle = () => waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 15000 });
  await idle();
  return { r, result, idle, frames, client, unmount };
}
function network(rule: (u: string, signal: AbortSignal) => Promise<Response> | undefined) {
  const all = storage.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    return rule(request.url, request.signal) ?? all(request);
  });
}
function gate() {
  const waiting: (() => void)[] = [];
  let open = false;
  const answer = (signal: AbortSignal, body: string) =>
    new Promise<Response>((res, rej) => {
      if (open) return res(new Response(body));
      waiting.push(() => res(new Response(body)));
      signal.addEventListener('abort', () => rej(signal.reason));
    });
  return {
    answer,
    let: () => {
      open = true;
      for (const w of waiting.splice(0)) w();
    },
  };
}
/** While on, each drawing's read of the records reads them at once and answers only when let through. */
function heldReads() {
  let on = true;
  let release: () => void = () => {};
  const released = new Promise<void>((res) => (release = res));
  let held = 0;
  vi.mocked(withheldAddresses).mockImplementation(async (storage) => {
    const gone = await readWithheld(storage);
    if (!on) return gone;
    held += 1;
    await released;
    return gone;
  });
  return { stop: () => (on = false), release, held: () => held };
}
const seq = (frames: string[]) => frames.filter((u, i, all) => i === 0 || all[i - 1] !== u);
const busy = () => Promise.resolve(new Response('busy', { status: 503 }));

describe('the case (useCollectionImages): a drawing is checked against the withheld records it read', () => {
  it('a drawing whose check answers after a later drawing\'s is not drawn: a pick its sync withheld meanwhile never comes back', async () => {
    const { r, result, idle, frames } = await opened();
    // d0 taken down on the server after the sheet loaded it
    r.clients.getProductImages.mockResolvedValue(lists([d0]));
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(d0, new Response('d0', { status: 200 }));
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : undefined));
    // the drawings before the sync records d0 read the records then (d0 not in them) and answer late
    const reads = heldReads();
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await waitFor(async () => expect([...(await withheldAmong([d0], storage))]).toEqual([d0]), { timeout: 3000 });
    reads.stop();
    expect(reads.held()).toBeGreaterThan(0);
    // the sync's next drawing (d0 recorded) is drawn; then the earlier checks answer
    await wait(1500);
    reads.release();
    await wait(500);
    const onScreen = nm(result.current.get(headOf(0))?.url);
    slow7.let();
    await idle();
    expect(onScreen).toBe('a0');
    expect(seq(frames)).toEqual(['a0']);
  }, 30_000);

  it('a drawing whose check answers after the run\'s own answer is not drawn over it', async () => {
    const { result, idle, frames } = await opened();
    act(() => setPhotoChoice(SUB, headOf(0), b0));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(b0), { timeout: 3000 });
    await idle();
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    const later = gate();
    let asks = 0;
    // the pick's own fetch of c0 fails, the sync's is held, then fails too: the run ends on the primary (the read rule)
    network((u, s) => {
      if (u === a7) return slow7.answer(s, 'a7');
      if (u !== c0) return undefined;
      asks += 1;
      return asks === 1 ? busy() : later.answer(s, 'x').then(busy);
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asks).toBe(2), { timeout: 3000 });
    // from now on every drawing's check answers only after the run ends; figure 7 lands, so the sync tells (b0 held on screen)
    const reads = heldReads();
    slow7.let();
    await waitFor(() => expect(reads.held()).toBeGreaterThan(0), { timeout: 3000 });
    later.let();
    await idle();
    expect(result.current.get(headOf(0))?.url).toBe(a0);
    reads.release();
    await wait(500);
    expect(reads.held()).toBeGreaterThan(0);
    expect(result.current.get(headOf(0))?.url).toBe(a0);
    expect(seq(frames)).toEqual(['b0', 'a0']);
  }, 30_000);

  it('a drawing whose check answers after the case view went away is not drawn: the answer it showed last stands', async () => {
    const { result, idle, client, unmount } = await opened();
    act(() => setPhotoChoice(SUB, headOf(0), b0));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(b0), { timeout: 3000 });
    await idle();
    // the run's read of every kept figure held (all but figure 0's list), so the run is still reading when the case view goes;
    // the pick (the sheet loaded d0) is drawn meanwhile, its check held
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(d0, new Response('d0', { status: 200 }));
    let letLists: () => void = () => {};
    const listsHeld = new Promise<void>((res) => (letLists = res));
    const own = new URL(`/__fc/image-list/${encodeURIComponent(headOf(0))}`, self.location.href).href;
    const open = storage.open.bind(storage);
    vi.spyOn(storage, 'open').mockImplementation(async (n: string) => {
      const cache = await open(n);
      if (n !== IMAGE_LISTS_CACHE) return cache;
      const match = cache.match.bind(cache);
      return Object.assign(Object.create(cache) as Cache, {
        match: async (...args: Parameters<Cache['match']>) => {
          if ((args[0] instanceof Request ? args[0].url : String(args[0])) !== own) await listsHeld;
          return match(...args);
        },
        keys: cache.keys.bind(cache),
      });
    });
    const reads = heldReads();
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await waitFor(() => expect(reads.held()).toBeGreaterThan(0), { timeout: 3000 });
    const run = client.getQueryCache().findAll({ predicate: (q) => String(q.queryKey[3]).includes(d0) });
    expect(run).toHaveLength(1);
    const key = run[0]!.queryKey;
    unmount();
    await wait(50);
    // every answer written for the run's key from now on (this test client forgets an answer no view shows at once)
    const written = vi.spyOn(client, 'setQueryData');
    reads.release();
    await wait(300);
    expect(written.mock.calls.filter(([k]) => JSON.stringify(k) === JSON.stringify(key))).toEqual([]);
    letLists();
    await wait(300);
  }, 30_000);

  it('a drawing whose read of the records fails draws nothing: the picture on screen stands until the next drawing', async () => {
    const { result, idle, frames } = await opened();
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(d0, new Response('d0', { status: 200 }));
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : undefined));
    let refused = 0;
    vi.mocked(withheldAddresses).mockImplementation(async () => {
      refused += 1;
      throw new Error('the records cannot be read');
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await waitFor(() => expect(refused).toBeGreaterThan(0), { timeout: 3000 });
    await wait(1500);
    const whileRefused = seq(frames);
    vi.mocked(withheldAddresses).mockImplementation(readWithheld);
    slow7.let();
    await idle();
    expect(whileRefused).toEqual(['a0']);
    expect(result.current.get(headOf(0))?.url).toBe(d0);
  }, 30_000);
});
