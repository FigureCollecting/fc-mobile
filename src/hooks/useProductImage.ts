// A figure's derivative image (MG-2, ADDR-1): online, the one GetProductImages returns on the public
// image address (src/media/address.ts), never figure.imageUrl or a spine image claim; offline, the
// image kept for an owned figure (src/media/ownedImages.ts). Neither: the placeholder plate.
import { useQuery } from '@tanstack/react-query';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { useOnlineStatus } from './useOnlineStatus';
import { isMediaUrl } from '../media/address';
import { primaryImage, recallImages } from '../media/ownedImages';

export interface DerivativeImage {
  url: string;
  width: number;
  height: number;
}

export function useProductImage(headId: string | undefined) {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus();
  return useQuery<DerivativeImage | null>({
    queryKey: ['local', 'image', headId, online.value],
    queryFn: async ({ signal }) => {
      if (!online.value) {
        const kept = primaryImage((await recallImages(headId!)) ?? []);
        return kept === undefined ? null : { url: kept.url, width: kept.width, height: kept.height };
      }
      const res = await session!.clients.catalog.getProductImages({ headIds: [headId!] }, { signal });
      const images = (res.products.find((p) => p.headId === headId)?.images ?? []).filter((i) => isMediaUrl(i.url));
      const image = images.find((i) => i.primary) ?? images[0];
      return image === undefined ? null : { url: image.url, width: image.width, height: image.height };
    },
    enabled: session !== undefined && headId !== undefined && phase === 'signed-in',
    staleTime: 10 * 60_000,
    retry: false,
  });
}
