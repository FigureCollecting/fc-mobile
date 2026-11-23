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
// stands (LOAD2: but for a figure it kept no list for, whose list and images it keeps as soon as its batch is read; such a
// figure withholds nothing). An answer that names an address that sync withheld, shown or opened while the document reads
// what it withheld, stops naming it once that is read, not once the coordinator answers; so does the
// answer a stopped sync's case view, going away, reverted it to, which stands for when it opens again.
// A case view told of another document's completed sync answers from what it kept, without a sync of
// its own; told of a stopped one, a case view inside its own sync (waiting for the lock, or holding
// it) is left to finish it, its answer standing until then without what that sync withheld, and
// records what the lists it reads withhold.
// Where the browser has Web Locks, documents sync one at a time (src/media/keptImages.ts), so a sync
// that read older lists never undoes what a later one withheld. A collection with no image costs a few
// cache calls, not a few per figure, and a sync stops when the case view goes away (its fetches in
// flight aborted), a list call stalls or the image link is dead (src/media/keptImages.ts KEPT_SYNC_STEP_MS).
// PHOTOS1 (Ross 11-04: past the first cabinets the case stood as name cards for as long as the page stayed open): what a
// sync that read the lists left unfetched is fetched by a fill (src/media/keptImages.ts fillKeptImages, from the kept lists,
// asking the coordinator nothing) at the sync engine's next completed pass, and when the case view tells a new order (Free
// camera walking, the old camera moving), in that order; never while a sync runs, and a sync stops a fill first. A display
// copy the server has not made yet (a 404) is not an image left unfetched: such a sync is told synced and its answer is
// complete, and the first pass ABSENT_RECHECK_MS later asks for it again (src/media/keptImages.ts), never a walk or pass before.
// IMG-SHOW-1: a sync of a large collection takes minutes (two images a figure), so the case view never
// waits on it: it shows at once what the device kept, then each image as the sync keeps it (at most
// every KEPT_SHOWN_EVERY_MS). Such an answer, and that of a sync that left an image unfetched, is
// partial: never fresh, so the case view opened again syncs again, fetching only what is missing. A
// case view gone part way keeps its last partial answer, for when it opens again.
// NEWHOLD-IMG-1 (Ross 10-31: 90 copies pushed from another device stood as plates; one list call answered 503): a sync that
// could not read the lists (the server did not answer one, or another document's sync held the lock past its wait) syncs
// again once the sync engine next completes a pass, its Collection page still open: the server stayed in reach, so no key
// changed, and figures held since the last sync that read them had no image until the Collection page was opened again.
// FETCH-FIRST (10-31: on a slow link, the case arranged by series, its default, the first figure in view stood as its plate
// for about a minute, the images fetched in head-id order): the case view tells the heads it shows, then the rest as it
// stands them (setFetchOrder), and a sync fetches what is missing in that order, followed as the view moves, then the
// other kept figures'. What a sync keeps, and when its answer is complete, are the same in any order.
import { useQuery, useQueryClient, type QueryClient, type QueryKey, type QueryState } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, fillKeptImages, keepChosenPhotos, keepListless, keptImage, keptImages, syncKeptImages, unlisted, withheldAddresses, ABSENT_RECHECK_MS, MAX_KEPT_FIGURES, type CachedImage, type KeptImageFill } from '../media/keptImages';
import { usePhotoChoices, type PhotoChoices } from '../media/photoChoice';
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
/** The answers of syncs that could not read the lists: synced again after the sync engine's next completed pass. */
const unread = new WeakSet<ReadonlyMap<string, CachedImage>>();
/** SC-IMGKEY: the answers given out of reach, from what the device kept: synced once the server is reached. */
const unsynced = new WeakSet<ReadonlyMap<string, CachedImage>>();
/** How long a synced answer stands before the case view opened again, or the server reached again, syncs again. */
const FRESH_FOR_MS = 10 * 60_000;
const freshFor = (data: ReadonlyMap<string, CachedImage> | undefined): number =>
  data !== undefined && (partial.has(data) || unsynced.has(data)) ? 0 : FRESH_FOR_MS;
