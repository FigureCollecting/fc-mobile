import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { motion } from 'framer-motion';
import type { Figure } from '@figurecollecting/fc-shared';
import { Style } from '../../styles/Style';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useBrokenImages } from '../../hooks/useBrokenImages';
import { useProductPhotos } from '../../hooks/useProductPhotos';
import type { LocalFigure } from '../../local/figures';
import { localSession } from '../../local/session';
import { setPhotoChoice, usePhotoChoices } from '../../media/photoChoice';
import { FIXTURE_SUB, getFixturePhotos, isFixtureMode } from '../../dev-fixtures/fixtures';
import { useSheetDrag } from '../ui/useSheetDrag';

/**
 * GALLERY-1 (Ross 10-18): the figure card's Photos tab. Every photo of the figure, the one in use marked; a tap picks one and
 * "Use for me" keeps the pick for this user on this device (media/photoChoice.ts), where Info and the case take it up.
 * Picking the default again forgets the choice. The pick applies to every copy: the case cannot show each copy yet (COPY1),
 * so there is no "this one" to offer. A photo with no cut-out yet draws as the photo itself in the case.
 *
 * PHOTOS-FIND-1 (Ross 10-31: "our gallery card is slideable and they can inspect the tapped image behind by using the slider"):
 * the photo picked is handed to the host (onAim), whose large picture behind the sheet shows it until the sheet closes; the
 * sheet slides down to a strip of its photos, the picture in view, and back up (its handle, a drag, a key); Next and Previous,
 * and a swipe on the picture behind, step through the photos. A drag never closes it: the X, Back, Esc and Use for me do, and a
 * tap on the picture while the sheet is all up.
 *
 * Portaled above the Info viewer's own layers (which stand over PhotoSwipe).
 */
interface PhotosSheetProps {
  figure: Figure;
  open: boolean;
  onClose: () => void;
  /** The photo picked in the sheet, for the host's large picture behind it; undefined once the sheet closes. */
  onAim?: (url: string | undefined) => void;
}

/** The sheet's two detents: all of it up, or down to its handle, its head and a strip of its photos. */
const ALL = 0;
const PEEK = 1;
/** Room kept under the strip at the peek. */
const PEEK_GAP_PX = 12;
/** A move on the picture behind this far across, and more across than down, steps to the next or previous photo. */
const SWIPE_PX = 40;

/** translateY px of each detent: up, and down by all but its handle, its head and the first row of its photos. */
function photosDetents(sheet: HTMLElement): number[] {
  const tile = sheet.querySelector('.photos-sheet__tile');
  const body = sheet.querySelector('.photos-sheet__body');
  if (!tile || !body) return [0];
  const shown = tile.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + body.scrollTop + PEEK_GAP_PX;
  const down = Math.max(0, sheet.offsetHeight - shown);
  return down > 1 ? [0, down] : [0];
}

export function PhotosSheet({ figure, open, onClose, onAim }: PhotosSheetProps) {
  if (!open) return null;
  return createPortal(<Sheet figure={figure} onClose={onClose} onAim={onAim} />, document.body);
}

