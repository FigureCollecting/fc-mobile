import { create } from 'zustand';

/**
 * Chrome visibility store — the app shell reports scroll intent, and the
 * slim header + tab bar slide away on scroll-down / return on scroll-up,
 * giving the viewport back to figures.
 */
interface ChromeState {
  /** True when chrome (header + tab bar) should be hidden. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

export const useChromeStore = create<ChromeState>((set) => ({
  hidden: false,
  setHidden: (hidden) => set((s) => (s.hidden === hidden ? s : { hidden })),
}));

const SHOW_NEAR_TOP_PX = 32;
const DELTA_THRESHOLD_PX = 6;

/**
 * Create a scroll handler that flips chrome visibility from scroll direction.
 * Pure factory so the logic is unit-testable without a DOM scroller.
 */
export function createScrollChromeHandler(
  setHidden: (hidden: boolean) => void = useChromeStore.getState().setHidden,
) {
  let lastTop = 0;
  return (scrollTop: number) => {
    const delta = scrollTop - lastTop;
    if (scrollTop <= SHOW_NEAR_TOP_PX) {
      setHidden(false);
    } else if (delta > DELTA_THRESHOLD_PX) {
      setHidden(true);
    } else if (delta < -DELTA_THRESHOLD_PX) {
      setHidden(false);
    }
    lastTop = scrollTop;
  };
}
