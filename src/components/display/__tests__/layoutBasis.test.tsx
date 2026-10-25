// LAYOUT-STABLE-1 (Ross 10-18, a first launch: the larger figures "flash into and out of place while it works out what
// goes where"). The pictures of a collection arrive for minutes (a sync keeps two a figure, shown once a second), and every
// one changes what a figure packs as, so the whole wall packed again each time. The case now lays out from a basis that
// is taken at a few moments and held between them: the first reveal, an explicit change, once everything has arrived.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/preact';
import { EMPTY_MS, HUSH_MS, QUIET_MS, REVEAL_MAX_MS, useLayoutBasis, type BasisInput } from '../layoutBasis';

type Live = { n: number };
const seen: { basis: Live | null; revealed: boolean; final: boolean }[] = [];

function Probe({ input }: { input: BasisInput<Live> }) {
  const out = useLayoutBasis(input);
  seen.push(out);
  return <div data-basis={out.basis === null ? 'none' : String(out.basis.n)} />;
}

const base = (over: Partial<BasisInput<Live>> = {}): BasisInput<Live> => ({ live: { n: 1 }, pending: 0, settled: false, ready: true, epoch: 'a', ...over });
const basisOf = (el: Element) => el.querySelector('div')!.getAttribute('data-basis');
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  seen.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the first reveal', () => {
  it('holds back until nothing is pending and the list has been still for HUSH_MS, then takes the live inputs of that moment', () => {
    const { container, rerender } = render(<Probe input={base({ pending: 3 })} />);
    expect(basisOf(container)).toBe('none');
    // still pending: nothing to reveal however long it takes (up to the deadline)
    wait(REVEAL_MAX_MS / 2);
    expect(basisOf(container)).toBe('none');
    rerender(<Probe input={base({ pending: 0, live: { n: 2 } })} />);
    wait(HUSH_MS - 1);
    expect(basisOf(container)).toBe('none');
    wait(1);
    expect(basisOf(container)).toBe('2');
  });

  it('is put off while the list is still arriving: an explicit change restarts the hush', () => {
    const { container, rerender } = render(<Probe input={base({ epoch: 'a' })} />);
    wait(HUSH_MS - 100);
    rerender(<Probe input={base({ epoch: 'b', live: { n: 2 } })} />);
    wait(HUSH_MS - 100);
    expect(basisOf(container)).toBe('none');
    wait(100);
    expect(basisOf(container)).toBe('2');
  });

  it('gives up waiting after REVEAL_MAX_MS from when there was something to lay out, with whatever has arrived', () => {
    const { container, rerender } = render(<Probe input={base({ pending: 5 })} />);
    wait(REVEAL_MAX_MS - 1);
    rerender(<Probe input={base({ pending: 4, live: { n: 7 } })} />);
    expect(basisOf(container)).toBe('none');
    wait(1);
    expect(basisOf(container)).toBe('7');
  });

  it('counts the deadline from when there was something to lay out, not from the mount', () => {
    const { container, rerender } = render(<Probe input={base({ ready: false, pending: 1 })} />);
    wait(EMPTY_MS - 500);
    rerender(<Probe input={base({ ready: true, pending: 1, live: { n: 3 } })} />);
    wait(REVEAL_MAX_MS - 1);
    expect(basisOf(container)).toBe('none');
    wait(1);
    expect(basisOf(container)).toBe('3');
  });

  it('reveals an empty list after EMPTY_MS: nothing to lay out is not a reason to wait for ever', () => {
    const { container } = render(<Probe input={base({ ready: false, pending: 0, live: { n: 0 } })} />);
    wait(EMPTY_MS - 1);
    expect(basisOf(container)).toBe('none');
    wait(1);
    expect(basisOf(container)).toBe('0');
  });
});

