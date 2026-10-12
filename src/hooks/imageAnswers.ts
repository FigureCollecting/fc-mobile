// ADDR-1: what a completed owned sync (src/hooks/useOwnedImages.ts) does to the image answers of the
// case view's hook (useOwnedImages) and the figure page's (useProductImage), in every open document
// of the app. Each document (a tab, the installed window) has its own QueryClient over the same
// caches, which hears other documents' syncs from its first image answer on. The one that ran the
// sync drops its earlier answers but the sync's own, and tells every other one on a BroadcastChannel
// (never itself); each other one drops all of its earlier answers when told. A case view open in a
// document told answers again from what that sync kept, without a sync of its own, so two open case
// views never sync each other. A sync whose case view went away part way, once it may have recorded
// what it withholds, is told too, as stopped, and so is one that left an image unfetched (abandoned
// on a stalled link, refused), its case view open or not: a case view of the told document inside
// its own sync (waiting for the lock, or holding it) is then left to finish it, reading the lists
// itself, neither stopped nor asked again. Where the browser has no BroadcastChannel, no other
// document is told.
// Every answer that names an address the sync withheld, that case view's too, shown or opened while
// the drop reads the record, stops naming it once the record is read, before the drop asks it again
// (the figure page answers the plate; the case view drops that figure, or only its mask), so none
// waits on the coordinator's answer, which a stalled link can hold back for as long as the ask's
// deadline, nor on that case view's own sync. An answer that stops naming an address keeps its age:
// that case view gone before its sync ends answers, opened again, the answer without the address, and
// syncs as it would have. src/hooks/__tests__/imageAnswersAfterSync.test.tsx; in Chromium, e2e/pwa (b) another tab.
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { withheldAmong, type CachedImage } from '../media/ownedImages';

/** The channel every document of the app hears another's completed sync on: one name across builds. */
export const OWNED_SYNC_CHANNEL = 'fc-owned-images';

const isImageAnswer = (key: QueryKey): boolean => key[0] === 'local' && (key[1] === 'owned-images' || key[1] === 'image');
const channels = new WeakMap<QueryClient, BroadcastChannel>();
/** Per QueryClient, the case views (query hashes) told to answer again from what another document's sync kept. */
const toldOfSync = new WeakMap<QueryClient, Set<string>>();
/** Per QueryClient, each run of a case view (its query hash) inside its own sync. */
const inOwnSync = new WeakMap<QueryClient, Set<{ hash: string }>>();
/** What a document tells the others of its sync: it completed, or it stopped part way (its case view went away) or left an image unfetched. */
export type OwnedSyncEnd = 'synced' | 'stopped';

/** The addresses an image answer names: the figure page's image; each of the case view's images and masks. */
function addressesIn(key: QueryKey, data: unknown): string[] {
  if (data === undefined || data === null) return [];
  if (key[1] === 'image') return [(data as { url: string }).url];
  return [...(data as ReadonlyMap<string, CachedImage>).values()].flatMap((i) => (i.maskUrl === undefined ? [i.url] : [i.url, i.maskUrl]));
}

/** The answer without a withheld address: the figure page's is the plate; the case view loses a figure whose image is withheld, and a withheld mask. */
function without(key: QueryKey, data: unknown, withheld: ReadonlySet<string>): unknown {
  if (key[1] === 'image') return null;
  const out = new Map<string, CachedImage>();
  for (const [head, image] of data as ReadonlyMap<string, CachedImage>) {
    if (withheld.has(image.url)) continue;
    if (image.maskUrl !== undefined && withheld.has(image.maskUrl)) {
      const { maskUrl: _withheld, ...rest } = image;
      out.set(head, rest);
    } else out.set(head, image);
  }
  return out;
}

