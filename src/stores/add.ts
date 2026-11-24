import { create } from 'zustand';
import { authPhase } from '../local/session';
import { isFixtureMode } from '../dev-fixtures/fixtures';

/**
 * ADDFAB b (nav rework, plan section 7): the one "Add figures" entry. The tab bar holds its sheet and, on most screens,
 * its raised +; where a page's header hosts Add instead (the collection: beside Case / Tiles, so the pull-up tabs have
 * the whole width), the raised + leaves the bar for as long as the header's button shows.
 */
interface AddState {
  /** The Add sheet is open. */
  open: boolean;
  /** How many header buttons show: above none, the tab bar's raised + is away. */
  inHeader: number;
}

export const useAddStore = create<AddState>(() => ({ open: false, inHeader: 0 }));

/**
 * SIGNED-OUT-ADD (Ross 11-23): adding figures needs an account, so no Add shows and the sheet never opens while signed
 * out, nor while the session is still loading (no + flashes before a sign-out shows). Dev fixture mode, the demo
 * collection with no account, keeps it. Read in a render, it follows the session as it changes.
 */
export function addAllowed(): boolean {
  return authPhase() === 'signed-in' || isFixtureMode();
}

export const openAdd = () => {
  if (addAllowed()) useAddStore.setState({ open: true });
};
export const closeAdd = () => useAddStore.setState({ open: false });

/** A header shows its own Add button; the call returned gives the raised + back (once: a second call is nothing). */
export function hostAddInHeader(): () => void {
  useAddStore.setState((s) => ({ inHeader: s.inHeader + 1 }));
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    useAddStore.setState((s) => ({ inHeader: s.inHeader - 1 }));
  };
}
