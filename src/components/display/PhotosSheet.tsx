import { useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Figure } from '@figurecollecting/fc-shared';
import { Style } from '../../styles/Style';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useBrokenImages } from '../../hooks/useBrokenImages';
import { useProductPhotos } from '../../hooks/useProductPhotos';
import type { LocalFigure } from '../../local/figures';
import { localSession } from '../../local/session';
import { setPhotoChoice, usePhotoChoices } from '../../media/photoChoice';
import { FIXTURE_SUB, getFixturePhotos, isFixtureMode } from '../../dev-fixtures/fixtures';

/**
 * GALLERY-1 (Ross 10-18): the figure card's Photos tab. Every photo of the figure, the one in use marked; a tap picks one and
 * "Use for me" keeps the pick for this user on this device (media/photoChoice.ts), where Info and the case take it up.
 * Picking the default again forgets the choice. The pick applies to every copy: the case cannot show each copy yet (COPY1),
 * so there is no "this one" to offer. A photo with no cut-out yet draws as the photo itself in the case.
 *
 * Portaled above the Info viewer's own layers (which stand over PhotoSwipe).
 */
interface PhotosSheetProps {
  figure: Figure;
  open: boolean;
  onClose: () => void;
}

export function PhotosSheet({ figure, open, onClose }: PhotosSheetProps) {
  if (!open) return null;
  return createPortal(<Sheet figure={figure} onClose={onClose} />, document.body);
}

function Sheet({ figure, onClose }: { figure: Figure; onClose: () => void }) {
  const local = (figure as Partial<LocalFigure>).local;
  const headId = local?.headId;
  // the fixtures (?fxphotos=1) have no session: their choices are kept for a user of their own
  const sub = localSession.value?.sub() ?? (isFixtureMode() && getFixturePhotos() ? FIXTURE_SUB : undefined);
  const photos = useProductPhotos(headId);
  const chosen = usePhotoChoices(sub).get(headId ?? '');
  const images = useBrokenImages();
  useBackToClose(onClose);
  const [picked, pick] = useState<string | undefined>(undefined);

  const list = photos.data?.photos ?? [];
  // PHOTOS-FIND-1: the kept list after a failed ask is said to be that, not shown as if it were all of them
  const refreshFailed = photos.data?.refreshFailed === true;
  const byDefault = list.find((p) => p.primary) ?? list[0];
  // what is in use: the chosen photo while the list names it, else the default
  const inUse = list.find((p) => p.url === chosen) ?? byDefault;
  const aimed = list.find((p) => p.url === picked) ?? inUse;
  const copies = local?.copies?.length ?? 1;
  const keep = () => {
    if (sub === undefined || headId === undefined || aimed === undefined) return;
    setPhotoChoice(sub, headId, aimed === byDefault ? null : aimed.url);
    onClose();
  };

  return (
    <>
      <div class="photos-sheet__backdrop" onClick={onClose} />
      <section class="photos-sheet" role="dialog" aria-label="Photos">
        <header class="photos-sheet__head">
          <h2 class="photos-sheet__title">Photos</h2>
          {list.length > 0 && <span class="photos-sheet__count">{list.length === 1 ? '1 photo' : `${list.length} photos`}</span>}
          <button type="button" class="photos-sheet__close" aria-label="Close photos" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </header>

        {photos.isLoading ? (
          <p class="photos-sheet__note" role="status">
            Loading photos
          </p>
        ) : list.length === 0 ? (
          <p class="photos-sheet__note">{refreshFailed ? "No photos saved on this phone; couldn't refresh." : 'No photos of this figure yet.'}</p>
        ) : (
          <>
            {refreshFailed && <p class="photos-sheet__note">Showing photos saved on this phone; couldn't refresh.</p>}
            <div class="photos-sheet__grid">
              {list.map((photo, i) => {
                const label = `Photo ${i + 1} of ${list.length}${photo === byDefault ? ', the default' : ''}${photo === inUse ? ', in use' : ''}`;
                const selected = photo === aimed;
                return (
                  <button key={photo.url} type="button" class="photos-sheet__tile" aria-label={label} aria-pressed={selected} onClick={() => pick(photo.url)}>
                    {images.broken(photo.url) ? (
                      <span class="photos-sheet__plate" aria-hidden="true" />
                    ) : (
                      <img src={photo.url} alt="" loading="lazy" crossOrigin="anonymous" onError={() => images.failed(photo.url)} />
                    )}
                    {photo === inUse && <span class="photos-sheet__badge">In use</span>}
                  </button>
                );
              })}
            </div>
            {aimed !== undefined && aimed.maskUrl === undefined && <p class="photos-sheet__note">No cut-out yet: the case shows this photo as it is.</p>}
            <footer class="photos-sheet__foot">
              {copies > 1 && <span class="photos-sheet__scope">{`For all ${copies} copies`}</span>}
              <button type="button" class="photos-sheet__use" disabled={aimed === undefined || aimed === inUse || sub === undefined || headId === undefined} onClick={keep}>
                Use for me
              </button>
            </footer>
          </>
        )}
      </section>

      <Style css={`
        .photos-sheet__backdrop {
          position: fixed;
          inset: 0;
          z-index: 100010;
          background: var(--overlay);
        }

        .photos-sheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100011;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          max-height: min(80dvh, 640px);
          overflow-y: auto;
          padding: var(--space-3) var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
          background: var(--surface-secondary);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          box-shadow: var(--shadow-lg);
        }

        .photos-sheet__head {
          display: flex;
          align-items: baseline;
          gap: var(--space-2);
        }

        .photos-sheet__title {
          margin: 0;
          font-size: var(--font-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .photos-sheet__count {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .photos-sheet__close {
          margin-left: auto;
          align-self: center;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          color: var(--text-secondary);
        }

        .photos-sheet__grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
          gap: var(--space-2);
        }

        .photos-sheet__tile {
          position: relative;
          aspect-ratio: 3 / 4;
          overflow: hidden;
          padding: 0;
          border-radius: var(--radius-md);
          background: var(--surface-tertiary);
          outline: 2px solid transparent;
          outline-offset: -2px;
        }

        .photos-sheet__tile[aria-pressed='true'] {
          outline-color: var(--brand-400);
        }

        .photos-sheet__tile img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .photos-sheet__plate {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
        }

        .photos-sheet__badge {
          position: absolute;
          left: 4px;
          bottom: 4px;
          padding: 1px 6px;
          border-radius: var(--radius-full);
          background: color-mix(in srgb, var(--surface-primary) 80%, transparent);
          color: var(--text-primary);
          font-size: var(--font-2xs);
        }

        .photos-sheet__note {
          margin: 0;
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .photos-sheet__foot {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3);
        }

        .photos-sheet__scope {
          margin-right: auto;
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .photos-sheet__use {
          min-height: 44px;
          padding: 0 var(--space-4);
          border-radius: var(--radius-full);
          background: var(--brand-500);
          color: #fff;
          font-weight: var(--font-weight-semibold);
        }

        .photos-sheet__use:disabled {
          opacity: 0.4;
        }
      `} />
    </>
  );
}
