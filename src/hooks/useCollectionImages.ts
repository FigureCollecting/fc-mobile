// ADDR-1: the image of each figure in the collection for the case view, online and offline: owned,
// ordered and wished, owned first (FB-QUICK, Ross 10-16: his Ordered and Wished stood as plates).
// Signed in and in reach (the browser online AND the sync engine's probe having been answered),
// the caches are brought to the kept figures (src/media/keptImages.ts: their lists replaced, their primary images and masks
// fetched, everything else evicted, a withheld address recorded); out of reach, or when that sync
// fails, what the last one kept stands and nothing more is asked. A figure answers the image the last
// sync kept, and only if its bytes were on the device when asked and no sync recorded it withheld; one
// without is absent, and the case draws its plate.
// One rule for what a sync tells. Once it has read the lists (they arrived, its case view still open),
// however it ends, no earlier answer of this hook or of useProductImage stands, offline or online, in
// the document that ran it or in any other open document of the app, each told on a BroadcastChannel
// (src/hooks/imageAnswers.ts): as synced when it completes with every image fetched; as stopped when it
// ends any other way (its case view gone, an image left unfetched: abandoned on a stalled link,
// refused; a write the device refused, its first record's too). One being read is read again, one a
// view shows is asked again, any other is dropped, so neither answers an image that sync withheld
// (src/hooks/__tests__/imageAnswersAfterSync.test.tsx); a withheld mask whose record the device
// refused is the exception: the case view names it until a later sync records it, though its bytes
// are gone (src/media/keptImages.ts). A sync whose read of the lists fails, or whose
// case view goes away before they arrive, touches no cache and tells nothing: what the last one kept
// stands. An answer that names an address that sync withheld, shown or opened while the document reads
// what it withheld, stops naming it once that is read, not once the coordinator answers; so does the
// answer a stopped sync's case view, going away, reverted it to, which stands for when it opens again.
// A case view told of another document's completed sync answers from what it kept, without a sync of
// its own; told of a stopped one, a case view inside its own sync (waiting for the lock, or holding
// it) is left to finish it, its answer standing until then without what that sync withheld, and
// records what the lists it reads withhold.
// Where the browser has Web Locks, documents sync one at a time (src/media/keptImages.ts), so a sync
// that read older lists never undoes what a later one withheld. A collection with no image costs a few
// cache calls, not a few per figure, and a sync stops when the case view goes away (its fetches in
// flight aborted) or a step of it stalls (src/media/keptImages.ts KEPT_SYNC_STEP_MS).
// IMG-SHOW-1: a sync of a large collection takes minutes (two images a figure), so the case view never
// waits on it: it shows at once what the device kept, then each image as the sync keeps it (at most
// every KEPT_SHOWN_EVERY_MS). Such an answer, and that of a sync that left an image unfetched, is
// partial: never fresh, so the case view opened again syncs again, fetching only what is missing. A
// case view gone part way keeps its last partial answer, for when it opens again.
import { useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, keepChosenPhotos, keptImages, syncKeptImages, MAX_KEPT_FIGURES, type CachedImage } from '../media/keptImages';
import { usePhotoChoices } from '../media/photoChoice';
import { answersFromKept, dropImageAnswers, duringOwnSync, hearKeptSyncs, tellKeptSync } from './imageAnswers';
import { useOnlineStatus } from './useOnlineStatus';

const EMPTY: ReadonlyMap<string, CachedImage> = new Map();
/** The answer while a signed-in device's first one is on its way: not complete, whatever it will turn out to hold. */
const LOADING: ReadonlyMap<string, CachedImage> = new Map();
/** The holdings whose figures' images are kept, owned first: past MAX_KEPT_FIGURES, the last are left out. */
const KEPT_KINDS = ['owned', 'ordered', 'wished'] as const;
/** How often the case view is drawn again with what its sync has kept so far. */
const KEPT_SHOWN_EVERY_MS = 1000;
/** The answers of syncs that did not complete: never fresh. */
const partial = new WeakSet<ReadonlyMap<string, CachedImage>>();

/** Shows each answer a sync tells, at most every KEPT_SHOWN_EVERY_MS and the latest last, until the sync aborts or `stop`. */
function showKept(client: QueryClient, key: QueryKey, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownAt = -Infinity;
  let latest: ReadonlyMap<string, CachedImage> = EMPTY;
  const flush = () => {
    timer = undefined;
    shownAt = Date.now();
    // the case view gone: the answer it showed last stands
    if (signal.aborted) return;
    partial.add(latest);
    client.setQueryData(key, latest);
  };
  return {
    show: (kept: ReadonlyMap<string, CachedImage>) => {
      latest = kept;
      timer ??= setTimeout(flush, Math.max(0, shownAt + KEPT_SHOWN_EVERY_MS - Date.now()));
    },
    stop: () => clearTimeout(timer),
  };
}

