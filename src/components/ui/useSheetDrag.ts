import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { animate, useMotionValue, type AnimationPlaybackControls, type MotionValue } from 'framer-motion';
import { attachSheetDrag, SETTLE_MS, type SheetDragController, type SheetDriver } from './sheetDrag';

/** Where a card stands before it opens and where it goes when it closes: below any screen. */
export const offScreenY = (): number => (typeof window === 'undefined' ? 2000 : window.innerHeight);

export interface SheetDragOptions {
  open: boolean;
  sheetRef: RefObject<HTMLElement>;
  /** The card's scrolling contents; null: the whole card is its handle. */
  contentRef?: RefObject<HTMLElement>;
  /** Rest positions (translateY px), top-most first, for the card as it now measures. */
  detents: (sheet: HTMLElement) => number[];
  /** The detent it opens on. */
  initial: number;
  /** A drag down past the lowest detent closes it (onClose); without it the card rests there. */
  onClose?: () => void;
  onSettle?: (index: number) => void;
}

/**
 * The card's translateY as a motion value (style={{ y }}), dragged by its handle and handed off from its
 * contents (sheetDrag.ts), settling on its detents; it opens on `initial`. `settleTo` moves it by index.
 */
export function useSheetDrag({ open, sheetRef, contentRef, detents, initial, onClose, onSettle }: SheetDragOptions): {
  y: MotionValue<number>;
  settleTo: (index: number) => void;
} {
  const y = useMotionValue(offScreenY());
  const latest = useRef({ detents, onClose, onSettle });
  latest.current = { detents, onClose, onSettle };
  const controller = useRef<SheetDragController | null>(null);

  const driver = useMemo((): SheetDriver => {
    let running: AnimationPlaybackControls | null = null;
    const stop = () => {
      running?.stop();
      running = null;
    };
    return {
      get: () => y.get(),
      set: (to) => {
        stop();
        y.set(to);
      },
      settle: (to) => {
        stop();
        running = animate(y, to, { type: 'tween', duration: SETTLE_MS / 1000, ease: [0.22, 1, 0.36, 1] });
      },
      stop,
    };
  }, [y]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) return;
    const c = attachSheetDrag(sheet, contentRef?.current ?? null, driver, {
      detents: () => latest.current.detents(sheet),
      closeY: () => (latest.current.onClose ? sheet.offsetHeight || offScreenY() : null),
      onSettle: (i) => latest.current.onSettle?.(i),
      onClose: () => latest.current.onClose?.(),
    });
    controller.current = c;
    driver.set(offScreenY());
    c.settleTo(initial);
    return () => {
      c.detach();
      controller.current = null;
    };
    // attached once per opening; the latest detents and callbacks are read through `latest`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { y, settleTo: (i) => controller.current?.settleTo(i) };
}
