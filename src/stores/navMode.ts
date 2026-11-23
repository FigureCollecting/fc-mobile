import { create } from 'zustand';

/**
 * NAV-EYE (handoff FINAL 11-17 B; plan section 3): what the floating hat drives, Move (the jog) or Look (the Look drive).
 * The eye's tap (or a double tap on the hat, NAVLOOK 3b) latches it for the session: a card opened and closed, a Go-to
 * and the case left and come back to keep it; it lives in memory only, so a reload starts in Move. NAVLOOK 2a: the eye
 * pressed and slid onto the hat is a temporary Look, for as long as that finger is down, over whichever is latched.
 */
export type NavMode = 'move' | 'look';

interface NavModeState {
  /** The mode the eye has latched. */
  latched: NavMode;
  /** A temporary Look (NAVLOOK 2a) holds the hat now. */
  temp: boolean;
}

export const useNavMode = create<NavModeState>(() => ({ latched: 'move', temp: false }));

/** The mode the hat drives at a press now: a temporary Look, else the latched mode. */
export const navModeNow = (): NavMode => {
  const s = useNavMode.getState();
  return s.temp ? 'look' : s.latched;
};

/** The eye's tap (or the hat's double tap): Move <-> Look. */
export function toggleNavMode(): void {
  useNavMode.setState((s) => ({ latched: s.latched === 'move' ? 'look' : 'move' }));
}

/** NAVLOOK 2a: the slide from the eye has the hat (true) or its finger has lifted (false). */
export function setTempLook(on: boolean): void {
  useNavMode.setState({ temp: on });
}