/**
 * LAYOUT-STABLE-1: whether this answer is the last the pictures will give: not the first answer still on its way, not one
 * shown while the sync is fetching (each is partial), and not that of a sync that left an image unfetched. The case lays
 * its wall out once more when it is, and otherwise after a quiet spell (layoutBasis.ts). Signed out, nothing streams in.
 */
export const imagesComplete = (answer: ReadonlyMap<string, CachedImage>): boolean => answer !== LOADING && !partial.has(answer);

export function useCollectionImages(): ReadonlyMap<string, CachedImage> {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  // STALE-CONTENT: in reach is the server having ANSWERED, not merely not having failed: before the first probe (a cold launch,
  // the radio warming) a sync would fail, and its answer would stand as fresh for ten minutes after the connection came
  // back. The key changes when the server is reached, so the sync runs then, once, and again after any outage.
  const reachable = online && session?.engine.state.value.reachability === 'reachable';
  const keptHeads = useCallback(
    (s: Snapshot): string[] => [...new Set(KEPT_KINDS.flatMap((kind) => s.figures.filter((f) => f.local.kind === kind).map((f) => f.local.headId).sort()))],
    [],
  );
  const heads = useSnapshot(keptHeads).data;
  // GALLERY-1: the photo the user chose per figure is the one kept and shown; a change of choice for a kept figure is a new
  // answer (a sync that fetches the chosen photo and its mask), a choice for any other is not
  const allChoices = usePhotoChoices();
  const choiceKey = (heads ?? []).filter((h) => allChoices.has(h)).map((h) => `${h}=${allChoices.get(h)}`).join(',');
  const signedIn = session !== undefined && phase === 'signed-in';
  const enabled = signedIn && heads !== undefined;
  const query = useQuery<ReadonlyMap<string, CachedImage>>({
    queryKey: ['local', 'kept-images', reachable, heads?.join(',') ?? '', choiceKey],
    // The query's signal is consumed, so a sync stops when the case view goes away or a newer one
    // replaces it: aborted while it reads the lists, it touches no cache; while it fetches images, the
    // fetches in flight are aborted and no other starts.
    queryFn: async ({ signal, client, queryKey }) => {
      hearKeptSyncs(client);
      const kept = (heads ?? []).slice(0, MAX_KEPT_FIGURES);
      let incomplete = false;
      if (reachable && !answersFromKept(client, queryKey)) {
        const shown = showKept(client, queryKey, signal);
        shown.show(await keptImages(kept, undefined, allChoices));
        let read = false;
        try {
          // PICK-CASE-1: a chosen photo the device lacks is fetched first, from the figure's kept list, so a pick is shown
          // without waiting on every list being read again (tens of seconds for a large collection, never when one call fails)
          if (choiceKey !== '' && (await keepChosenPhotos(kept, allChoices, { signal })) > 0) shown.show(await keptImages(kept, undefined, allChoices));
          const synced = await duringOwnSync(client, queryKey, () =>
            syncKeptImages(kept, (h) => fetchImageLists(session!.clients.catalog, h, signal), { signal, onListsRead: () => (read = true), onKept: shown.show, choices: allChoices }),
          );
          void dropImageAnswers(client, queryKey);
          // Stopped part way by the case view going away, or leaving an image unfetched (abandoned on a
          // stalled link, refused): the other documents drop their answers too, and a sync of theirs
          // under way runs on.
          incomplete = synced.failed > 0;
          tellKeptSync(client, signal.aborted || incomplete ? 'stopped' : 'synced');
        } catch (err) {
          // Failed or stopped after it read the lists (a write refused, its case view gone): told as
          // stopped, as one that leaves an image unfetched is. Its own run is spared, neither stopped
          // nor run again.
          if (read) {
            incomplete = true;
            void dropImageAnswers(client, queryKey);
            tellKeptSync(client, 'stopped');
          }
          if (signal.aborted) throw err;
          // The server did not answer (UNAVAILABLE, a fault, a lost connection): what the last sync kept stands, shown, but a
          // sync that failed is no answer to keep fresh: partial, so it syncs again once the server is reached (STALE-CONTENT).
          incomplete = true;
        } finally {
          shown.stop();
        }
      }
      const answer = await keptImages(kept, undefined, allChoices);
      if (incomplete) partial.add(answer);
      return answer;
    },
    enabled,
    staleTime: (q) => (q.state.data !== undefined && partial.has(q.state.data) ? 0 : 10 * 60_000),
    retry: false,
  });
  return query.data ?? (signedIn ? LOADING : EMPTY);
}
