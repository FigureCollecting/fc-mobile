import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { motion, AnimatePresence } from 'framer-motion';

interface LightboxProps {
  images: string[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export function Lightbox({ images, initialIndex = 0, isOpen, onClose }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // Touch state for pinch zoom
  const pinchRef = useRef({
    initialDistance: 0,
    initialScale: 1,
    isPinching: false,
    // Pan tracking during zoom
    startX: 0,
    startY: 0,
    startTranslateX: 0,
    startTranslateY: 0,
  });

  const imageRef = useRef<HTMLDivElement>(null);

  // Reset index when lightbox opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }, [isOpen, initialIndex]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const prev = useCallback(() => {
    resetZoom();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, [resetZoom]);

  const next = useCallback(() => {
    resetZoom();
    setCurrentIndex((i) => Math.min(images.length - 1, i + 1));
  }, [images.length, resetZoom]);

  const handleClose = useCallback(() => {
    resetZoom();
    onClose();
  }, [onClose, resetZoom]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose, prev, next]);

  // Pinch-to-zoom touch handlers
  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current.initialDistance = Math.hypot(dx, dy);
        pinchRef.current.initialScale = scale;
        pinchRef.current.isPinching = true;
      } else if (e.touches.length === 1 && scale > 1) {
        // Pan while zoomed
        pinchRef.current.startX = e.touches[0].clientX;
        pinchRef.current.startY = e.touches[0].clientY;
        pinchRef.current.startTranslateX = translate.x;
        pinchRef.current.startTranslateY = translate.y;
      }
    },
    [scale, translate],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current.isPinching) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.hypot(dx, dy);
        const ratio = distance / pinchRef.current.initialDistance;
        const newScale = Math.min(Math.max(pinchRef.current.initialScale * ratio, 1), 4);
        setScale(newScale);
      } else if (e.touches.length === 1 && scale > 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - pinchRef.current.startX;
        const dy = e.touches[0].clientY - pinchRef.current.startY;
        setTranslate({
          x: pinchRef.current.startTranslateX + dx,
          y: pinchRef.current.startTranslateY + dy,
        });
      }
    },
    [scale],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (pinchRef.current.isPinching && e.touches.length < 2) {
        pinchRef.current.isPinching = false;
        // Snap back to 1 if close to unzoomed
        if (scale < 1.1) {
          resetZoom();
        }
      }
    },
    [scale, resetZoom],
  );

  // Double-tap to toggle zoom
  const lastTap = useRef(0);
  const handleDoubleTap = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap.current < 300) {
        e.preventDefault();
        if (scale > 1) {
          resetZoom();
        } else {
          setScale(2);
        }
      }
      lastTap.current = now;
    },
    [scale, resetZoom],
  );

  // Backdrop click to close (only if not zoomed)
  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (scale > 1) return;
      if ((e.target as HTMLElement).classList.contains('lightbox__backdrop') ||
          (e.target as HTMLElement).classList.contains('lightbox__image-area')) {
        handleClose();
      }
    },
    [handleClose, scale],
  );

  // Swipe navigation handled by framer-motion drag
  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      if (scale > 1) return;
      if (info.offset.x > 100 || info.velocity.x > 500) {
        prev();
      } else if (info.offset.x < -100 || info.velocity.x < -500) {
        next();
      }
    },
    [prev, next, scale],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          class="lightbox__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          {/* Close button */}
          <button
            class="lightbox__close"
            onClick={handleClose}
            aria-label="Close lightbox"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Image counter */}
          {images.length > 1 && (
            <div class="lightbox__counter">
              {currentIndex + 1} / {images.length}
            </div>
          )}

          {/* Image area */}
          <div
            class="lightbox__image-area"
            onTouchStart={handleDoubleTap}
          >
            <AnimatePresence mode="popLayout">
              <motion.div
                key={currentIndex}
                class="lightbox__image-wrapper"
                ref={imageRef}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2 }}
                drag={scale <= 1 ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.3}
                onDragEnd={handleDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  touchAction: 'none',
                }}
              >
                <img
                  class="lightbox__image"
                  src={images[currentIndex]}
                  alt={`Image ${currentIndex + 1} of ${images.length}`}
                  draggable={false}
                  style={{
                    transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
                  }}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <style>{lightboxStyles}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const lightboxStyles = `
  .lightbox__backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: #000000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }

  .lightbox__close {
    position: absolute;
    top: calc(var(--safe-area-top) + 8px);
    right: 8px;
    z-index: 310;
    width: var(--touch-min);
    height: var(--touch-min);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .lightbox__close:active {
    background: rgba(255, 255, 255, 0.25);
  }

  .lightbox__counter {
    position: absolute;
    top: calc(var(--safe-area-top) + 18px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 310;
    color: rgba(255, 255, 255, 0.8);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    background: rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-full);
    padding: 4px 14px;
  }

  .lightbox__image-area {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .lightbox__image-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    cursor: grab;
  }

  .lightbox__image-wrapper:active {
    cursor: grabbing;
  }

  .lightbox__image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    will-change: transform;
    transform-origin: center center;
    pointer-events: none;
  }
`;
