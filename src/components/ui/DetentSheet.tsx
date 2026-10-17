import { useState, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { type ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { motion, AnimatePresence } from 'framer-motion';
import { Style } from '../../styles/Style';
import { offScreenY, useSheetDrag } from './useSheetDrag';

type Detent = 'half' | 'full';

interface DetentSheetProps {
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  /** Pinned to the sheet's bottom edge (tab strip + actions). */
  footer?: ComponentChildren;
}

/** The detents, top-most first, as fractions of the card's height it stands down by. */
const DETENTS: readonly Detent[] = ['full', 'half'];
const DOWN_BY: Record<Detent, number> = { full: 0.04, half: 0.48 };
const detentsOf = (sheet: HTMLElement) => DETENTS.map((d) => DOWN_BY[d] * sheet.offsetHeight);
/** A field an on-screen keyboard comes up for. */
const KEYBOARD_FIELD =
  'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], input[type="password"], input[type="tel"], input[type="url"], textarea';

/**
 * Bottom sheet with two detents (half / full). Its handle drags it; a finger
 * on its contents scrolls them, then hands off to the card at their top
 * (sheetDrag.ts). A release settles on the nearest detent, or closes past
 * half. Distinct from the shared BottomSheet: the
 * footer slot stays pinned to the physical bottom of the sheet, which is what
 * the tabbed filter sheet needs (tabs at the bottom, under the thumb).
 *
 * Rendered through a portal to document.body: any ancestor with
 * container-type (the collection grid is a `.cq-grid` inline-size container)
 * becomes the containing block for `position: fixed` descendants, which would
 * anchor the sheet to the page instead of the viewport. The portal escapes it.
 *
 * A field a keyboard types into raises the card to full and brings itself to
 * the top of the contents (SEARCH-1): the keyboard covers the bottom half of a
 * phone, where the half detent stands, so what is typed and its matches would
 * sit under it. The room below the contents that lets the field rise stays
 * until the card closes, so nothing jumps under a finger when the field lets go.
 */
export function DetentSheet({ open, onClose, children, footer }: DetentSheetProps) {
  const [detent, setDetent] = useState<Detent>('half');
  const [typing, setTyping] = useState<{ field: HTMLElement } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { y, settleTo } = useSheetDrag({
    open,
    sheetRef,
    contentRef,
    detents: detentsOf,
    initial: DETENTS.indexOf('half'),
    onClose,
    onSettle: (i) => setDetent(DETENTS[i]),
  });

  useEffect(() => {
    if (!open) return;
    setDetent('half');
    setTyping(null);
  }, [open]);

  // Once the card stands at full with the room below, the field goes to the top of the contents.
  useLayoutEffect(() => {
    typing?.field.scrollIntoView({ block: 'start' });
  }, [typing]);

  const raiseForKeyboard = (e: FocusEvent) => {
    const field = e.target as HTMLElement;
    if (!field.matches(KEYBOARD_FIELD)) return;
    setDetent('full');
    settleTo(DETENTS.indexOf('full'));
    setTyping({ field });
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            class="detent-sheet__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            ref={sheetRef}
            class="detent-sheet"
            data-detent={detent}
            data-keyboard={typing === null ? undefined : ''}
            style={{ y }}
            exit={{ y: offScreenY() }}
            transition={{ type: 'tween', duration: 0.2 }}
          >
            {/* a button, so a finger on it lands on it, never on a chip beside it (touch adjustment) */}
            <button
              type="button"
              class="detent-sheet__handle-area"
              aria-label={detent === 'full' ? 'Lower the card' : 'Raise the card'}
              onClick={() => {
                const next = detent === 'full' ? 'half' : 'full';
                setDetent(next);
                settleTo(DETENTS.indexOf(next));
              }}
            >
              <span class="detent-sheet__handle" />
            </button>

            <div class="detent-sheet__content" ref={contentRef} onFocusIn={raiseForKeyboard}>
              {children}
            </div>

            {footer && <div class="detent-sheet__footer">{footer}</div>}
          </motion.div>

          <Style css={`
            .detent-sheet__backdrop {
              position: fixed;
              inset: 0;
              background: var(--overlay);
              z-index: 200;
            }

            .detent-sheet {
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              height: 96vh;
              height: 96dvh;
              background: var(--surface-secondary);
              border-radius: var(--radius-xl) var(--radius-xl) 0 0;
              z-index: 201;
              display: flex;
              flex-direction: column;
              touch-action: none;
            }

            .detent-sheet__handle-area {
              display: flex;
              justify-content: center;
              width: 100%;
              padding: var(--space-2) 0;
              cursor: grab;
              flex-shrink: 0;
            }

            .detent-sheet__handle {
              width: 36px;
              height: 4px;
              background: var(--text-tertiary);
              border-radius: var(--radius-full);
            }

            .detent-sheet__content {
              flex: 1;
              min-height: 0;
              overflow-y: auto;
              -webkit-overflow-scrolling: touch;
              /* the contents scroll natively and never chain to the page; their top hands off to the card */
              touch-action: pan-y;
              overscroll-behavior-y: none;
              padding: 0 var(--space-page);
              /* at half detent, keep the scroll region clear of the footer */
            }

            .detent-sheet[data-detent='half'] .detent-sheet__content {
              max-height: calc(48vh - 110px);
              flex: 0 1 auto;
            }

            /* room for a field to rise to the top of the contents, above the keyboard */
            .detent-sheet[data-keyboard] .detent-sheet__content::after {
              content: '';
              display: block;
              height: 100%;
            }

            .detent-sheet__footer {
              flex-shrink: 0;
              border-top: 1px solid var(--border-subtle);
              background: var(--surface-secondary);
              padding: var(--space-2) var(--space-page) calc(var(--space-2) + var(--safe-area-bottom));
            }

            /* footer pinned to the VISIBLE bottom at the half detent */
            .detent-sheet[data-detent='half'] .detent-sheet__footer {
              position: sticky;
              top: 0;
            }
          `} />
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
