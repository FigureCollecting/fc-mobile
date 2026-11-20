// PICK-SLOW (Ross 11-19, on cellular: a pick should keep the picture on screen and land fast): the case (useCollectionImages)
// with the kept list reads NOT held, so the run's read of every kept figure and its sync's shows land while a pick's bytes
// are still coming, as they do in the app.
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
import { BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, OWNED_MEDIA_CACHE, WITHHELD_CACHE, withheldAmong } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';
import { makeTestQueryClient } from '../../test/testUtils';

const D = 'https://images.figurecollecting.com/d';
const SUB = 'user-a';
const N = 20;
const hx = (n: number, salt: string) => `${salt}${n.toString(16).padStart(4, '0')}`.padEnd(64, salt);
const at = (n: number, salt: string) => `${D}/${hx(n, salt)}`;
/** What the server lists for figure 0 (every other figure lists all of it): `b` gone, `c` without its mask, `a` twice. */
type Listed = { noB?: boolean; cUnmasked?: boolean; dupOfA?: boolean };
/** a: the primary, masked by e; b: plain; c: masked by f; d: plain. */
const lists = (o: Listed = {}) =>
  create(GetProductImagesResponseSchema, {
    products: Array.from({ length: N }, (_, i) => ({
      headId: headOf(i),
      images: [
        { derivativeId: hx(i, 'a'), role: 'gallery', primary: true, url: at(i, 'a'), width: 600, height: 800, mask: { maskId: hx(i, 'e'), contentType: 'image/png', url: at(i, 'e') } },
        ...(i === 0 && o.noB === true ? [] : [{ derivativeId: hx(i, 'b'), role: 'gallery', primary: false, url: at(i, 'b'), width: 600, height: 800 }]),
        {
          derivativeId: hx(i, 'c'),
          role: 'gallery',
          primary: false,
          url: at(i, 'c'),
          width: 600,
          height: 800,
          ...(i === 0 && o.cUnmasked === true ? {} : { mask: { maskId: hx(i, 'f'), contentType: 'image/png', url: at(i, 'f') } }),
        },
        { derivativeId: hx(i, 'd'), role: 'gallery', primary: false, url: at(i, 'd'), width: 600, height: 800 },
        ...(i === 0 && o.dupOfA === true ? [{ derivativeId: hx(i, '9'), role: 'gallery', primary: false, url: at(i, 'a'), width: 600, height: 800 }] : []),
      ],
    })),
  });
const a0 = at(0, 'a');
const b0 = at(0, 'b');
const c0 = at(0, 'c');
const d0 = at(0, 'd');
const f0 = at(0, 'f');
const name = (u: string | undefined) => ({ [a0]: 'a0', [b0]: 'b0', [c0]: 'c0', [d0]: 'd0' } as Record<string, string>)[u ?? ''] ?? String(u);
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

/** The case of N kept figures, its sync done; figure 0's picture (and whether it carries a mask) recorded at every render. */
async function opened(o: Listed = {}) {
  const r = await localRig();
  r.clients.getProductImages.mockResolvedValue(lists(o));
  await seedFigures(r, Array.from({ length: N }, (_, i) => ({ title: `F${i}` })));
  const client = makeTestQueryClient();
  const frames: { f0: string; masked: boolean }[] = [];
  const { result } = renderHook(
    () => {
      const answer = useCollectionImages();
      frames.push({ f0: name(answer.get(headOf(0))?.url), masked: answer.get(headOf(0))?.maskUrl !== undefined });
      return answer;
    },
    { wrapper: queryWrapper(client) },
  );
  await waitFor(() => expect(result.current.size).toBe(N), { timeout: 5000 });
  const idle = () => waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 8000 });
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
const busy = () => Promise.resolve(new Response('busy', { status: 503 }));
/** From now on every read of one withheld record takes 400 ms: a picture's check answers after the answers told meanwhile. */
function slowWithheld() {
  const open = storage.open.bind(storage);
  vi.spyOn(storage, 'open').mockImplementation(async (n: string) => {
    const cache = await open(n);
    if (n !== WITHHELD_CACHE) return cache;
    const match = cache.match.bind(cache);
    return Object.assign(Object.create(cache) as Cache, {
      match: async (...args: Parameters<Cache['match']>) => {
        await wait(400);
        return match(...args);
      },
      keys: cache.keys.bind(cache),
    });
  });
}
const seq = (frames: { f0: string }[]) => frames.map((f) => f.f0).filter((u, i, all) => i === 0 || all[i - 1] !== u);
type Shown = { current: ReadonlyMap<string, { url: string; maskUrl?: string }> };
/** b0 picked and drawn (the sheet's bytes need no fetch of it: plain), its sync done. */
const pickB0 = async (result: Shown, idle: () => Promise<unknown>) => {
  act(() => setPhotoChoice(SUB, headOf(0), b0));
  await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(b0), { timeout: 3000 });
  await idle();
};

