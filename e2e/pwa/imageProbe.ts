// Runs in the page (bundled by web.ts): drives the app's own owned-image sync
// (src/media/ownedImages.ts) against the browser's real caches and worker, with
// the image lists given here instead of the coordinator's, and the message a
// completed sync tells every other tab (src/hooks/imageAnswers.ts), heard by a
// QueryClient of this document's own.
import { QueryClient } from '@tanstack/react-query';
import { hearOwnedSyncs, tellOwnedSync } from '../../src/hooks/imageAnswers';
import { keptImage, syncOwnedImages, type OwnedImageSync } from '../../src/media/ownedImages';

export interface ProbeImage {
  url: string;
  primary?: boolean;
  maskUrl?: string;
}

export async function syncOwned(heads: string[], lists: Record<string, ProbeImage[]>): Promise<OwnedImageSync> {
  const asListed = (i: ProbeImage) => ({
    derivativeId: '',
    role: 'gallery',
    width: 1,
    height: 1,
    primary: i.primary === true,
    url: i.url,
    ...(i.maskUrl === undefined ? {} : { mask: { maskId: '', contentType: 'image/png', url: i.maskUrl } }),
  });
  return syncOwnedImages(heads, async (asked) => new Map(asked.filter((h) => h in lists).map((h) => [h, lists[h]!.map(asListed) as never])));
}

export async function kept(head: string): Promise<string | null> {
  return (await keptImage(head))?.url ?? null;
}

/** This document's QueryClient, as the app's: it hears other tabs' syncs once it answers an image. */
const client = new QueryClient();

/** The figure page's answer for a figure, as useProductImage gives it (in reach); this client hears from then on. */
export function answer(head: string, url: string): boolean {
  client.setQueryData(['local', 'image', head, true], { url, width: 1, height: 1 });
  return hearOwnedSyncs(client) !== undefined;
}

/** The figure page answers this document's QueryClient holds. */
export function answers(): number {
  return client.getQueryCache().findAll({ queryKey: ['local', 'image'] }).length;
}

/** Tell every other tab that this document's sync completed. */
export function tell(): void {
  tellOwnedSync(client);
}

// Init scripts may be wrapped in a function scope; publish explicitly.
(globalThis as unknown as { fcImageProbe: unknown }).fcImageProbe = { syncOwned, kept, answer, answers, tell };
