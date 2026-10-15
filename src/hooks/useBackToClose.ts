/**
 * Android Back / browser Back closes an overlay (SHEETS-FB1 6c: the Info viewer and pane; Refine and View):
 * while it is open it holds a history entry of its own, at the page's address. Back pops that entry and closes it;
 * closed any other way (its X, Esc, a swipe), it takes its entry back off, unless the app has gone on
 * to another page meanwhile (that Back would undo the navigation).
 *
 * The page writes its filters into the address in place (replaceState) and may do so while an overlay is
 * open: either way out, the address the page last wrote is the one it is left at.
 *
 * One listener serves every overlay, so a Back an overlay takes off for itself (it runs later, as the
 * browser traverses) is never read as Back over an overlay opened in the meantime; and an overlay opened
 * while such a Back is still to come takes its entry once it has landed (pushed before it, the entry
 * would be the one that Back takes off).
 *
 * Esc is the keyboard's Back: it closes the overlay on top (the latest opened), never one under it.
 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

interface Entry {
  close: () => void;
  /** The address as the page last left it while the overlay was open. */
  href: string;
}

/** Overlays holding a history entry, the latest last. */
const open: Entry[] = [];
/** Overlays opened while a Back is owed: their entries wait for it to land. */
const waiting: Entry[] = [];
/** Entries overlays closing themselves still have to take off (taken together, in one go, after the task). */
let debt = 0;
/** The address to leave the page at once that go lands (its popstate is still to come); null when none is. */
let owed: string | null = null;
let listening = false;

/** One history.go for every entry owed: browsers do not reliably run two Backs queued in one task. */
function payDebt() {
  const steps = debt;
  debt = 0;
  owed = location.href;
  history.go(-steps);
}

function hold(entry: Entry) {
  entry.href = location.href;
  history.pushState(history.state, '', location.href);
  open.push(entry);
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // the latest opened: one waiting for its entry is newer than every one holding its own
  (waiting.at(-1) ?? open.at(-1))?.close();
}

const restore = (href: string) => {
  if (location.href !== href) history.replaceState(history.state, '', href);
};

function onPop() {
  if (owed !== null) {
    restore(owed);
    owed = null;
    waiting.splice(0).forEach(hold);
    return;
  }
  const top = open.pop();
  if (!top) return;
  restore(top.href);
  top.close();
}

export function useBackToClose(onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  const entry = useRef<Entry | null>(null);

  // the address the page last wrote, read after each of its renders
  useEffect(() => {
    if (entry.current) entry.current.href = location.href;
  });

  // as it commits, not a frame later: a Back right after it opens is already its own
  useLayoutEffect(() => {
    if (!listening) {
      window.addEventListener('popstate', onPop);
      document.addEventListener('keydown', onKey);
      listening = true;
    }
    const pathname = location.pathname;
    const mine: Entry = { close: () => latest.current(), href: location.href };
    entry.current = mine;
    if (debt > 0 || owed !== null) waiting.push(mine);
    else hold(mine);
    return () => {
      entry.current = null;
      const queued = waiting.indexOf(mine);
      if (queued >= 0) {
        waiting.splice(queued, 1);
        return;
      }
      const at = open.indexOf(mine);
      // popped by Back: its entry is gone already
      if (at < 0) return;
      open.splice(at, 1);
      if (location.pathname !== pathname) return;
      if (debt++ === 0) queueMicrotask(payDebt);
    };
  }, []);
}

/** An overlay's Back and Esc for one rendered while it is open (Refine and View, whose cards are shared). */
export function BackToClose({ onClose }: { onClose: () => void }): null {
  useBackToClose(onClose);
  return null;
}
