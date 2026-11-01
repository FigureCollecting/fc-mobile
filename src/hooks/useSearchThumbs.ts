// SEARCH-THUMB-1 (Ross 10-31: "figure search needs thumbnail (full view but very small) to tell entries apart", seven rows of
// "Tokisaki Kurumi"): each search row's figure as the photo the app shows for it. A figure the device keeps images for (owned,
// ordered, wished: src/media/keptImages.ts) answers the photo the case draws, the user's choice once its bytes are here
// (GALLERY-1), and costs no request. Every other figure of the rows (a former holding, a catalog hit, one not kept yet) is asked
// of GetProductImages in ONE batched read (fetchImageLists: 200 heads a call, each page followed), never a call a row, and
// only in reach; it answers the chosen photo while its list names it, else the primary, else the first, as the figure page
// does (useProductImage), with the list's dominant colour for the placeholder. Never an address off the public image address
// (src/media/address.ts) or one the last image sync withheld, and the answer joins the other image answers, so a sync that
// withholds one drops it from here too (src/hooks/imageAnswers.ts). Out of reach, or when the read fails, what the device
// kept: the rest stand as their placeholder.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { isMediaUrl } from '../media/address';
import { fetchImageLists, keptImages, withheldAmong } from '../media/keptImages';
import { usePhotoChoices } from '../media/photoChoice';
import { hearKeptSyncs } from './imageAnswers';
import { useOnlineStatus } from './useOnlineStatus';

export interface SearchThumb {
  url: string;
  width: number;
  height: number;
  /** The photo's dominant colour, "#rrggbb", when the list gives one: the placeholder's while it loads. */
  color?: string;
}

const NONE: ReadonlyMap<string, SearchThumb> = new Map();

export function useSearchThumbs(heads: readonly string[]): ReadonlyMap<string, SearchThumb> {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const reachable = online && session?.engine.state.value.reachability !== 'unreachable';
  const choices = usePhotoChoices();
  const asked = [...new Set(heads)];
  const choiceKey = asked.filter((h) => choices.has(h)).map((h) => `${h}=${choices.get(h)}`).join(',');
  const query = useQuery<ReadonlyMap<string, SearchThumb>>({
    queryKey: ['local', 'search-thumbs', asked.join(','), reachable, choiceKey],
    queryFn: async ({ signal, client }) => {
      hearKeptSyncs(client);
      const out = new Map<string, SearchThumb>();
      for (const [head, image] of await keptImages(asked, undefined, choices)) out.set(head, { url: image.url, width: image.width, height: image.height });
      const missing = asked.filter((h) => !out.has(h));
      if (!reachable || missing.length === 0) return out;
      let lists;
      try {
        lists = await fetchImageLists(session!.clients.catalog, missing, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        // The server did not answer: what the device kept stands, the rest as their placeholder.
        return out;
      }
      const listed = new Map(missing.map((h) => [h, (lists.get(h) ?? []).filter((i) => isMediaUrl(i.url))]));
      const withheld = await withheldAmong([...listed.values()].flatMap((list) => list.map((i) => i.url)));
      for (const [head, list] of listed) {
        const shown = list.filter((i) => !withheld.has(i.url));
        const image = shown.find((i) => i.url === choices.get(head)) ?? shown.find((i) => i.primary) ?? shown[0];
        if (image !== undefined) out.set(head, { url: image.url, width: image.width, height: image.height, ...(image.dominantColor === '' ? {} : { color: image.dominantColor }) });
      }
      return out;
    },
    enabled: session !== undefined && phase === 'signed-in' && asked.length > 0,
    // a new search keeps the last rows' photos while its own come: a row they name keeps its photo, no flash
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return query.data ?? NONE;
}
