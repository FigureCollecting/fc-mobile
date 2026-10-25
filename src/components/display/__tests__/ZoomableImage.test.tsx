import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { ZoomableImage } from '../ZoomableImage';

/** The frame laid out at 400 x 400 from (0, 0), the picture `natural` px (jsdom lays nothing out). */
function laidOut(natural = { width: 400, height: 400 }) {
  const frame = document.querySelector<HTMLElement>('.zoomable')!;
  frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) });
  const img = frame.querySelector('img')!;
  Object.defineProperty(img, 'naturalWidth', { value: natural.width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: natural.height, configurable: true });
  return { frame, img };
}

const zoomOf = (frame: HTMLElement) => JSON.parse(frame.dataset.zoom!) as { k: number; x: number; y: number };

const FIRE = { pointerdown: fireEvent.pointerDown, pointermove: fireEvent.pointerMove, pointerup: fireEvent.pointerUp, pointercancel: fireEvent.pointerCancel };
function pointer(el: Element, type: keyof typeof FIRE, id: number, x: number, y: number) {
  FIRE[type](el, { pointerId: id, clientX: x, clientY: y, button: 0 });
}

describe('ZoomableImage (CARD-VIEW-1: a card picture that zooms)', () => {
  it('shows the picture whole at first, with a visible zoom control at its bottom-right', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" frameClass="pane__frame" imgClass="pane__image" />);
    const { frame, img } = laidOut();
    expect(img).toHaveAttribute('alt', 'Rem');
    expect(img).toHaveClass('pane__image');
    expect(img).toHaveAttribute('crossorigin', 'anonymous');
    expect(frame).toHaveClass('pane__frame');
    expect(zoomOf(frame)).toEqual({ k: 1, x: 0, y: 0 });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  });

  it('the zoom control zooms in, and again zooms back out to the whole picture', async () => {
    const user = userEvent.setup();
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame, img } = laidOut();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomOf(frame).k).toBe(2);
    expect(img.style.transform).toMatch(/scale\(2\)/);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoomOf(frame)).toEqual({ k: 1, x: 0, y: 0 });
    expect(img.style.transform).toBe('');
  });

  it('the z key zooms in and out (the full-screen viewer\'s key)', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    fireEvent.keyDown(frame, { key: 'z' });
    expect(zoomOf(frame).k).toBe(2);
    fireEvent.keyDown(frame, { key: 'Z' });
    expect(zoomOf(frame).k).toBe(1);
    fireEvent.keyDown(frame, { key: 'x' });
    expect(zoomOf(frame).k).toBe(1);
  });

  // CARD-VIEW-1 part 2 (Ross 10-25): the control and the key start at the face, half across and a third down the picture
  it('the zoom control and the z key first zoom in on the face: half across and a third down the picture, in the middle', async () => {
    const user = userEvent.setup();
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    // a 600 x 900 portrait in the 400 x 400 frame: laid out 266.7 x 400 at x = 66.7
    const { frame } = laidOut({ width: 600, height: 900 });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    let z = zoomOf(frame);
    expect(z.k).toBe(2);
    expect((66.667 + 266.667 / 2) * 2 + z.x).toBeCloseTo(200, 1);
    expect((400 / 3) * 2 + z.y).toBeCloseTo(200, 1);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.keyDown(frame, { key: 'z' });
    z = zoomOf(frame);
    expect(z).toEqual({ k: 2, x: -200, y: -66.667 });
  });

  it('a double-tap zooms in at the point tapped, and a second one zooms back out', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    const tap = (x: number, y: number) => {
      pointer(frame, 'pointerdown', 1, x, y);
      pointer(frame, 'pointerup', 1, x, y);
    };
    tap(100, 120);
    expect(zoomOf(frame).k).toBe(1);
    tap(102, 121);
    const z = zoomOf(frame);
    expect(z.k).toBe(2);
    // the picture's point under the tap stays under it
    expect(102 * z.k + z.x).toBeCloseTo(102);
    expect(121 * z.k + z.y).toBeCloseTo(121);
    tap(300, 300);
    tap(300, 300);
    expect(zoomOf(frame).k).toBe(1);
  });

  it('two taps far apart, or slow, are two taps', () => {
    vi.useFakeTimers();
    try {
      render(<ZoomableImage src="/a.png" alt="Rem" />);
      const { frame } = laidOut();
      pointer(frame, 'pointerdown', 1, 50, 50);
      pointer(frame, 'pointerup', 1, 50, 50);
      pointer(frame, 'pointerdown', 1, 250, 250);
      pointer(frame, 'pointerup', 1, 250, 250);
      expect(zoomOf(frame).k).toBe(1);
      vi.advanceTimersByTime(1000);
      pointer(frame, 'pointerdown', 1, 250, 250);
      pointer(frame, 'pointerup', 1, 250, 250);
      expect(zoomOf(frame).k).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pinch zooms about the fingers\' midpoint; let go near 1x it settles at 1x', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    pointer(frame, 'pointerdown', 1, 150, 200);
    pointer(frame, 'pointerdown', 2, 250, 200);
    pointer(frame, 'pointermove', 1, 100, 200);
    pointer(frame, 'pointermove', 2, 300, 200);
    expect(zoomOf(frame).k).toBeCloseTo(2);
    expect(frame).toHaveClass('zoomable--live');
    pointer(frame, 'pointerup', 2, 300, 200);
    pointer(frame, 'pointerup', 1, 100, 200);
    expect(zoomOf(frame).k).toBeCloseTo(2);
    expect(frame).not.toHaveClass('zoomable--live');
    // a pinch back in, let go just over 1x: 1x exactly
    pointer(frame, 'pointerdown', 1, 100, 200);
    pointer(frame, 'pointerdown', 2, 300, 200);
    pointer(frame, 'pointermove', 1, 148, 200);
    pointer(frame, 'pointermove', 2, 252, 200);
    pointer(frame, 'pointercancel', 1, 148, 200);
    pointer(frame, 'pointercancel', 2, 252, 200);
    expect(zoomOf(frame)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it('zoomed, one finger pans the picture; at 1x a drag moves nothing (the page scrolls)', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    pointer(frame, 'pointerdown', 1, 200, 200);
    pointer(frame, 'pointermove', 1, 260, 200);
    pointer(frame, 'pointerup', 1, 260, 200);
    expect(zoomOf(frame)).toEqual({ k: 1, x: 0, y: 0 });
    expect(frame.dataset.zoomed).toBe('0');
    fireEvent.keyDown(frame, { key: 'z' });
    const before = zoomOf(frame);
    expect(frame.dataset.zoomed).toBe('1');
    pointer(frame, 'pointerdown', 1, 200, 200);
    pointer(frame, 'pointermove', 1, 230, 190);
    pointer(frame, 'pointerup', 1, 230, 190);
    const after = zoomOf(frame);
    expect(after.x - before.x).toBeCloseTo(30);
    expect(after.y - before.y).toBeCloseTo(-10);
    // a pan is no tap: no double-tap with the next one
    pointer(frame, 'pointerdown', 1, 230, 190);
    pointer(frame, 'pointerup', 1, 230, 190);
    expect(zoomOf(frame).k).toBe(2);
  });

  it('a press on its zoom control is the control\'s, never a tap or a pan of the picture', () => {
    render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    const button = screen.getByRole('button', { name: 'Zoom in' });
    pointer(button, 'pointerdown', 1, 380, 380);
    pointer(button, 'pointerup', 1, 380, 380);
    pointer(button, 'pointerdown', 1, 380, 380);
    pointer(button, 'pointerup', 1, 380, 380);
    expect(zoomOf(frame).k).toBe(1);
  });

  it('a new picture starts whole', () => {
    const { rerender } = render(<ZoomableImage src="/a.png" alt="Rem" />);
    const { frame } = laidOut();
    fireEvent.keyDown(frame, { key: 'z' });
    expect(zoomOf(frame).k).toBe(2);
    rerender(<ZoomableImage src="/b.png" alt="Ram" />);
    expect(zoomOf(frame)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it('reports a picture that fails to load', () => {
    const onError = vi.fn();
    render(<ZoomableImage src="/a.png" alt="Rem" onError={onError} />);
    fireEvent.error(document.querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
