import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { useBrokenImages, type BrokenImages } from '../useBrokenImages';

// ADDR-1 + DESK1: an address that failed to load is remembered as broken; retry forgets that one address only, so the
// next <img> for it is tried again, and leaves every other failed address as it was.

const A = 'https://images.figurecollecting.com/d/a';
const B = 'https://images.figurecollecting.com/d/b';

function harness() {
  const seen: { images: BrokenImages; renders: number } = { images: undefined as unknown as BrokenImages, renders: 0 };
  function Probe() {
    seen.images = useBrokenImages();
    seen.renders++;
    return null;
  }
  render(<Probe />);
  return seen;
}

afterEach(cleanup);

describe('useBrokenImages', () => {
  it('remembers each failed address, and none that did not fail', () => {
    const h = harness();
    expect(h.images.broken(A)).toBe(false);
    expect(h.images.broken(undefined)).toBe(false);
    act(() => h.images.failed(A));
    expect(h.images.broken(A)).toBe(true);
    expect(h.images.broken(B)).toBe(false);
  });

  it('DESK1: retry forgets the one address it names; the others stay broken', () => {
    const h = harness();
    act(() => {
      h.images.failed(A);
      h.images.failed(B);
    });
    act(() => h.images.retry(A));
    expect(h.images.broken(A)).toBe(false);
    expect(h.images.broken(B)).toBe(true);
    // and it can fail again
    act(() => h.images.failed(A));
    expect(h.images.broken(A)).toBe(true);
  });

  it('DESK1: a retry of an address that never failed (or a failure told twice) changes nothing and draws nothing again', () => {
    const h = harness();
    act(() => h.images.failed(B));
    const renders = h.renders;
    act(() => h.images.retry(A));
    act(() => h.images.failed(B));
    expect(h.renders).toBe(renders);
    expect(h.images.broken(A)).toBe(false);
    expect(h.images.broken(B)).toBe(true);
  });
});
