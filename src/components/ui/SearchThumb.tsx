import { useState } from 'preact/hooks';
import type { SearchThumb as Thumb } from '../../hooks/useSearchThumbs';

/**
 * SEARCH-THUMB-1 (Ross 10-31): a search row's figure, whole and small (contained, never cropped). The box is a fixed size, so
 * the row is laid out the same before the photo comes, without one, and after it: a neutral placeholder, the photo's dominant
 * colour while it loads when the list gives one. Lazy-loaded, and crossorigin so the worker answers a kept photo from the
 * device (src/sw.ts). A photo that fails to load leaves the box as its placeholder. Decorative: the row's button names the figure.
 */
export function SearchThumb({ thumb }: { thumb: Thumb | undefined }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const shown = thumb !== undefined && broken !== thumb.url ? thumb : undefined;
  const tint = shown?.color !== undefined && loaded !== shown.url ? { backgroundColor: shown.color } : undefined;
  return (
    <span class="search-thumb" style={tint} aria-hidden="true">
      {shown !== undefined && (
        <img
          class="search-thumb__img"
          src={shown.url}
          alt=""
          width={shown.width}
          height={shown.height}
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          onLoad={() => setLoaded(shown.url)}
          onError={() => setBroken(shown.url)}
        />
      )}
    </span>
  );
}

/** The box's size, CSS px: a portrait figure's proportions, small enough that a row stays one thumb's reach. */
export const SEARCH_THUMB_WIDTH = 42;
export const SEARCH_THUMB_HEIGHT = 56;

export const searchThumbCss = `
  .search-thumb {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${SEARCH_THUMB_WIDTH}px;
    height: ${SEARCH_THUMB_HEIGHT}px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-tertiary);
  }
  .search-thumb__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;