describe('the case (useCollectionImages): a slow pick keeps the picture on screen while the run reads and syncs', () => {
  it('a masked pick whose mask is slow: the earlier pick stands through the run\'s read; the primary is never drawn', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    const mask = gate();
    const asked = network((u, s) => (u === f0 ? mask.answer(s, 'f0') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asked.get(f0) ?? 0).toBeGreaterThan(0), { timeout: 2000 });
    // the run's read of every kept figure lands meanwhile (20 figures: well under a second here)
    await wait(800);
    expect(seq(frames)).toEqual(['b0']);
    mask.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 3000 });
    await idle();
    expect(seq(frames)).toEqual(['b0', 'c0']);
  }, 20_000);

  it('a slow pick on a figure whose primary is not on the device either: the earlier pick stands, never the plate', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    // the primary's bytes gone (evicted): the device answers nothing for figure 0 until the pick lands
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a0);
    const mask = gate();
    const asked = network((u, s) => (u === f0 ? mask.answer(s, 'f0') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asked.get(f0) ?? 0).toBeGreaterThan(0), { timeout: 2000 });
    await wait(800);
    expect(seq(frames)).toEqual(['b0']);
    mask.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 3000 });
    await idle();
    expect(seq(frames)).toEqual(['b0', 'c0']);
  }, 20_000);

  it('an unmasked pick the sheet did not load, its photo slow: the earlier pick stands until it lands', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    const photo = gate();
    const asked = network((u, s) => (u === d0 ? photo.answer(s, 'd0') : undefined));
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await waitFor(() => expect(asked.get(d0) ?? 0).toBeGreaterThan(0), { timeout: 2000 });
    await wait(800);
    expect(seq(frames)).toEqual(['b0']);
    photo.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(d0), { timeout: 3000 });
    await idle();
    expect(seq(frames)).toEqual(['b0', 'd0']);
  }, 20_000);

  it('a pick whose photo fails for good: the earlier pick stands through the sync\'s shows, and the sync\'s end draws the primary', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    const later = gate();
    let asks = 0;
    // the pick's own fetch of c0 fails, the sync's is held, then fails too
    network((u, s) => {
      if (u !== c0) return undefined;
      asks += 1;
      return asks === 1 ? busy() : later.answer(s, 'x').then(busy);
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asks).toBe(2), { timeout: 3000 });
    // the sync told what it kept meanwhile (at most every second)
    await wait(1300);
    expect(seq(frames)).toEqual(['b0']);
    later.let();
    await idle();
    // the known read rule: the run's own answer, the chosen photo not here, is the primary
    expect(result.current.get(headOf(0))?.url).toBe(a0);
    expect(seq(frames)).toEqual(['b0', 'a0']);
  }, 20_000);

  it('a held picture whose withheld check is slow is never drawn over the run\'s own answer, nor over a later one', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    slowWithheld();
    let asks = 0;
    network((u) => {
      if (u !== c0) return undefined;
      asks += 1;
      return busy();
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asks).toBe(2), { timeout: 5000 });
    await idle();
    // the sync ended on the primary (the read rule); a hold told before its end answered later and is not drawn
    await wait(1500);
    expect(result.current.get(headOf(0))?.url).toBe(a0);
    expect(seq(frames)).toEqual(['b0', 'a0']);
  }, 20_000);

  it('a pick whose own fetch failed and whose sync kept it: drawn once, never the earlier pick again after it', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    slowWithheld();
    // figure 7's primary gone: the sync goes on fetching it, held, after it kept c0
    const a7 = at(7, 'a');
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    let asks = 0;
    network((u, s) => {
      if (u === a7) return slow7.answer(s, 'a7');
      if (u !== c0) return undefined;
      asks += 1;
      return asks === 1 ? busy() : undefined;
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 5000 });
    // a hold told before c0 was kept answers meanwhile, while the sync runs on
    await wait(1500);
    expect(seq(frames)).toEqual(['b0', 'c0']);
    slow7.let();
    await idle();
    expect(seq(frames)).toEqual(['b0', 'c0']);
  }, 20_000);

  it('a photo the run withholds (taken down) leaves the screen while the pick is still coming, though it is the one on screen', async () => {
    const { r, result, idle, frames } = await opened();
    await pickB0(result, idle);
    // b0 taken down: the server lists it no more
    r.clients.getProductImages.mockResolvedValue(lists({ noB: true }));
    const later = gate();
    let asks = 0;
    network((u, s) => {
      if (u !== c0) return undefined;
      asks += 1;
      return asks === 1 ? busy() : later.answer(s, 'c0');
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    // the sync read the lists, recorded b0 withheld and is fetching c0
    await waitFor(() => expect(asks).toBe(2), { timeout: 3000 });
    expect([...(await withheldAmong([b0], storage))]).toEqual([b0]);
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(a0), { timeout: 3000 });
    later.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 3000 });
    await idle();
    expect(seq(frames)).toEqual(['b0', 'a0', 'c0']);
  }, 20_000);

  it('a mask the run withholds leaves the screen with it: the picture on screen stands without it while the pick comes', async () => {
    const { r, result, idle, frames } = await opened();
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(result.current.get(headOf(0))?.maskUrl).toBe(f0), { timeout: 3000 });
    await idle();
    // c0's mask taken down: the server lists c0 without it
    r.clients.getProductImages.mockResolvedValue(lists({ cUnmasked: true }));
    const later = gate();
    let asks = 0;
    network((u, s) => {
      if (u !== d0) return undefined;
      asks += 1;
      return asks === 1 ? busy() : later.answer(s, 'd0');
    });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), d0));
    await waitFor(() => expect(asks).toBe(2), { timeout: 3000 });
    expect([...(await withheldAmong([f0], storage))]).toEqual([f0]);
    await waitFor(() => expect(result.current.get(headOf(0))?.maskUrl).toBeUndefined(), { timeout: 3000 });
    expect(result.current.get(headOf(0))?.url).toBe(c0);
    later.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(d0), { timeout: 3000 });
    await idle();
    expect(frames.filter((f) => f.f0 === 'c0' && !f.masked).length).toBeGreaterThan(0);
    expect(seq(frames)).toEqual(['c0', 'd0']);
  }, 20_000);

  it('a pick made while an earlier sync is past its list read: the earlier pick stands while the mask comes', async () => {
    const { result, idle, frames } = await opened();
    await pickB0(result, idle);
    const a7 = at(7, 'a');
    const b9 = at(9, 'b');
    // figure 7's primary gone from the device: the next sync fetches it, slowly
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    const mask = gate();
    const asked = network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : u === f0 ? mask.answer(s, 'f0') : undefined));
    // a pick on figure 9 the sheet loaded: its run keeps it, then syncs, reads the lists and waits on figure 7's photo
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(b9, new Response('b9', { status: 200 }));
    act(() => setPhotoChoice(SUB, headOf(9), b9));
    await waitFor(() => expect(asked.get(a7) ?? 0).toBeGreaterThan(0), { timeout: 3000 });
    frames.length = 0;
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(asked.get(f0) ?? 0).toBeGreaterThan(0), { timeout: 3000 });
    await wait(800);
    expect(seq(frames)).toEqual(['b0']);
    mask.let();
    slow7.let();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 5000 });
    await idle();
    expect(seq(frames)).toEqual(['b0', 'c0']);
  }, 30_000);

  it('a pick made while an earlier sync is past its list read runs once: the run it replaced never stops it', async () => {
    const { result, idle, client } = await opened();
    const a7 = at(7, 'a');
    const b9 = at(9, 'b');
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a7);
    const slow7 = gate();
    // the pick's mask takes 300 ms, and a stopped run's ask of it ends there
    const slowMask = (s: AbortSignal) =>
      new Promise<Response>((res, rej) => {
        const timer = setTimeout(() => res(new Response('f0')), 300);
        s.addEventListener('abort', () => {
          clearTimeout(timer);
          rej(s.reason);
        });
      });
    const asked = network((u, s) => (u === a7 ? slow7.answer(s, 'a7') : u === f0 ? slowMask(s) : undefined));
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(b9, new Response('b9', { status: 200 }));
    act(() => setPhotoChoice(SUB, headOf(9), b9));
    await waitFor(() => expect(asked.get(a7) ?? 0).toBeGreaterThan(0), { timeout: 3000 });
    // every run of the pick's key, counted as it starts
    let runs = 0;
    const unsubscribe = client.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'fetch' && String(e.query.queryKey[3]).includes(c0)) runs += 1;
    });
    act(() => setPhotoChoice(SUB, headOf(0), c0));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(c0), { timeout: 5000 });
    slow7.let();
    await idle();
    unsubscribe();
    expect(runs).toBe(1);
    expect(asked.get(f0)).toBe(1);
    expect(asked.get(c0)).toBe(1);
  }, 30_000);

  it('a pick of a photo whose address is the primary\'s (a duplicate row), its bytes gone, the sheet loaded them: drawn at once', async () => {
    const { result, idle } = await opened({ dupOfA: true });
    await pickB0(result, idle);
    // the primary's bytes gone from the device, the sheet loaded them again
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(a0);
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(a0, new Response('a0', { status: 200 }));
    // every kept list read but figure 0's held: only the pick path can draw it
    let release: () => void = () => {};
    const held = new Promise<void>((res) => (release = res));
    const own = new URL(`/__fc/image-list/${encodeURIComponent(headOf(0))}`, self.location.href).href;
    const open = storage.open.bind(storage);
    const spy = vi.spyOn(storage, 'open').mockImplementation(async (n: string) => {
      const cache = await open(n);
      if (n !== IMAGE_LISTS_CACHE) return cache;
      const match = cache.match.bind(cache);
      return Object.assign(Object.create(cache) as Cache, {
        match: async (...args: Parameters<Cache['match']>) => {
          if ((args[0] instanceof Request ? args[0].url : String(args[0])) !== own) await held;
          return match(...args);
        },
        keys: cache.keys.bind(cache),
      });
    });
    try {
      act(() => setPhotoChoice(SUB, headOf(0), a0));
      await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(a0), { timeout: 2000 });
    } finally {
      release();
      spy.mockRestore();
    }
    await idle();
  }, 20_000);
});
