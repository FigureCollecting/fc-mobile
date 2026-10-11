// Runs in the page (bundled by web.ts): drives the app's own owned-image sync
// (src/media/ownedImages.ts) against the browser's real caches and worker, with
// the image lists given here instead of the coordinator's.
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

// Init scripts may be wrapped in a function scope; publish explicitly.
(globalThis as unknown as { fcImageProbe: unknown }).fcImageProbe = { syncOwned, kept };
