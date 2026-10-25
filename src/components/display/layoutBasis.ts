// LAYOUT-STABLE-1 (Ross 10-18, a first launch: the larger figures "flash into and out of place while it works out what goes
// where"). What the case packs the wall by (each figure's picture: its aspect, its clear margins) arrives for minutes on a
// first launch: a sync keeps two pictures a figure and shows each answer once a second. The packer is global (a cabinet's
// arrangement counts the tall and the shelf figures still to place), so every arrival packed the whole wall again, and tens
// of figures moved at once, again and again.
//
// The case now lays out from a BASIS, the picture inputs as they stood at a moment, and keeps it between moments:
//  - the first reveal: once what the layout waits for (the pictures already there, measured) is in and the list and its cards have been still
//    a moment, or at the deadline, with whatever has arrived; until then nothing is drawn, so nothing is drawn twice;
//  - an explicit change (a filter or sort, a figure added or removed): at once, the very render, as the user asked;
//  - once, when everything has arrived (the pictures all kept, none left unmeasured): the one tidy-up;
//  - once, after a quiet spell with something arrived and the rest stalled.
// A picture that arrives between moments draws in the place its figure already has, when it fits (CabinetScene).
import { useEffect, useRef, useState } from 'preact/hooks';

/** The longest the first layout waits for what is still arriving, from when there was something to lay out. */
export const REVEAL_MAX_MS = 3000;
/** The list must have been still this long (no explicit change) before the first layout, so a list arriving in pages is laid out once. */
export const HUSH_MS = 500;
/** Nothing to lay out for this long: the list is empty. */
export const EMPTY_MS = 1500;
/** Something arrived since the basis and nothing more for this long, with the rest stalled: lay out again, once. */
export const QUIET_MS = 8000;

export interface BasisInput<T> {
  /** What the layout would be made by now: a new value each time something arrives (memoised by its parts). */
  live: T;
  /** What the first layout still waits for: pictures there and not yet measured. 0: nothing. */
  pending: number;
  /** Everything the live inputs will give has arrived. */
  settled: boolean;
  /** There is something to lay out. */
  ready: boolean;
  /** Changes when the user changes what is laid out (a filter or sort, a figure added or removed). */
  epoch: string;
  /** Off: the live inputs, always, as before (the dev fixtures, whose pictures never stream in). Default on. */
  enabled?: boolean;
}

interface Taken<T> {
  value: T;
  epoch: string;
  /** The live inputs the value was taken from: what has changed since is what has arrived. */
  from: T;
}

/**
 * `final` (LAYOUT-FINAL): the basis held is the one the layout settles on: everything has arrived and the basis was taken
 * from it. Until then the wall may yet be packed again under whoever reads it.
 */
export function useLayoutBasis<T>(input: BasisInput<T>): { basis: T | null; revealed: boolean; final: boolean } {
  const { live, pending, settled, ready, epoch, enabled = true } = input;
  const held = useRef<Taken<T> | null>(null);
  const [, redraw] = useState(0);
  const latest = useRef(input);
  latest.current = input;

  // an explicit change: the live inputs now, in this very render, so no frame stands on the old basis
  if (held.current !== null && held.current.epoch !== epoch) held.current = { value: live, epoch, from: live };

  // everything has already arrived and nothing is pending: nothing to wait for, so no hush: the first render is laid out
  if (enabled && held.current === null && ready && pending === 0 && settled) held.current = { value: live, epoch, from: live };

  const take = () => {
    const now = latest.current;
    held.current = { value: now.live, epoch: now.epoch, from: now.live };
    redraw((n) => n + 1);
  };

  const revealed = held.current !== null;
  const dirty = held.current !== null && held.current.from !== live;

  // the deadline of the first layout: from when there was something to lay out (or the list is empty for EMPTY_MS)
  useEffect(() => {
    if (!enabled || revealed) return;
    const timer = setTimeout(take, ready ? REVEAL_MAX_MS : EMPTY_MS);
    return () => clearTimeout(timer);
  }, [enabled, revealed, ready]);

  // the first layout, once what it waits for is in and the list has been still a moment
  useEffect(() => {
    if (!enabled || revealed || !ready || pending > 0) return;
    const timer = setTimeout(take, HUSH_MS);
    return () => clearTimeout(timer);
  }, [enabled, revealed, ready, pending, epoch]);

  // everything has arrived: the one tidy-up
  useEffect(() => {
    if (enabled && dirty && settled) take();
  }, [enabled, dirty, settled, live]);

  // something arrived and then nothing for a while: the stalled rest is not waited for
  useEffect(() => {
    if (!enabled || !dirty || settled) return;
    const timer = setTimeout(take, QUIET_MS);
    return () => clearTimeout(timer);
  }, [enabled, dirty, settled, live]);

  if (!enabled) return { basis: live, revealed: true, final: true };
  return { basis: held.current === null ? null : held.current.value, revealed, final: revealed && settled && !dirty };
}
