import { useRef, useCallback } from 'preact/hooks';
import { type ComponentChildren } from 'preact';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';

type SnapPoint = 'closed' | 'half' | 'full';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  snapPoint?: SnapPoint;
  children: ComponentChildren;
}

const SNAP_POSITIONS = {
  closed: '100%',
  half: '50%',
  full: '6%',
} as const;

export function BottomSheet({ open, onClose, snapPoint = 'half', children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  const handleDragEnd = useCallback(
    (_event: PointerEvent, info: { velocity: { y: number }; offset: { y: number } }) => {
      const { velocity, offset } = info;

      if (velocity.y > 500 || offset.y > 200) {
        onClose();
      }
    },
    [onClose],
  );

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
            class="bottom-sheet"
            initial={{ y: '100%' }}
            animate={{ y: SNAP_POSITIONS[snapPoint] }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={0.1}
            onDragEnd={handleDragEnd}
          >
            <div
              class="bottom-sheet__handle-area"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div class="bottom-sheet__handle" />
            </div>

            <div class="bottom-sheet__content">
              {children}
            </div>
          </motion.div>

          <style>{`
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
              padding: 0 var(--space-4) var(--space-4);
            }
          `}</style>
        </>
      )}
    </AnimatePresence>
  );
}
