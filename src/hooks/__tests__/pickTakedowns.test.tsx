// PICK-SLOW (CHAL4 SHOULD-1/2: a photo the sync withholds, taken down, leaves the screen at the next draw, whichever picture it
// is: the one kept on screen, a pick already drawn, a pending pick, or the answer of a run spared by the run it replaced). The
// case (useCollectionImages) with the kept list reads NOT held, as in the app; only the photos, masks and records named below.
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
import { BROWSED_MEDIA_CACHE, OWNED_MEDIA_CACHE, WITHHELD_CACHE, withheldAmong } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';
import { makeTestQueryClient } from '../../test/testUtils';

const D = 'https://images.figurecollecting.com/d';
const SUB = 'user-a';
const N = 20;
const hx = (n: number, salt: string) => `${salt}${n.toString(16).padStart(4, '0')}`.padEnd(64, salt);
const at = (n: number, salt: string) => `${D}/${hx(n, salt)}`;
/** What the server lists: `drop` = addresses no list carries any more; `unmask` = images listed without their mask. */
type Listed = { drop?: string[]; unmask?: string[] };
/** Per figure i: a (the primary, masked by e), b (plain), c (masked by f), d (plain). */
const lists = (o: Listed = {}) =>
  create(GetProductImagesResponseSchema, {
    products: Array.from({ length: N }, (_, i) => ({
      headId: headOf(i),
      images: [
        { derivativeId: hx(i, 'a'), role: 'gallery', primary: true, url: at(i, 'a'), width: 600, height: 800, mask: { maskId: hx(i, 'e'), contentType: 'image/png', url: at(i, 'e') } },
        { derivativeId: hx(i, 'b'), role: 'gallery', primary: false, url: at(i, 'b'), width: 600, height: 800 },
        { derivativeId: hx(i, 'c'), role: 'gallery', primary: false, url: at(i, 'c'), width: 600, height: 800, mask: { maskId: hx(i, 'f'), contentType: 'image/png', url: at(i, 'f') } },
        { derivativeId: hx(i, 'd'), role: 'gallery', primary: false, url: at(i, 'd'), width: 600, height: 800 },
      ]
        .filter((img) => !(o.drop ?? []).includes(img.url))
        .map((img) => ((o.unmask ?? []).includes(img.url) ? { ...img, mask: undefined } : img)),
    })),
  });
const a0 = at(0, 'a');
const b0 = at(0, 'b');
const c0 = at(0, 'c');
const d0 = at(0, 'd');
const f0 = at(0, 'f');
const a5 = at(5, 'a');
const a7 = at(7, 'a');
/** "a0", "c5", or "-" for no picture. */
const nm = (u: string | undefined) => (u === undefined ? '-' : u.slice(D.length + 1, D.length + 2) + parseInt(u.slice(D.length + 2, D.length + 6), 16));
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
let storage: FakeCaches;

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
  renderHook(() => useOnlineStatus());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localSession.value = undefined;
});

type Frame = { t: number; f0: string; masked0: boolean; f5: string };
/** The case of N kept figures, its sync done; figures 0 and 5 recorded at every render. */
async function opened() {
  const r = await localRig();
  r.clients.getProductImages.mockResolvedValue(lists());
  await seedFigures(r, Array.from({ length: N }, (_, i) => ({ title: `F${i}` })));
  const client = makeTestQueryClient();
  const frames: Frame[] = [];
  const { result } = renderHook(
    () => {
      const answer = useCollectionImages();
      const zero = answer.get(headOf(0));
      frames.push({ t: Date.now(), f0: nm(zero?.url), masked0: zero?.maskUrl !== undefined, f5: nm(answer.get(headOf(5))?.url) });
      return answer;
    },
    { wrapper: queryWrapper(client) },
  );
  await waitFor(() => expect(result.current.size).toBe(N), { timeout: 5000 });
  const idle = () => waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 15000 });
  await idle();
  return { r, result, idle, frames, client };
}
/** The network: `rule` answers an address (or undefined: as the fake answers it); every ask counted. */
function network(rule: (u: string, signal: AbortSignal) => Promise<Response> | undefined) {
  const asked = new Map<string, number>();
  const all = storage.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    asked.set(request.url, (asked.get(request.url) ?? 0) + 1);
    return rule(request.url, request.signal) ?? all(request);
  });
  return asked;
}
/** A fetch held until let through, rejected on abort. */
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
const seqOf = (frames: Frame[], k: 'f0' | 'f5') => frames.map((f) => f[k]).filter((u, i, all) => i === 0 || all[i - 1] !== u);
type Shown = { current: ReadonlyMap<string, { url: string; maskUrl?: string }> };
/** b0 picked and drawn, its sync done. */
const pickB0 = async (result: Shown, idle: () => Promise<unknown>) => {
  act(() => setPhotoChoice(SUB, headOf(0), b0));
  await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(b0), { timeout: 3000 });
  await idle();
};
const imageQueries = (client: ReturnType<typeof makeTestQueryClient>) =>
  client.getQueryCache().findAll({ predicate: (q) => q.queryKey[0] === 'local' && q.queryKey[1] === 'kept-images' });
