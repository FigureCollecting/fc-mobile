// A figure's derivative image (MG-2, ADDR-1): in reach, the one GetProductImages returns on the public
// image address (src/media/address.ts), never figure.imageUrl or a spine image claim, and never an
// address the last owned sync withheld until a sync carries it again; out of reach (offline, or the
// sync engine found the server unreachable) or when that call fails, the image kept for an owned
// figure, if its bytes were on the device when asked (src/media/ownedImages.ts). An answer given
// before a completed owned sync is not reused after it, in any open document of the app: the one that
// ran the sync drops it and tells the others, which drop theirs (src/hooks/imageAnswers.ts), and the
// page asks again. Neither: the placeholder plate. The page draws the plate too when the image fails
// to load.
import { useQuery } from '@tanstack/react-query';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { useOnlineStatus } from './useOnlineStatus';
import { isMediaUrl } from '../media/address';
import { keptImage, withheldAmong } from '../media/ownedImages';
import { hearOwnedSyncs } from './imageAnswers';

export interface DerivativeImage {
  url: string;
  width: number;
  height: number;
}

const asDerivative = (i: { url: string; width: number; height: number } | undefined): DerivativeImage | null =>
  i === undefined ? null : { url: i.url, width: i.width, height: i.height };

export function useProductImage(headId: string | undefined) {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const reachable = online && session?.engine.state.value.reachability !== 'unreachable';
  return useQuery<DerivativeImage | null>({
    queryKey: ['local', 'image', headId, reachable],
    queryFn: async ({ signal, client }) => {
      hearOwnedSyncs(client);
      if (!reachable) return asDerivative(await keptImage(headId!));
      let images;
      try {
        const res = await session!.clients.catalog.getProductImages({ headIds: [headId!] }, { signal });
        images = (res.products.find((p) => p.headId === headId)?.images ?? []).filter((i) => isMediaUrl(i.url));
      } catch {
        // The server did not answer (UNAVAILABLE, a fault, a lost connection): what the last sync kept stands.
        return asDerivative(await keptImage(headId!));
      }
      // An address the last owned sync withheld is not answered until a sync carries it again.
      const withheld = await withheldAmong(images.map((i) => i.url));
      images = images.filter((i) => !withheld.has(i.url));
      return asDerivative(images.find((i) => i.primary) ?? images[0]);
    },
    enabled: session !== undefined && headId !== undefined && phase === 'signed-in',
    staleTime: 10 * 60_000,
    retry: false,
  });
}