describe('the first reveal, when nothing is arriving', () => {
  it('is the very first render when everything has already arrived (settled): no frame without the layout, and no hush', () => {
    const { container } = render(<Probe input={base({ settled: true, live: { n: 4 } })} />);
    expect(basisOf(container)).toBe('4');
    expect(seen[0]!.revealed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still waits for what is pending when settled is claimed: settled means the lot arrived, pending says it did not', () => {
    const { container } = render(<Probe input={base({ settled: true, pending: 2 })} />);
    expect(basisOf(container)).toBe('none');
  });

  it('is never held back when it is off (enabled false): the live inputs, always, with no timer', () => {
    const { container, rerender } = render(<Probe input={base({ enabled: false, pending: 9, live: { n: 1 } })} />);
    expect(basisOf(container)).toBe('1');
    rerender(<Probe input={base({ enabled: false, pending: 9, live: { n: 2 } })} />);
    expect(basisOf(container)).toBe('2');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('after the reveal the basis is held', () => {
  const revealed = () => {
    const out = render(<Probe input={base()} />);
    wait(HUSH_MS);
    expect(basisOf(out.container)).toBe('1');
    return out;
  };

  it('keeps the very same basis while the live inputs go on changing: nothing packs again for a picture that arrives', () => {
    const { container, rerender } = revealed();
    const first = seen[seen.length - 1]!.basis;
    for (let n = 2; n < 40; n++) rerender(<Probe input={base({ live: { n }, pending: 1 })} />);
    expect(basisOf(container)).toBe('1');
    expect(seen[seen.length - 1]!.basis).toBe(first);
  });

  it('takes the live inputs at once, in the very render, on an explicit change (a filter, a sort, a figure added or removed)', () => {
    const { container, rerender } = revealed();
    rerender(<Probe input={base({ live: { n: 9 }, epoch: 'b' })} />);
    // no frame stands between: the first render with the new epoch already holds the new basis
    expect(seen[seen.length - 1]!.basis).toEqual({ n: 9 });
    expect(basisOf(container)).toBe('9');
  });

  it('takes the live inputs once when everything has arrived (settled), and not again until something more arrives', () => {
    const { container, rerender } = revealed();
    rerender(<Probe input={base({ live: { n: 5 }, pending: 2 })} />);
    expect(basisOf(container)).toBe('1');
    rerender(<Probe input={base({ live: { n: 6 }, pending: 0, settled: true })} />);
    expect(basisOf(container)).toBe('6');
    const count = seen.length;
    // nothing new: no further render, no further basis
    wait(QUIET_MS * 2);
    expect(seen.length).toBe(count);
    expect(basisOf(container)).toBe('6');
  });

  it('does nothing for being settled when nothing arrived since the basis was taken', () => {
    const { container, rerender } = revealed();
    const count = seen.length;
    // the very live inputs the basis was taken from: nothing has arrived
    rerender(<Probe input={base({ settled: true, live: seen[seen.length - 1]!.basis! })} />);
    expect(basisOf(container)).toBe('1');
    // the re-render is the only one: no basis was taken again
    expect(seen.length).toBe(count + 1);
  });

  it('takes the live inputs once after QUIET_MS with nothing more arriving, when never settled (a stalled picture), and a later arrival restarts the wait', () => {
    const { container, rerender } = revealed();
    rerender(<Probe input={base({ live: { n: 2 } })} />);
    wait(QUIET_MS - 1);
    rerender(<Probe input={base({ live: { n: 3 } })} />);
    wait(QUIET_MS - 1);
    expect(basisOf(container)).toBe('1');
    wait(1);
    expect(basisOf(container)).toBe('3');
  });
});

// LAYOUT-FINAL: whether the layout held now is the one it settles on (everything arrived and laid out by), so a reader that
// must not see the wall packed again under it (an e2e walk reading what each cabinet holds) can wait for it
describe('the final layout', () => {
  const last = () => seen[seen.length - 1]!;

  it('is not final before the first layout, nor while the layout taken waits on what is still arriving', () => {
    const { rerender } = render(<Probe input={base({ pending: 3 })} />);
    expect(last().final).toBe(false);
    rerender(<Probe input={base({ pending: 0, live: { n: 2 } })} />);
    wait(HUSH_MS);
    expect(last().revealed).toBe(true);
    expect(last().final).toBe(false);
    // more arrives, still not all of it
    rerender(<Probe input={base({ live: { n: 3 } })} />);
    expect(last().final).toBe(false);
  });

  it('is final only once everything has arrived and the layout is taken by it: never in the render that still holds the old one', () => {
    const { rerender } = render(<Probe input={base()} />);
    wait(HUSH_MS);
    const from = seen.length;
    rerender(<Probe input={base({ live: { n: 6 }, settled: true })} />);
    const after = seen.slice(from);
    // the render that first sees it settled still holds the basis of n 1 (dirty): not final; the tidy-up's render is
    expect(after[0]!.basis).toEqual({ n: 1 });
    expect(after[0]!.final).toBe(false);
    expect(last().basis).toEqual({ n: 6 });
    expect(last().final).toBe(true);
  });

  it('is final at the very first render when everything has already arrived', () => {
    render(<Probe input={base({ settled: true })} />);
    expect(seen[0]!.final).toBe(true);
  });

  it('is no longer final once something more arrives (the layout dirties), and is again once that is laid out', () => {
    const { rerender } = render(<Probe input={base({ settled: true })} />);
    expect(last().final).toBe(true);
    // a later sync brings a picture: the held layout is no longer what everything says
    rerender(<Probe input={base({ live: { n: 2 }, settled: false })} />);
    expect(last().final).toBe(false);
    wait(QUIET_MS - 1);
    expect(last().final).toBe(false);
    rerender(<Probe input={base({ live: { n: 3 }, settled: true })} />);
    expect(last().basis).toEqual({ n: 3 });
    expect(last().final).toBe(true);
  });

  it('is not final after the quiet-spell layout: the rest stalled, it may yet arrive and pack the wall again', () => {
    const { rerender } = render(<Probe input={base()} />);
    wait(HUSH_MS);
    rerender(<Probe input={base({ live: { n: 2 } })} />);
    wait(QUIET_MS);
    expect(last().basis).toEqual({ n: 2 });
    expect(last().final).toBe(false);
  });

  it('is final in the very render of an explicit change when everything has arrived', () => {
    const { rerender } = render(<Probe input={base({ settled: true })} />);
    rerender(<Probe input={base({ live: { n: 9 }, epoch: 'b', settled: true })} />);
    expect(last().basis).toEqual({ n: 9 });
    expect(last().final).toBe(true);
  });

  it('is always final when the held basis is off: the live inputs are the layout', () => {
    render(<Probe input={base({ enabled: false, pending: 9 })} />);
    expect(last().final).toBe(true);
  });
});

describe('cleanup', () => {
  it('leaves no timer running when it goes away', () => {
    const { unmount } = render(<Probe input={base({ pending: 1 })} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