/** Figure 7's primary gone from the device: the next sync fetches it, held until let through, so that sync runs on. */
async function slowSeven() {
  await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
  return gate();
}

describe('the case (useCollectionImages): a picture the sync withholds leaves the screen at the next draw', () => {
  it('a pick already drawn (the sheet loaded it) that its sync withholds: it leaves, and the primary takes its place', async () => {
    const { r, result, idle, frames } = await opened();
    // d0 taken down on the server after the sheet loaded it
    r.clients.getProductImages.mockResolvedValue(lists({ drop: [d0] }));
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(d0, new Response('d0', { status: 200 }));
    const slow7 = await slowSeven();
    network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    // the sync recorded d0 withheld and is still fetching figure 7
    await waitFor(async () => expect([...(await withheldAmong([d0], storage))]).toEqual([d0]), { timeout: 3000 });
    await wait(2500);
    const onScreen = nm(result.current.get(headOf(0))?.url);
    slow7.let();
    await idle();
    expect(seqOf(frames, 'f0')).toEqual(['a0', 'd0', 'a0']);
    expect(onScreen).toBe('a0');
  }, 30_000);

  it('a pick already drawn whose mask its sync withholds: it stays without the mask', async () => {
    const { r, result, idle, frames } = await opened();
    // c0's mask taken down on the server after the pick's own fetch asked for it
    r.clients.getProductImages.mockResolvedValue(lists({ unmask: [c0] }));
    const slow7 = await slowSeven();
    network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(async () => expect([...(await withheldAmong([f0], storage))]).toEqual([f0]), { timeout: 3000 });
    await wait(2500);
    const onScreen = result.current.get(headOf(0));
    slow7.let();
    await idle();
    expect(frames.some((f) => f.f0 === 'c0' && f.masked0)).toBe(true);
    expect(onScreen?.url).toBe(c0);
    expect(onScreen?.maskUrl).toBeUndefined();
  }, 30_000);

  it('the run a pick spared never draws again a photo the run it replaced withheld while the pick was coming', async () => {
    const { r, result, idle, frames } = await opened();
    // an older choice on figure 3 (d3), kept by the first sync
    const d3 = at(3, 'd');
    act(() => setPhotoChoice(SUB, headOf(3), d3));
    await waitFor(() => expect(result.current.get(headOf(3))?.url).toBe(d3), { timeout: 3000 });
    await idle();
    // a5 (figure 5's primary, no choice) taken down on the server
    r.clients.getProductImages.mockResolvedValue(lists({ drop: [a5] }));
    // the earlier sync is held between its read of the lists and its withheld records
    let putAsked = false;
    let letPut: () => void = () => {};
    const putHeld = new Promise<void>((res) => (letPut = res));
    const open = storage.open.bind(storage);
    vi.spyOn(storage, 'open').mockImplementation(async (n: string) => {
      const cache = await open(n);
      if (n !== WITHHELD_CACHE) return cache;
      const put = cache.put.bind(cache);
      return Object.assign(Object.create(cache) as Cache, {
        put: async (...args: Parameters<Cache['put']>) => {
          putAsked = true;
          await putHeld;
          return put(...args);
        },
        match: cache.match.bind(cache),
        keys: cache.keys.bind(cache),
        delete: cache.delete.bind(cache),
      });
    });
    const g3 = gate();
    const gm = gate();
    let holdD3 = false;
    const asked = network((u, s) => (u === d3 && holdD3 ? g3.answer(s, 'd3') : u === f0 ? gm.answer(s, 'f0') : undefined));
    // the earlier sync: a pick on figure 9 the sheet loaded
    const b9 = at(9, 'b');
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(b9, new Response('b9', { status: 200 }));
    act(() => setPhotoChoice(SUB, headOf(9), b9));
    await waitFor(() => expect(putAsked).toBe(true), { timeout: 3000 });
    // the older choice's bytes gone (evicted): the pick's run fetches it after the pick, slowly, before its own sync
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(d3);
    holdD3 = true;
    frames.length = 0;
    // the pick: c0, its mask held; the run's read lands meanwhile, a5 not recorded yet
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asked.get(f0) ?? 0).toBeGreaterThan(0), { timeout: 3000 });
    await wait(800);
    expect(seqOf(frames, 'f5')).toEqual(['a5']);
    // the earlier sync records a5, deletes its bytes, and drops the other answers, sparing the pick's run
    letPut();
    await waitFor(async () => expect([...(await withheldAmong([a5], storage))]).toEqual([a5]), { timeout: 3000 });
    await wait(1200);
    // the pick's mask lands: the pick is drawn; the run then fetches the older choice (held), its own sync not started
    const landAt = Date.now();
    gm.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 3000 });
    await waitFor(() => expect(asked.get(d3) ?? 0).toBeGreaterThan(0), { timeout: 3000 });
    await wait(3000);
    const afterLand = frames.filter((f) => f.t >= landAt);
    g3.let();
    await idle();
    expect(afterLand.filter((f) => f.f5 === 'a5')).toEqual([]);
    expect(result.current.get(headOf(5))?.url).not.toBe(a5);
  }, 40_000);
});