/**
 * SC-IMGKEY: whether an answer asks a sync when the server is reached: none yet; one given out of reach or partial, whatever
 * its age; one FRESH_FOR_MS old; and one dated ahead of the clock (the clock stepped back), whose age cannot be told.
 */
function due(state: QueryState<ReadonlyMap<string, CachedImage>> | undefined): boolean {
  if (state === undefined || state.data === undefined || freshFor(state.data) === 0) return true;
  const age = Date.now() - state.dataUpdatedAt;
  return age < 0 || age >= FRESH_FOR_MS;
}
/**
 * SC-IMGKEY: after a sync started by the server reached again, how long nothing syncs again: a recovery or pass due in that
 * time is owed, and runs when it is over (no engine pass needed), so a flapping link costs one sync, not one a flap.
 */
export const REACH_SETTLE_MS = 10_000;
/** FETCH-FIRST: the heads the case view shows, then the rest as it stands them; the last case view's until another tells. */
let fetchOrder: readonly string[] = [];
/** PHOTOS1: told when the case view tells a new order. */
const orderHeard = new Set<() => void>();
/**
 * PHOTOS1: the answers of a sync or a fill that left images unfetched, and when a fill may fetch them: at once after a sync
 * the link failed some of; after a fill it failed some of, when the soonest address it was refused may be asked again (its
 * wait doubling at each refusal, src/media/keptImages.ts REFUSED_WAIT_MS), and REFILL_AFTER_MS on at the soonest; and
 * ABSENT_RECHECK_MS on when the only ones left are display copies not made yet (404); so neither a walk nor a pass asks for
 * them in a loop. A fill the device refused an image for want of space leaves nothing for a fill: the next sync asks.
 */
const leftover = new WeakMap<ReadonlyMap<string, CachedImage>, number>();
/** PHOTOS1: when what this sync or fill left may be fetched (leftover), or undefined when it left nothing a fill may fetch. */
const leftAfter = (done: KeptImageFill, failedAfterMs: number): number | undefined =>
  done.full === true
    ? undefined
    : done.failed > 0
      ? Math.max(Date.now() + failedAfterMs, done.retryAt ?? -Infinity)
      : done.absent > 0
        ? Date.now() + ABSENT_RECHECK_MS
        : undefined;
/** PHOTOS1: how long a fill that left an image unfetched waits at least before another asks for it. */
export const REFILL_AFTER_MS = 30_000;
/** PHOTOS1: a new order starts a fill this long after the case view stops telling new ones (a walk tells one each step). */
export const FILL_AFTER_ORDER_MS = 250;
/** PHOTOS1: the fill under way in this document (one at a time); LISTLESS-RECHECK's read of the lists takes the same place. */
let filling: { stop: () => void; done: Promise<void> } | undefined;
/**
 * LISTLESS-RECHECK (PICS 11-22: figures whose list came back empty stood as plates for as long as the case view stayed open, on
 * two devices, the display copy made meanwhile never asked about): the kept figures a sync that read the lists left with no
 * kept list, asked about again (their lists alone, src/media/keptImages.ts keepListless) at the first visible pass
 * LISTLESS_RECHECK_MS after it, then after a wait that doubles at each answer that lists none of them, at most
 * LISTLESS_RECHECK_MAX_MS: so a figure with no image ever costs about a call an hour. A figure listed since leaves them; a read
 * that fails is asked again a wait later, the wait not doubled.
 */
const listless = new WeakMap<ReadonlyMap<string, CachedImage>, { heads: readonly string[]; at: number; wait: number }>();
export const LISTLESS_RECHECK_MS = 10 * 60_000;
export const LISTLESS_RECHECK_MAX_MS = 60 * 60_000;
const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** FETCH-FIRST: the case view's heads, those it shows first: the sync or fill under way fetches in this order from its next fetch on. */
export function setFetchOrder(heads: readonly string[]): void {
  fetchOrder = heads;
  for (const heard of orderHeard) heard();
}

/** PHOTOS1: the fill under way stopped, its fetches in flight aborted, and ended (so a sync never waits for its lock). */
async function stopFill(): Promise<void> {
  const under = filling;
  if (under === undefined) return;
  under.stop();
  await under.done;
}

