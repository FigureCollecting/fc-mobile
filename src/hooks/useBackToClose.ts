/**
 * Android Back / browser Back closes an overlay (SHEETS-FB1 6c: the Info viewer and pane): while it is
 * open it holds a history entry of its own, at the page's address. Back pops that entry and closes it;
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
 */
import { useEffect, useRef } from 'preact/hooks';

interface Entry {
  close: () => void;
  /** The address as the page last left it while the overlay was open. */
  href: string;
}

/** Overlays holding a history entry, the latest last. */
const open: Entry[] = [];
/** Overlays opened while a Back is owed: their entries wait for it to land. */
const waiting: Entry[] = [];
/** Backs taken by overlays closing themselves, whose popstate is still to come: [address to leave it at]. */
const owed: string[] = [];
let listening = false;

function hold(entry: Entry) {
  entry.href = location.href;
  history.pushState(history.state, '', location.href);
  open.push(entry);
}

const restore = (href: string) => {
  if (location.href !== href) history.replaceState(history.state, '', href);
};

function onPop() {
  const href = owed.shift();
  if (href !== undefined) {
    restore(href);
    if (owed.length === 0) waiting.splice(0).forEach(hold);
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

  useEffect(() => {
    if (!listening) {
      window.addEventListener('popstate', onPop);
      listening = true;
    }
    const pathname = location.pathname;
    const mine: Entry = { close: () => latest.current(), href: location.href };
    entry.current = mine;
    if (owed.length > 0) waiting.push(mine);
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
      owed.push(location.href);
      history.back();
    };
  }, []);
}
