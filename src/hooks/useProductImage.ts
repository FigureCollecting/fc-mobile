// A figure's derivative image (MG-2): only one GetProductImages returns with a URL, asked for only
// online and only on the detail screen. The collection never shows an image, and nothing ever reads
// figure.imageUrl or a spine image claim. No derivative: the placeholder plate.
import { useQuery } from '@tanstack/react-query';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { useOnlineStatus } from './useOnlineStatus';

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
    queryKey: ['local', 'image', headId],
    queryFn: async ({ signal }) => {
      const res = await session!.clients.catalog.getProductImages({ headIds: [headId!] }, { signal });
      const images = res.products.find((p) => p.headId === headId)?.images ?? [];
      const image = images.find((i) => i.primary && i.url !== '') ?? images.find((i) => i.url !== '');
      return image === undefined ? null : { url: image.url, width: image.width, height: image.height };
    },
    enabled: session !== undefined && headId !== undefined && phase === 'signed-in' && online.value,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