function Sheet({ figure, onClose, onAim }: { figure: Figure; onClose: () => void; onAim?: (url: string | undefined) => void }) {
  const local = (figure as Partial<LocalFigure>).local;
  const headId = local?.headId;
  // the fixtures (?fxphotos=1) have no session: their choices are kept for a user of their own
  const sub = localSession.value?.sub() ?? (isFixtureMode() && getFixturePhotos() ? FIXTURE_SUB : undefined);
  const photos = useProductPhotos(headId);
  const chosen = usePhotoChoices(sub).get(headId ?? '');
  const images = useBrokenImages();
  useBackToClose(onClose);
  const [picked, pick] = useState<string | undefined>(undefined);
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [detent, setDetent] = useState(ALL);
  // dragged by its handle and head, handed off from its body (sheetDrag.ts); it rests at the strip, never closes
  const { y, settleTo } = useSheetDrag({ open: true, sheetRef, contentRef: bodyRef, detents: photosDetents, initial: ALL, onSettle: setDetent });
  const peek = detent === PEEK;
  const slide = () => {
    const to = peek ? ALL : PEEK;
    setDetent(to);
    settleTo(to);
  };

  const list = photos.data?.photos ?? [];
  // PHOTOS-FIND-1: the kept list after a failed ask is said to be that, not shown as if it were all of them
  const refreshFailed = photos.data?.refreshFailed === true;
  const byDefault = list.find((p) => p.primary) ?? list[0];
  // what is in use: the chosen photo while the list names it, else the default
  const inUse = list.find((p) => p.url === chosen) ?? byDefault;
  const aimed = list.find((p) => p.url === picked) ?? inUse;
  const copies = local?.copies?.length ?? 1;

  // the host's picture is the photo picked until the sheet closes; the picked photo's tile is scrolled into view
  const aimRef = useRef(onAim);
  aimRef.current = onAim;
  useEffect(() => () => aimRef.current?.(undefined), []);
  const aimAt = (url: string) => {
    pick(url);
    onAim?.(url);
  };
  const tiles = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (picked !== undefined) tiles.current.get(picked)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [picked]);
  const at = aimed === undefined ? -1 : list.indexOf(aimed);
  const step = (by: 1 | -1) => {
    const to = list[at + by];
    if (to !== undefined) aimAt(to.url);
  };

  // a swipe across the picture behind steps; its click is no tap, and at the strip a tap leaves the sheet where it is
  const swipeFrom = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onBackdropUp = (e: PointerEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from === null || from.id !== e.pointerId) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(e.clientY - from.y)) return;
    swiped.current = true;
    step(dx < 0 ? 1 : -1);
  };
  // at the strip, a sideways move along it is its own scroll, kept from the sheet's drag (an upright one still moves the sheet)
  const stripFrom = useRef<{ x: number; y: number } | null>(null);
  const keep = () => {
    if (sub === undefined || headId === undefined || aimed === undefined) return;
    setPhotoChoice(sub, headId, aimed === byDefault ? null : aimed.url);
    onClose();
  };

  return (
    <>
      <div
        class="photos-sheet__backdrop"
        data-detent={peek ? 'peek' : 'all'}
        onPointerDown={(e) => {
          swiped.current = false;
          swipeFrom.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={onBackdropUp}
        onPointerCancel={() => {
          swipeFrom.current = null;
        }}
        onClick={() => {
          if (swiped.current) swiped.current = false;
          else if (!peek) onClose();
        }}
      />
      <motion.section class="photos-sheet" ref={sheetRef} style={{ y }} data-detent={peek ? 'peek' : 'all'} role="dialog" aria-label="Photos">
        <button class="photos-sheet__handle" type="button" aria-label={peek ? 'Show all photos' : 'Show the large picture'} aria-expanded={!peek} onClick={slide}>
          <span class="photos-sheet__grip" />
        </button>
        <header class="photos-sheet__head">
          <h2 class="photos-sheet__title">Photos</h2>
          {list.length > 0 && <span class="photos-sheet__count">{list.length === 1 ? '1 photo' : `${list.length} photos`}</span>}
          {list.length > 1 && (
            <span class="photos-sheet__steps">
              <button type="button" class="photos-sheet__step" aria-label="Previous photo" disabled={at <= 0} onClick={() => step(-1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button type="button" class="photos-sheet__step" aria-label="Next photo" disabled={at >= list.length - 1} onClick={() => step(1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </span>
          )}
          <button type="button" class="photos-sheet__close" aria-label="Close photos" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="photos-sheet__body" ref={bodyRef}>
        {photos.isLoading ? (
          <p class="photos-sheet__note" role="status">
            Loading photos
          </p>
        ) : list.length === 0 ? (
          <p class="photos-sheet__note">{refreshFailed ? "No photos saved on this phone; couldn't refresh." : 'No photos of this figure yet.'}</p>
        ) : (
          <>
            {refreshFailed && <p class="photos-sheet__note">Showing photos saved on this phone; couldn't refresh.</p>}
            <div
              class="photos-sheet__grid"
              onTouchStart={(e) => {
                const t = e.touches[0];
                stripFrom.current = t === undefined ? null : { x: t.clientX, y: t.clientY };
              }}
              onTouchMove={(e) => {
                const from = stripFrom.current;
                const t = e.touches[0];
                if (peek && from !== null && t !== undefined && Math.abs(t.clientX - from.x) > Math.abs(t.clientY - from.y)) e.stopPropagation();
              }}
            >
              {list.map((photo, i) => {
                const label = `Photo ${i + 1} of ${list.length}${photo === byDefault ? ', the default' : ''}${photo === inUse ? ', in use' : ''}`;
                const selected = photo === aimed;
                return (
                  <button
                    key={photo.url}
                    ref={(el: HTMLButtonElement | null) => {
                      if (el) tiles.current.set(photo.url, el);
                      else tiles.current.delete(photo.url);
                    }}
                    type="button"
                    class="photos-sheet__tile"
                    aria-label={label}
                    aria-pressed={selected}
                    onClick={() => aimAt(photo.url)}
                  >
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
        </div>
      </motion.section>

      <Style css={`
        .photos-sheet__backdrop {
          position: fixed;
          inset: 0;
          z-index: 100010;
          background: var(--overlay);
          /* a swipe across it steps through the photos: every finger is the page's */
          touch-action: none;
        }

        /* at the strip, the picture behind is there to look at, undimmed */
        .photos-sheet__backdrop[data-detent='peek'] {
          background: transparent;
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
          padding: 0 var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
          background: var(--surface-secondary);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          box-shadow: var(--shadow-lg);
          /* the handle and the head are the sheet's to drag; its body scrolls */
          touch-action: none;
        }

        .photos-sheet__handle {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          width: 100%;
          padding: var(--space-2) 0 var(--space-1);
          cursor: grab;
        }

        .photos-sheet__grip {
          width: 32px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--text-tertiary);
        }

        .photos-sheet__body {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          min-height: 0;
          overflow-y: auto;
          touch-action: pan-y;
          overscroll-behavior-y: none;
        }

        .photos-sheet__steps {
          display: flex;
          align-self: center;
          margin-left: auto;
        }

        .photos-sheet__steps + .photos-sheet__close {
          margin-left: 0;
        }

        .photos-sheet__step {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: var(--radius-full);
          color: var(--text-primary);
        }

        .photos-sheet__step:disabled {
          opacity: 0.35;
        }

        /* at the peek: one strip of the photos, along which the one picked is kept in view */
        .photos-sheet[data-detent='peek'] .photos-sheet__grid {
          grid-auto-flow: column;
          grid-template-columns: none;
          grid-auto-columns: 72px;
          overflow-x: auto;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
        }

        /* what follows the strip (its notes, Use for me) waits below the screen, never a cut line at its edge */
        .photos-sheet[data-detent='peek'] .photos-sheet__grid ~ * {
          visibility: hidden;
        }

        .photos-sheet__head {
          display: flex;
          align-items: center;
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
