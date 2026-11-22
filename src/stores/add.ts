import { create } from 'zustand';

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

export const openAdd = () => useAddStore.setState({ open: true });
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