/**
 * No earlier image answer of this client stands but `own` and the `spare`d ones (a case view inside its
 * own sync, told of a stopped one): one still being read is stopped, so it is read again; one a view
 * shows is asked again; any other is dropped, so a view that opens later asks. A spared answer is
 * neither stopped nor asked again: its own sync answers next. Every answer but `own`, shown or not,
 * spared or not, that names an address the sync recorded as withheld stops naming it as soon as the
 * record is read, before this asks it again (the re-ask of a figure page online is a coordinator round
 * trip); so does one a view opens while the record is read, even one already asking. It keeps its age
 * (dataUpdatedAt), so a spared answer its case view's going away reverts to it is as old as before.
 */
export async function dropImageAnswers(client: QueryClient, own?: QueryKey, spare: ReadonlySet<string> = new Set()): Promise<void> {
  const ownHash = own === undefined ? undefined : hashKey(own);
  const named = (q: { queryKey: QueryKey; queryHash: string }) => q.queryHash !== ownHash && isImageAnswer(q.queryKey);
  const predicate = (q: { queryKey: QueryKey; queryHash: string }) => named(q) && !spare.has(q.queryHash);
  await client.cancelQueries({ fetchStatus: 'fetching', predicate });
  const answers = client.getQueryCache().findAll({ predicate: named });
  const withheld = await withheldAmong(answers.flatMap((q) => addressesIn(q.queryKey, q.state.data)));
  for (const q of answers) {
    if (addressesIn(q.queryKey, q.state.data).some((u) => withheld.has(u))) {
      client.setQueryData(q.queryKey, without(q.queryKey, q.state.data, withheld), { updatedAt: q.state.dataUpdatedAt });
    }
  }
  client.removeQueries({ type: 'inactive', predicate });
  await client.invalidateQueries({ predicate });
}

/**
 * Another document's sync completed, or stopped part way or left an image unfetched: drop every image
 * answer, an open case view answering from what that sync kept. Told of a stopped sync, a case view
 * inside its own sync is left to finish it: it reads the lists after the other let go of the lock, its
 * answer meanwhile naming nothing the record withholds.
 */
async function toldOfAnotherSync(client: QueryClient, end: OwnedSyncEnd): Promise<void> {
  const syncing = new Set(end === 'stopped' ? [...(inOwnSync.get(client) ?? [])].map((run) => run.hash) : []);
  const open = client
    .getQueryCache()
    .findAll({ type: 'active', predicate: (q) => q.queryKey[0] === 'local' && q.queryKey[1] === 'owned-images' })
    .map((q) => q.queryHash);
  const told = toldOfSync.get(client) ?? new Set<string>();
  toldOfSync.set(client, told);
  for (const h of open) told.add(h);
  try {
    await dropImageAnswers(client, undefined, syncing);
  } finally {
    for (const h of open) told.delete(h);
  }
}

/**
 * This client's channel, opened the first time it answers an image: from then on it hears every other
 * document's completed sync. Undefined where the browser has no BroadcastChannel.
 */
export function hearOwnedSyncs(client: QueryClient): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  let channel = channels.get(client);
  if (channel === undefined) {
    channel = new BroadcastChannel(OWNED_SYNC_CHANNEL);
    channel.onmessage = (e: MessageEvent) => void toldOfAnotherSync(client, e.data === 'stopped' ? 'stopped' : 'synced');
    channels.set(client, channel);
  }
  return channel;
}

/** Tell every other document a sync completed or stopped, on this client's own channel, which never hears its own message. */
export function tellOwnedSync(client: QueryClient, end: OwnedSyncEnd): void {
  hearOwnedSyncs(client)?.postMessage(end);
}

/** Run this case view's own sync, marked as inside it (toldOfAnotherSync) until it settles. */
export async function duringOwnSync<T>(client: QueryClient, key: QueryKey, sync: () => Promise<T>): Promise<T> {
  const run = { hash: hashKey(key) };
  const runs = inOwnSync.get(client) ?? new Set<{ hash: string }>();
  inOwnSync.set(client, runs);
  runs.add(run);
  try {
    return await sync();
  } finally {
    runs.delete(run);
  }
}

/** Whether this case view answers again from what another document's sync kept, without a sync of its own. */
export function answersFromKept(client: QueryClient, key: QueryKey): boolean {
  return toldOfSync.get(client)?.has(hashKey(key)) === true;
}
