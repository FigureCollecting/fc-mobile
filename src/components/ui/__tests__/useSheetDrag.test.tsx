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
  expose?: (api: { settleTo: (i: number) => void; y: () => number }) => void;
  /** The card stays in the page once closed, as it does while its exit animation runs. */
  leaving?: boolean;
}

function Card({ open, onClose, onSettle, expose, leaving }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { y, settleTo } = useSheetDrag({ open, sheetRef, detents: () => [0, 200], initial: 1, onClose, onSettle });
  expose?.({ settleTo, y: () => y.get() });
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
  it('opens from below the screen onto its first detent, in one short animation', async () => {
    let api!: { settleTo: (i: number) => void; y: () => number };
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
    let api!: { settleTo: (i: number) => void; y: () => number };
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
    let api!: { settleTo: (i: number) => void; y: () => number };
    const onSettle = vi.fn();
    render(<Card open={false} onSettle={onSettle} expose={(a) => (api = a)} />);
    api.settleTo(0);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