/**
 * Shows each answer a sync tells, at most every KEPT_SHOWN_EVERY_MS and the latest last, until the sync aborts or `stop`.
 * PICK-SLOW: `show` lays the pictures `held` on screen (standing) over the answer; `pick` lays a chosen photo just kept over
 * `base` (the answer on screen) and every answer told after it, the first pick drawn at once, later ones with the next
 * drawing; so a pick never waits on the read of every kept figure.
 * PICK-SLOW (CHAL4 SHOULD-1/2: a pick already drawn, and the answer a run spared by the run it replaced had read, stood on
 * screen after a sync withheld them): each drawing reads the withheld records first and draws no picture recorded withheld,
 * whichever it is (told, laid, held, picked), and no mask recorded withheld; a held picture or a pick whose photo is withheld
 * gives way to the answer's own picture of its figure. A drawing whose read is overtaken by a later one is not drawn, nor one
 * that ends after `stop`; one whose read fails draws nothing (what is on screen stands until the next drawing or the run's
 * answer).
 */
function showKept(client: QueryClient, key: QueryKey, signal: AbortSignal, base: ReadonlyMap<string, CachedImage> = EMPTY) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownAt = -Infinity;
  let told: ReadonlyMap<string, CachedImage> = base;
  let holding: ReadonlyMap<string, CachedImage> = EMPTY;
  let stopped = false;
  let drawing = 0;
  const picked = new Map<string, CachedImage>();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    shownAt = Date.now();
    const n = (drawing += 1);
    void withheldAddresses().then(
      (gone) => {
        // the case view gone: the answer it showed last stands; stopped, nothing told late is drawn over the run's own answer
        if (signal.aborted || stopped || n !== drawing) return;
        const drawn = new Map<string, CachedImage>();
        for (const [head, image] of [...told, ...holding, ...picked]) {
          const clear = cleared(image, gone);
          if (clear !== undefined) drawn.set(head, clear);
        }
        partial.add(drawn);
        client.setQueryData(key, drawn);
      },
      () => undefined,
    );
  };
  const later = () => {
    timer ??= setTimeout(flush, Math.max(0, shownAt + KEPT_SHOWN_EVERY_MS - Date.now()));
  };
  const show = (kept: ReadonlyMap<string, CachedImage>, held: ReadonlyMap<string, CachedImage> = EMPTY) => {
    told = kept;
    holding = held;
    later();
  };
  return {
    show,
    pick: (head: string, image: CachedImage) => {
      const first = picked.size === 0;
      picked.set(head, image);
      if (first) flush();
      else later();
    },
    /** A figure's picture whose bytes the device already holds, drawn at once over the answer on screen (the run's reads answer it too). */
    lay: (head: string, image: CachedImage) => {
      told = new Map(told).set(head, image);
      flush();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** A picture as drawn given the withheld addresses: none when its photo is withheld, without its mask when that is. */
function cleared(image: CachedImage, gone: ReadonlySet<string>): CachedImage | undefined {
  if (gone.has(image.url)) return undefined;
  if (image.maskUrl === undefined || !gone.has(image.maskUrl)) return image;
  const { maskUrl: _withheld, ...rest } = image;
  return rest;
}

/**
 * PICK-SLOW (CHAL3 SHOULD-1: on a slow link the run's read of every kept figure drew the primary over the earlier pick for the
 * whole of the pick's download): what a run draws of an answer it read or its sync told. A figure whose chosen photo that answer
 * does not name yet (not here, or withheld) keeps the picture `was` on screen when the run began, until the chosen photo is kept
 * (showKept's pick) or the run ends with its own answer. Never a picture a sync withheld (taken down): showKept draws none, so it
 * leaves the screen even when it is the one there, the answer's own picture of the figure drawn instead, and one whose mask was
 * withheld stays without it. The pictures kept, laid over the answer by showKept.
 */
function standing(answer: ReadonlyMap<string, CachedImage>, was: ReadonlyMap<string, CachedImage>, choices: PhotoChoices): ReadonlyMap<string, CachedImage> {
  const held = new Map<string, CachedImage>();
  for (const [head, on] of was) {
    const choice = choices.get(head);
    const now = answer.get(head)?.url;
    if (choice !== undefined && now !== choice && now !== on.url) held.set(head, on);
  }
  return held;
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
  // back. SC-IMGKEY (Ross 11-13: the case stood as plates at each launch and each flap): reach is no part of the key, so the
  // answer stands while the server is reached or lost; reaching it refetches an answer due (given out of reach, partial, or
  // older than FRESH_FOR_MS), so the sync runs then, once, and again after any outage, a sync under way running on.
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
  // PICK-SLOW: whose answer it is, so another user's is a new key, and never a placeholder (below)
  const key = ['local', 'kept-images', heads?.join(',') ?? '', choiceKey, session?.sub() ?? ''];
  // PHOTOS1 (X2): whether this case view has synced in reach since it opened, the server not lost since; a sync after that
  // (the kept figures or choices changed) backs off on the addresses refused, as a fill does (keptImages.ts SyncOptions.backOff)
  const syncedInReach = useRef(false);
  if (!reachable) syncedInReach.current = false;
  // SC-IMGKEY: whether the last run started began in reach: a sync, which the server reached again never stops (a run out of reach it does)
  const inReach = useRef(false);
  /** SC-IMGKEY: when the last sync started by the server reached again began; whether one is owed from the wait after it. */
  const recoveredAt = useRef(-Infinity);
  const owed = useRef(false);
  const owedTimer = useRef<ReturnType<typeof setTimeout>>();
  /**
   * SC-IMGKEY: any run pays a sync owed: one in reach (the case view opened again, the kept figures changed) syncs or answers
   * from another document's sync; one out of reach is followed by a reach, which sees to an answer due itself.
   */
  const paid = () => {
    owed.current = false;
    clearTimeout(owedTimer.current);
    owedTimer.current = undefined;
  };
  /** PICK-SLOW: the answer this case view draws now, which a pick is laid over (showKept). */
  const onScreen = useRef<ReadonlyMap<string, CachedImage>>(EMPTY);
  /** PICK-SLOW: whose choices the last run of this case view read, so the next one knows which figures' pictures changed. */
  const ranWith = useRef<{ sub: unknown; choices: PhotoChoices }>();
  /** PICK-SLOW: the key this case view asks now, whose run a run it replaced never stops (queryFn's drop). */
  const asking = useRef<QueryKey>(key);
  asking.current = key;
  const query = useQuery<ReadonlyMap<string, CachedImage>>({
    queryKey: key,
    // PICK-SLOW (Ross 11-19: the case stood as plates for seconds after a pick): a change of choice is a new key, whose first
    // answer comes only after the read of every kept figure; till then the answer drawn stands. Only for the same user and the
    // same kept figures: another user (even on the same figures) or a new collection is never drawn with the last one's pictures.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === key[2] && previousQuery.queryKey[4] === key[4] ? previous : undefined),
    // The query's signal is consumed, so a sync stops when the case view goes away or a newer one
    // replaces it: aborted while it reads the lists, it touches no cache but a new figure's; while it fetches images, the
    // fetches in flight are aborted and no other starts.
    queryFn: async ({ signal, client, queryKey }) => {
      inReach.current = reachable;
      paid();
      hearKeptSyncs(client);
      await stopFill();
      const kept = (heads ?? []).slice(0, MAX_KEPT_FIGURES);
      // PICK-SLOW: the figures whose choice changed since this user's last run ("Use default", a pick), none for another user
      const before = ranWith.current;
      ranWith.current = { sub: queryKey[4], choices: allChoices };
      const changed = before !== undefined && before.sub === queryKey[4] ? kept.filter((h) => before.choices.get(h) !== allChoices.get(h)) : [];
      let incomplete = false;
      let listsUnread = false;
      let left: number | undefined;
      let listsKept = false;
      // LISTLESS-RECHECK (CHAL1 SHOULD-1): an answer from what another document's sync kept (it read the lists) owes the
      // recheck as this one's own sync would, the wait so far carried over from the answer it replaces
      const fromOther = answersFromKept(client, queryKey);
      const owedBefore = fromOther ? listless.get(client.getQueryData<ReadonlyMap<string, CachedImage>>(queryKey) ?? EMPTY) : undefined;
      // PICK-SLOW (CHAL3: a pick during a sync ran again about a second later, having lost which figures changed): a run this
      // case view replaced (a pick, "Use default") drops the other answers as any sync does, but never stops or asks again the
      // run that replaced it, which answers next from its own sync
      const drop = () => {
        const now = client.getQueryCache().find({ queryKey: asking.current, exact: true });
        return dropImageAnswers(client, queryKey, now?.state.fetchStatus === 'fetching' ? new Set([now.queryHash]) : undefined);
      };
      if (reachable && !fromOther) {
        const was = onScreen.current;
        const shown = showKept(client, queryKey, signal, was);
        /** Each answer drawn, a figure whose chosen photo is still coming keeping its picture (standing). */
        const showStanding = (answer: ReadonlyMap<string, CachedImage>) => shown.show(answer, standing(answer, was, allChoices));
        // PICK-SLOW (CHAL1 SHOULD-4): a changed figure whose shown photo is on the device already (the primary after "Use
        // default", a photo picked again) is drawn at once: keepChosenPhotos keeps nothing for it, so tells nothing
        const laid = (async () => {
          for (const head of changed) {
            const image = await keptImage(head, undefined, allChoices);
            const choice = allChoices.get(head);
            // a chosen photo not here yet is keepChosenPhotos's to draw, once kept
            if (image !== undefined && (choice === undefined || image.url === choice)) shown.lay(head, image);
          }
        })().catch(() => undefined);
        // PICK-CASE-1: a chosen photo the device lacks is fetched first, from the figure's kept list, so a pick is shown
        // without waiting on every list being read again (tens of seconds for a large collection, never when one call fails).
        // PICK-SLOW: begun before the read of every kept figure (seconds for a large collection), the newest choice first, each
        // drawn as soon as it is kept (keepChosenPhotos)
        const picks =
          choiceKey === ''
            ? undefined
            : keepChosenPhotos(kept, allChoices, {
                signal,
                onKept: async (head) => {
                  const image = await keptImage(head, undefined, allChoices);
                  // only the chosen photo: told for a kept mask whose photo failed, the device answers the primary, and the picture on screen stands
                  if (image !== undefined && image.url === allChoices.get(head)) shown.pick(head, image);
                },
              });
        // awaited in the sync's try below; until then a failure is not an unhandled one
        picks?.catch(() => undefined);
        showStanding(await keptImages(kept, undefined, allChoices));
        let read = false;
        const backOff = syncedInReach.current;
        syncedInReach.current = true;
        try {
          await laid;
          await picks;
          const synced = await duringOwnSync(client, queryKey, () =>
            syncKeptImages(kept, (h, onBatch, order) => fetchImageLists(session!.clients.catalog, h, signal, onBatch, order), {
              signal,
              onListsRead: () => (read = true),
              onKept: showStanding,
              choices: allChoices,
              first: () => fetchOrder,
              backOff,
            }),
          );
          void drop();
          // Stopped part way by the case view going away, or leaving an image unfetched (abandoned on a
          // stalled link, refused): the other documents drop their answers too, and a sync of theirs
          // under way runs on.
          // PHOTOS1: a display copy not made yet (404) is no image left unfetched: the case lays out at once
          incomplete = synced.failed > 0;
          if (!signal.aborted) {
            left = leftAfter(synced, 0);
            listsKept = true;
          }
          tellKeptSync(client, signal.aborted || incomplete ? 'stopped' : 'synced');
        } catch (err) {
          // Failed or stopped after it read the lists (a write refused, its case view gone): told as
          // stopped, as one that leaves an image unfetched is. Its own run is spared, neither stopped
          // nor run again.
          if (read) {
            incomplete = true;
            void drop();
            tellKeptSync(client, 'stopped');
          }
          if (signal.aborted) throw err;
          // The server did not answer (UNAVAILABLE, a fault, a lost connection): what the last sync kept stands, shown, but a
          // sync that failed is no answer to keep fresh: partial, so it syncs again once the server is reached (STALE-CONTENT).
          incomplete = true;
          listsUnread = !read;
        } finally {
          shown.stop();
        }
      }
      const answer = await keptImages(kept, undefined, allChoices);
      if (!reachable) unsynced.add(answer);
      if (incomplete) partial.add(answer);
      if (listsUnread) unread.add(answer);
      if (left !== undefined) leftover.set(answer, left);
      const none = listsKept || fromOther ? await unlisted(kept) : [];
      if (none.length > 0) listless.set(answer, { at: Date.now() + LISTLESS_RECHECK_MS, wait: LISTLESS_RECHECK_MS, ...owedBefore, heads: none });
      return answer;
    },
    enabled,
    staleTime: (q) => freshFor(q.state.data),
    retry: false,
  });
  onScreen.current = query.data ?? EMPTY;
  const client = useQueryClient();
  // PHOTOS1: what the sync (or a fill) left unfetched, fetched from the kept lists by a fill, never while a sync runs
  const startFill = () => {
    const state = client.getQueryState<ReadonlyMap<string, CachedImage>>(key);
    const data = state?.data;
    if (filling !== undefined || !reachable || !signedIn || state?.fetchStatus !== 'idle' || data === undefined) return;
    const at = leftover.get(data);
    if (at === undefined || at > Date.now()) return;
    const stop = new AbortController();
    const queryKey = key;
    const kept = (heads ?? []).slice(0, MAX_KEPT_FIGURES);
    const choices = allChoices;
    const done = (async () => {
      const shown = showKept(client, queryKey, stop.signal);
      try {
        const filled = await fillKeptImages(kept, { signal: stop.signal, choices, first: () => fetchOrder, onKept: shown.show });
        // another document's sync holds the lock: the next pass or order asks again
        if (filled === undefined || stop.signal.aborted) return;
        shown.stop();
        const again = leftAfter(filled, REFILL_AFTER_MS);
        if (filled.added === 0) {
          if (again === undefined) leftover.delete(data);
          else leftover.set(data, again);
          return;
        }
        const answer = await keptImages(kept, undefined, choices);
        if (stop.signal.aborted) return;
        if (filled.failed > 0) partial.add(answer);
        if (again !== undefined) leftover.set(answer, again);
        const owed = listless.get(data);
        if (owed !== undefined) listless.set(answer, owed);
        client.setQueryData(queryKey, answer);
      } finally {
        shown.stop();
        filling = undefined;
      }
    })();
    filling = { stop: () => stop.abort(), done: done.catch(() => undefined) };
  };
  /** LISTLESS-RECHECK: the kept figures the last sync left with no kept list asked about again, when due; whether it started. */
  const startRecheck = (): boolean => {
    const state = client.getQueryState<ReadonlyMap<string, CachedImage>>(key);
    const data = state?.data;
    if (filling !== undefined || !reachable || !signedIn || state?.fetchStatus !== 'idle' || data === undefined || pageHidden()) return false;
    const owed = listless.get(data);
    if (owed === undefined || owed.at > Date.now()) return false;
    const stop = new AbortController();
    const queryKey = key;
    const kept = (heads ?? []).slice(0, MAX_KEPT_FIGURES);
    const choices = allChoices;
    const catalog = session!.clients.catalog;
    const done = (async () => {
      try {
        const got = await keepListless(owed.heads, (h) => fetchImageLists(catalog, h, stop.signal), { signal: stop.signal, choices, first: () => fetchOrder });
        // another document's sync holds the lock: the next pass asks again
        if (got === undefined || stop.signal.aborted) return;
        const left = owed.heads.filter((h) => !got.listed.has(h));
        const wait = Math.min(2 * owed.wait, LISTLESS_RECHECK_MAX_MS);
        const again = left.length === 0 ? undefined : { heads: left, at: Date.now() + wait, wait };
        if (got.listed.size === 0) {
          listless.set(data, again!);
          return;
        }
        const answer = await keptImages(kept, undefined, choices);
        if (stop.signal.aborted) return;
        if (partial.has(data) || got.filled.failed > 0) partial.add(answer);
        const refill = [leftover.get(data), leftAfter(got.filled, REFILL_AFTER_MS)].filter((at): at is number => at !== undefined);
        if (refill.length > 0) leftover.set(answer, Math.min(...refill));
        if (again !== undefined) listless.set(answer, again);
        client.setQueryData(queryKey, answer);
      } catch {
        // the read failed: asked again a wait later, not at the next pass
        if (!stop.signal.aborted) listless.set(data, { ...owed, at: Date.now() + owed.wait });
      } finally {
        filling = undefined;
        // CHAL1 SHOULD-2: the pass it took still fills what is due (a 404 display copy asked again), as it would have
        if (!stop.signal.aborted) fillNow.current();
      }
    })();
    filling = { stop: () => stop.abort(), done };
    return true;
  };
  const fillNow = useRef(startFill);
  fillNow.current = startFill;
  // PHOTOS1: the case view telling a new order (Free camera walking, the old camera moving) fetches what it now shows
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fillNow.current(), FILL_AFTER_ORDER_MS);
    };
    orderHeard.add(heard);
    return () => {
      orderHeard.delete(heard);
      clearTimeout(timer);
      filling?.stop();
    };
  }, []);
  /** SC-IMGKEY: whether the server reached syncs: the case view enabled, no sync of its own under way, and its answer due. */
  const wantsSync = (): boolean => {
    const state = client.getQueryState<ReadonlyMap<string, CachedImage>>(key);
    return enabled && !(state?.fetchStatus === 'fetching' && inReach.current) && due(state);
  };
  /** How long the wait after a recovery's sync has left; a clock stepped back behind that sync ends it, never stretches it. */
  const settleLeft = (): number => {
    const since = Date.now() - recoveredAt.current;
    return since < 0 ? 0 : REACH_SETTLE_MS - since;
  };
  /**
   * Sync again, at once or, inside REACH_SETTLE_MS of a recovery's sync, owed: paid when the wait is over (owedTimer, or the
   * first render after it), or by any sync in reach before (paid). `recovery` starts that wait.
   */
  const syncAgain = (recovery: boolean) => {
    const left = settleLeft();
    if (left > 0) {
      owed.current = true;
      owedTimer.current ??= setTimeout(() => payOwed.current(), left);
      return;
    }
    paid();
    if (recovery) recoveredAt.current = Date.now();
    void query.refetch();
  };
  // SC-IMGKEY: the wait over, the owed sync runs, whether or not the engine's passes complete; what it cannot run then (the
  // server lost, a sync under way, the answer no longer due) is owed no more: a recovery or that sync sees to it
  const payOwed = useRef(() => {});
  payOwed.current = () => {
    const pay = reachable && wantsSync();
    paid();
    if (pay) void query.refetch();
  };
  useEffect(() => () => clearTimeout(owedTimer.current), []);
  // SC-IMGKEY: the server reached (the first time this case view sees it, or again after an outage) refetches an answer due,
  // stopping a run out of reach but never a sync under way; the answer shown meanwhile stands. Ahead of the pass below, so a
  // recovery and the pass that found the server, told in one render, sync once, as a recovery.
  const wasReachable = useRef(reachable);
  const everReached = useRef(reachable);
  useEffect(() => {
    const was = wasReachable.current;
    wasReachable.current = reachable;
    if (!reachable || was) return;
    const recovery = everReached.current;
    everReached.current = true;
    if (wantsSync()) syncAgain(recovery);
  }, [reachable]);
  // SC-IMGKEY: the first render after the wait (the engine telling anything: a pass begun, failed or completed) pays a sync
  // owed, ahead of the pass below; the timer pays it where none comes
  useEffect(() => {
    if (owed.current && settleLeft() <= 0) payOwed.current();
  });
  // NEWHOLD-IMG-1: a pass the engine completes after a sync that could not read the lists syncs again; never the failure
  // itself (a server still failing is asked again at the next pass, not at once), nor one already under way. PHOTOS1: after
  // one that read them and left an image unfetched, the pass fills instead. SC-IMGKEY: inside REACH_SETTLE_MS of a
  // recovery's sync, such a sync is owed.
  const passedAt = session?.engine.state.value.lastSyncedAt ?? null;
  const seenPass = useRef(passedAt);
  useEffect(() => {
    if (seenPass.current === passedAt) return;
    seenPass.current = passedAt;
    const state = client.getQueryState<ReadonlyMap<string, CachedImage>>(key);
    if (state?.fetchStatus === 'idle' && state.data !== undefined && unread.has(state.data)) syncAgain(false);
    else if (!startRecheck()) startFill();
  }, [passedAt]);
  return query.data ?? (signedIn ? LOADING : EMPTY);
}
