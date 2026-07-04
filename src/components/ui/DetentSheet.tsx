import { useState, useCallback, useEffect } from 'preact/hooks';
import { type ComponentChildren } from 'preact';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';

type Detent = 'half' | 'full';

interface DetentSheetProps {
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  /** Pinned to the sheet's bottom edge (tab strip + actions). */
  footer?: ComponentChildren;
}

const POSITIONS: Record<Detent, string> = {
  half: '48%',
  full: '4%',
};

/**
 * Bottom sheet with two detents (half / full). Drag up snaps to full, drag
 * down snaps to half then closes. Distinct from the shared BottomSheet: the
 * footer slot stays pinned to the physical bottom of the sheet, which is what
 * the tabbed filter sheet needs (tabs at the bottom, under the thumb).
 */
export function DetentSheet({ open, onClose, children, footer }: DetentSheetProps) {
  const [detent, setDetent] = useState<Detent>('half');
  const dragControls = useDragControls();

  useEffect(() => {
    if (open) setDetent('half');
  }, [open]);

  const handleDragEnd = useCallback(
    (_event: PointerEvent, info: { velocity: { y: number }; offset: { y: number } }) => {
      const { velocity, offset } = info;
      if (velocity.y < -300 || offset.y < -110) {
        setDetent('full');
      } else if (velocity.y > 500 || offset.y > 160) {
        if (detent === 'full') setDetent('half');
        else onClose();
      }
    },
    [detent, onClose],
  );

  return (
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
            class="detent-sheet"
            data-detent={detent}
            initial={{ y: '100%' }}
            animate={{ y: POSITIONS[detent] }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={0.08}
            onDragEnd={handleDragEnd}
          >
            <div
              class="detent-sheet__handle-area"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div class="detent-sheet__handle" />
            </div>

            <div class="detent-sheet__content">{children}</div>

            {footer && <div class="detent-sheet__footer">{footer}</div>}
          </motion.div>

          <style>{`
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
              padding: 0 var(--space-page);
              /* at half detent, keep the scroll region clear of the footer */
            }

            .detent-sheet[data-detent='half'] .detent-sheet__content {
              max-height: calc(48vh - 110px);
              flex: 0 1 auto;
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
          `}</style>
        </>
      )}
    </AnimatePresence>
  );
}
