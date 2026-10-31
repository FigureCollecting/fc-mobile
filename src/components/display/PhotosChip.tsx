import { Style } from '../../styles/Style';
import { useProductPhotos } from '../../hooks/useProductPhotos';

/**
 * PHOTOS-FIND-1 (Ross 10-31: "only one picture per figure"): on a card's picture, how many photos the figure has when it has
 * more than the one shown; a tap opens them (PhotosSheet). Its host stands it low on the picture, clear of the face. The pill
 * is small; the button around it is a finger's size.
 */
interface PhotosChipProps {
  headId: string | undefined;
  onOpen: () => void;
  /** Its host's class: where it stands. */
  class?: string;
}

export function PhotosChip({ headId, onOpen, class: className = '' }: PhotosChipProps) {
  const count = useProductPhotos(headId).data?.photos.length ?? 0;
  if (count < 2) return null;
  return (
    <>
      <button type="button" class={`photos-chip ${className}`} onClick={onOpen}>
        <span class="photos-chip__pill">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3.5" y="5.5" width="13" height="10" rx="1.5" />
            <circle cx="10" cy="10.5" r="2.6" />
            <path d="M7.5 5.5l.8-1.5h3.4l.8 1.5" />
          </svg>
          {`${count} photos`}
        </span>
      </button>
      <Style css={styles} />
    </>
  );
}

const styles = `
  .photos-chip {
    display: flex;
    align-items: center;
    min-height: var(--touch-min);
    padding: 0;
    background: none;
  }
  .photos-chip__pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-primary) 70%, transparent);
    color: var(--text-primary);
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    line-height: 1.2;
    white-space: nowrap;
  }
`;