describe('the case (useCollectionImages): the run a pick replaced spares it, and leaves no stale answer', () => {
  it('pick c0 (mask slow), pick d0 (slow), then "Use default": every frame after the reset is a0; one answer left, idle', async () => {
    const { result, idle, frames, client } = await opened();
    await pickB0(result, idle);
    const gm = gate();
    const gd = gate();
    const slow7 = await slowSeven();
    network((u, s) => (u === f0 ? gm.answer(s, 'f0') : u === d0 ? gd.answer(s, 'd0') : u === a7 ? slow7.answer(s, 'a7') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await wait(300);
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await wait(300);
    act(() => setPhotoChoice(SUB, headOf(0), null));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(a0), { timeout: 3000 });
    const resetDrawn = frames.length;
    gm.let();
    gd.let();
    await wait(300);
    slow7.let();
    await idle();
    await wait(1500);
    const after = [...new Set(frames.slice(resetDrawn - 1).map((f) => f.f0))];
    const qs = imageQueries(client).map((q) => ({ f0: nm((q.state.data as ReadonlyMap<string, { url: string }> | undefined)?.get(headOf(0))?.url), st: q.state.fetchStatus, obs: q.getObserversCount() }));
    expect(after).toEqual(['a0']);
    expect(qs).toEqual([{ f0: 'a0', st: 'idle', obs: 1 }]);
  }, 30_000);

  it('pick c0, pick d0, then back to b0 (the key before): every frame after is b0', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    const gm = gate();
    const gd = gate();
    network((u, s) => (u === f0 ? gm.answer(s, 'f0') : u === d0 ? gd.answer(s, 'd0') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await wait(300);
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await wait(300);
    const before = frames.length;
    act(() => setPhotoChoice(SUB, headOf(0), b0));
    gm.let();
    gd.let();
    await idle();
    await wait(1500);
    expect([...new Set(frames.slice(before).map((f) => f.f0))]).toEqual(['b0']);
    expect(result.current.get(headOf(0))?.url).toBe(b0);
  }, 30_000);
});
