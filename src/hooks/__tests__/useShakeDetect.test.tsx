import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useShakeDetect } from '../useShakeDetect';

function makeMotionEvent(x: number, y: number, z: number): Event {
  const ev = new Event('devicemotion');
  Object.defineProperty(ev, 'accelerationIncludingGravity', {
    value: { x, y, z },
    configurable: true,
  });
  return ev;
}

describe('useShakeDetect', () => {
  it('fires the shake callback when movement exceeds threshold', () => {
    const cb = vi.fn();
    renderHook(() => useShakeDetect(cb, 10));
    act(() => {
      // Baseline
      window.dispatchEvent(makeMotionEvent(0, 0, 0));
      // Large jerk
      window.dispatchEvent(makeMotionEvent(20, 20, 20));
    });
    expect(cb).toHaveBeenCalled();
  });

  it('ignores motion events that do not cross the threshold', () => {
    const cb = vi.fn();
    renderHook(() => useShakeDetect(cb, 50));
    act(() => {
      window.dispatchEvent(makeMotionEvent(0, 0, 0));
      window.dispatchEvent(makeMotionEvent(5, 5, 5));
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cleans up the listener on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useShakeDetect(cb, 5));
    unmount();
    act(() => {
      window.dispatchEvent(makeMotionEvent(0, 0, 0));
      window.dispatchEvent(makeMotionEvent(100, 100, 100));
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
