// ADDR-1: what a completed owned sync (src/hooks/useOwnedImages.ts) does to the image answers of the
// case view's hook (useOwnedImages) and the figure page's (useProductImage), in every open document
// of the app. Each document (a tab, the installed window) has its own QueryClient over the same
// caches, which hears other documents' syncs from its first image answer on. The one that ran the
// sync drops its earlier answers but the sync's own, and tells every other one on a BroadcastChannel
// (never itself); each other one drops all of its earlier answers when told. A case view open in a
// document told answers again from what that sync kept, without a sync of its own, so two open case
// views never sync each other. Where the browser has no BroadcastChannel, no other document is told.
// An answer a view shows that names an address the sync withheld stops naming it before it is asked
// again (the figure page answers the plate; the case view drops that figure, or only its mask), so
// none waits on the coordinator's answer, which a stalled link can hold back for as long as the ask's
// deadline. src/hooks/__tests__/imageAnswersAfterSync.test.tsx; in Chromium, e2e/pwa (b) another tab.
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { withheldAmong, type CachedImage } from '../media/ownedImages';

/** The channel every document of the app hears another's completed sync on: one name across builds. */
export const OWNED_SYNC_CHANNEL = 'fc-owned-images';

const isImageAnswer = (key: QueryKey): boolean => key[0] === 'local' && (key[1] === 'owned-images' || key[1] === 'image');
const channels = new WeakMap<QueryClient, BroadcastChannel>();
/** Per QueryClient, the case views (query hashes) told to answer again from what another document's sync kept. */
const toldOfSync = new WeakMap<QueryClient, Set<string>>();

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
 * No earlier image answer of this client stands but `own`: one still being read is stopped, so it is
 * read again; one a view shows is asked again; any other is dropped, so a view that opens later asks.
 * A shown answer that names an address the sync recorded as withheld stops naming it at once, before
 * it is asked again: the re-ask of a figure page online is a coordinator round trip.
 */
export async function dropImageAnswers(client: QueryClient, own?: QueryKey): Promise<void> {
  const ownHash = own === undefined ? undefined : hashKey(own);
  const predicate = (q: { queryKey: QueryKey; queryHash: string }) => q.queryHash !== ownHash && isImageAnswer(q.queryKey);
  await client.cancelQueries({ fetchStatus: 'fetching', predicate });
  const shown = client.getQueryCache().findAll({ type: 'active', predicate });
  const withheld = await withheldAmong(shown.flatMap((q) => addressesIn(q.queryKey, q.state.data)));
  for (const q of shown) {
    if (addressesIn(q.queryKey, q.state.data).some((u) => withheld.has(u))) client.setQueryData(q.queryKey, without(q.queryKey, q.state.data, withheld));
  }
  client.removeQueries({ type: 'inactive', predicate });
  await client.invalidateQueries({ predicate });
}

/** Another document's sync completed: drop every image answer, an open case view answering from what it kept. */
async function toldOfAnotherSync(client: QueryClient): Promise<void> {
  const open = client
    .getQueryCache()
    .findAll({ type: 'active', predicate: (q) => q.queryKey[0] === 'local' && q.queryKey[1] === 'owned-images' })
    .map((q) => q.queryHash);
  const told = toldOfSync.get(client) ?? new Set<string>();
  toldOfSync.set(client, told);
  for (const h of open) told.add(h);
  try {
    await dropImageAnswers(client);
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
    channel.onmessage = () => void toldOfAnotherSync(client);
    channels.set(client, channel);
  }
  return channel;
}

/** Tell every other document a sync completed, on this client's own channel, which never hears its own message. */
export function tellOwnedSync(client: QueryClient): void {
  hearOwnedSyncs(client)?.postMessage('synced');
}

/** Whether this case view answers again from what another document's sync kept, without a sync of its own. */
export function answersFromKept(client: QueryClient, key: QueryKey): boolean {
  return toldOfSync.get(client)?.has(hashKey(key)) === true;
}
