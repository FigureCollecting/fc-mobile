import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { motion } from 'framer-motion';
import { useSheetDrag } from '../useSheetDrag';

// The real framer-motion: the card's translateY is a motion value the hook animates.

interface Props {
  open: boolean;
  onClose?: () => void;
  onSettle?: (i: number) => void;
  expose?: (api: { settleTo: (i: number) => void; refit: () => void; y: () => number }) => void;
  /** The card's rest positions, as it now measures; the same two as ever when not given. */
  detents?: () => number[];
  /** The card stays in the page once closed, as it does while its exit animation runs. */
  leaving?: boolean;
}

function Card({ open, onClose, onSettle, expose, leaving, detents = () => [0, 200] }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { y, settleTo, refit } = useSheetDrag({ open, sheetRef, detents, initial: 1, onClose, onSettle });
  expose?.({ settleTo, refit, y: () => y.get() });
  return open || leaving ? (
    <motion.div ref={sheetRef} class="card" style={{ y }}>
      <div class="handle">handle</div>
    </motion.div>
  ) : null;
}

const pointer = (type: string, clientY: number) => new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', button: 0, clientY });

function drag(el: Element, from: number, to: number) {
  el.dispatchEvent(pointer('pointerdown', from));
  window.dispatchEvent(pointer('pointermove', from + Math.sign(to - from) * 10));
  window.dispatchEvent(pointer('pointermove', to));
  window.dispatchEvent(pointer('pointerup', to));
}

describe('useSheetDrag (the real framer-motion)', () => {
  // CARD-FLICKER-1: framer-motion writes a motion value to the page on its next frame, so a card whose contents just
  // changed stood a frame at the old translateY (dropped, or risen) before it was put right. A refit, and a resize,
  // write the new translateY to the page now, before that frame.
  it('refit: the card stands on its detent measured anew in the page at once, not on the next frame', async () => {
    let api!: { settleTo: (i: number) => void; refit: () => void; y: () => number };
    let rest = 200;
    const { container } = render(<Card open detents={() => [0, rest]} expose={(a) => (api = a)} />);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    const card = container.querySelector('.card') as HTMLElement;
    expect(card.style.transform).toBe('translateY(200px)');
    rest = 320;
    act(() => api.refit());
    expect(card.style.transform).toBe('translateY(320px)');
    expect(api.y()).toBe(320);
  });

  it('a resize that moves its detent writes it to the page at once too', async () => {
    let api!: { settleTo: (i: number) => void; refit: () => void; y: () => number };
    let rest = 200;
    const { container } = render(<Card open detents={() => [0, rest]} expose={(a) => (api = a)} />);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    const card = container.querySelector('.card') as HTMLElement;
    rest = 260;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(card.style.transform).toBe('translateY(260px)');
    expect(api.y()).toBe(260);
  });

  it('opens from below the screen onto its first detent, in one short animation', async () => {
    let api!: { settleTo: (i: number) => void; refit: () => void; y: () => number };
    const onSettle = vi.fn();
    render(<Card open onSettle={onSettle} expose={(a) => (api = a)} />);
    expect(onSettle).toHaveBeenCalledWith(1);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(api.y()).toBeCloseTo(200, 0);
    act(() => api.settleTo(0));
    expect(onSettle).toHaveBeenLastCalledWith(0);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(api.y()).toBeCloseTo(0, 0);
  });

  it('dragged far down by its handle, it closes where it may (off screen past its own height)', async () => {
    const onClose = vi.fn();
    const { container } = render(<Card open onClose={onClose} />);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    // jsdom lays nothing out: the card's height is 0, so off screen is the window's height
    drag(container.querySelector('.handle')!, 100, 100 + window.innerHeight);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('where it may not close, a drag down rests it on its lowest detent', async () => {
    let api!: { settleTo: (i: number) => void; refit: () => void; y: () => number };
    const onSettle = vi.fn();
    const { container } = render(<Card open onSettle={onSettle} expose={(a) => (api = a)} />);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    drag(container.querySelector('.handle')!, 100, 100 + window.innerHeight);
    expect(onSettle).toHaveBeenLastCalledWith(1);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(api.y()).toBeCloseTo(200, 0);
  });

  it('closed while its card is still leaving (the exit animation), it neither opens it onto a detent again nor follows a finger', async () => {
    const onSettle = vi.fn();
    const onClose = vi.fn();
    const { container, rerender } = render(<Card open leaving onSettle={onSettle} onClose={onClose} />);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(onSettle).toHaveBeenCalledTimes(1);
    rerender(<Card open={false} leaving onSettle={onSettle} onClose={onClose} />);
    drag(container.querySelector('.handle')!, 100, 100 + window.innerHeight);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closed, it has nothing to settle and listens to nothing', () => {
    let api!: { settleTo: (i: number) => void; refit: () => void; y: () => number };
    const onSettle = vi.fn();
    render(<Card open={false} onSettle={onSettle} expose={(a) => (api = a)} />);
    api.settleTo(0);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
