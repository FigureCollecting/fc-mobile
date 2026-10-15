import { useRef } from 'preact/hooks';
import { type ComponentChildren } from 'preact';
import { motion, AnimatePresence } from 'framer-motion';
import { Style } from '../../styles/Style';
import { offScreenY, useSheetDrag } from './useSheetDrag';

/** 'fit': as tall as its content, at most 85 % of the space it opens in and never past its top, its body scrolling the rest; its bottom just above the raised +. */
type SnapPoint = 'closed' | 'half' | 'full' | 'fit';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  snapPoint?: SnapPoint;
  children: ComponentChildren;
}

/** How far down the card stands at its one detent, as a fraction of its height. */
const DOWN_BY: Record<SnapPoint, number> = {
  closed: 1,
  half: 0.5,
  full: 0.06,
  fit: 0,
};

/**
 * A pull-up card with one detent: its handle drags it, a finger on its contents scrolls them and then hands
 * off to the card at their top (sheetDrag.ts); a release settles back, or closes past the midpoint down.
 */
export function BottomSheet({ open, onClose, snapPoint = 'half', children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { y } = useSheetDrag({
    open,
    sheetRef,
    contentRef,
    detents: (sheet) => [DOWN_BY[snapPoint] * sheet.offsetHeight],
    initial: 0,
    onClose,
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            class="bottom-sheet__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            ref={sheetRef}
            class={snapPoint === 'fit' ? 'bottom-sheet bottom-sheet--fit' : 'bottom-sheet'}
            style={{ y }}
            exit={{ y: offScreenY() }}
            transition={{ type: 'tween', duration: 0.2 }}
          >
            <div class="bottom-sheet__handle-area">
              <div class="bottom-sheet__handle" />
            </div>

            <div class="bottom-sheet__content" ref={contentRef}>
              {children}
            </div>
          </motion.div>

          <Style css={`
            .bottom-sheet__backdrop {
              position: fixed;
              inset: 0;
              background: var(--overlay);
              z-index: 200;
            }

            .bottom-sheet {
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              height: 94vh;
              background: var(--surface-secondary);
              border-radius: var(--radius-xl) var(--radius-xl) 0 0;
              z-index: 201;
              display: flex;
              flex-direction: column;
              touch-action: none;
            }

            /* it ends above the + the tab bar raises into the screen (IC1-R2: top = fab / -1.25), so nothing covers it;
               on a short panel it stops 8px below the top of the space above the tab bar, never past it */
            .bottom-sheet--fit {
              bottom: calc(var(--fab-size) / 1.25 + 4px);
              height: auto;
              max-height: min(85%, calc(100% - var(--fab-size) / 1.25 - 4px - 8px));
            }

            .bottom-sheet--fit .bottom-sheet__content {
              flex: 0 1 auto;
              min-height: 0;
            }

            .bottom-sheet__handle-area {
              display: flex;
              justify-content: center;
              padding: var(--space-3) 0;
              cursor: grab;
              flex-shrink: 0;
            }

            .bottom-sheet__handle-area:active {
              cursor: grabbing;
            }

            .bottom-sheet__handle {
              width: 36px;
              height: 4px;
              background: var(--text-tertiary);
              border-radius: var(--radius-full);
            }

            .bottom-sheet__content {
              flex: 1;
              overflow-y: auto;
              -webkit-overflow-scrolling: touch;
              /* the contents scroll natively and never chain to the page; their top hands off to the card */
              touch-action: pan-y;
              overscroll-behavior-y: none;
              padding: 0 var(--space-4) var(--space-4);
            }
          `} />
        </>
      )}
    </AnimatePresence>
  );
}
