// Runs in the page (bundled by web.ts): drives the app's own owned-image sync
// (src/media/keptImages.ts) against the browser's real caches and worker, with
// the image lists given here instead of the coordinator's, and what the case view
// does once a sync completes (src/hooks/useCollectionImages.ts): it drops this
// document's image answers but its own and tells every other tab
// (src/hooks/imageAnswers.ts), each heard by a QueryClient of its document's own.
// The hooks' wiring of these is unit-tested (src/hooks/__tests__/imageAnswersAfterSync.test.tsx).
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { dropImageAnswers, hearKeptSyncs, tellKeptSync } from '../../src/hooks/imageAnswers';
import { keptImage, syncKeptImages, type KeptImageSync } from '../../src/media/keptImages';

export interface ProbeImage {
  url: string;
  primary?: boolean;
  maskUrl?: string;
}

export async function syncOwned(heads: string[], lists: Record<string, ProbeImage[]>): Promise<KeptImageSync> {
  const asListed = (i: ProbeImage) => ({
    derivativeId: '',
    role: 'gallery',
    width: 1,
    height: 1,
    primary: i.primary === true,
    url: i.url,
    ...(i.maskUrl === undefined ? {} : { mask: { maskId: '', contentType: 'image/png', url: i.maskUrl } }),
  });
  return syncKeptImages(heads, async (asked) => new Map(asked.filter((h) => h in lists).map((h) => [h, lists[h]!.map(asListed) as never])));
}

export async function kept(head: string): Promise<string | null> {
  return (await keptImage(head))?.url ?? null;
}

/** This document's QueryClient, as the app's: it hears other tabs' syncs once it answers an image. */
const client = new QueryClient();

const pageKey = (head: string) => ['local', 'image', head, true];
/** The case view's key in reach, its owned figures the one given (useCollectionImages). */
const caseViewKey = (head: string) => ['local', 'kept-images', true, head];

/** The figure page's answer for a figure, as useProductImage gives it (in reach), no page open; this client hears from then on. */
export function answer(head: string, url: string): boolean {
  client.setQueryData(pageKey(head), { url, width: 1, height: 1 });
  return hearKeptSyncs(client) !== undefined;
}

/** A figure page open on the figure, showing this image; asked again, the coordinator never answers (a stalled link). */
export function show(head: string, url: string): boolean {
  client.setQueryData(pageKey(head), { url, width: 1, height: 1 });
  new QueryObserver(client, { queryKey: pageKey(head), queryFn: () => new Promise<never>(() => {}), staleTime: Infinity }).subscribe(() => {});
  return hearKeptSyncs(client) !== undefined;
}

/** What the open figure page answers now (null: the plate), and whether it is asking again. */
export function shown(head: string): { url: string | null; asking: boolean } {
  const state = client.getQueryState<{ url: string } | null>(pageKey(head));
  return { url: state?.data?.url ?? null, asking: state?.fetchStatus === 'fetching' };
}

/** The case view's own answer, as useCollectionImages gives it: the figure drawn with this image. */
export function caseView(head: string, url: string): void {
  client.setQueryData(caseViewKey(head), new Map([[head, { url, width: 1, height: 1, role: 'gallery', primary: true }]]));
  hearKeptSyncs(client);
}

/** Whether the case view's own answer still stands. */
export function caseViewStands(head: string): boolean {
  return client.getQueryData(caseViewKey(head)) !== undefined;
}

/** The figure page answers this document's QueryClient holds, shown or not. */
export function answers(): number {
  return client.getQueryCache().findAll({ queryKey: ['local', 'image'] }).length;
}

/** What the case view does once its sync completes: drop this document's image answers but its own, then tell every other tab. */
export function completed(head: string): void {
  void dropImageAnswers(client, caseViewKey(head));
  tellKeptSync(client, 'synced');
}

// Init scripts may be wrapped in a function scope; publish explicitly.
(globalThis as unknown as { fcImageProbe: unknown }).fcImageProbe = { syncOwned, kept, answer, show, shown, caseView, caseViewStands, answers, completed };
