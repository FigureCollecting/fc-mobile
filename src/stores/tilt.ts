import { create } from 'zustand';
import type { TiltKind } from '../sensors/relativeOrientation';

/**
 * NAV-LOGPOSE: the Log-Pose orb's state for this session, never stored (the orb starts OFF every session, plan U8 (h)).
 * - support: not looked at yet ('unknown'), being probed, none (the orb hidden), a source ready ('sensor', 'event'), iOS's
 *   permission still to ask on the orb's click ('ask'), or refused or silent once asked ('denied': the orb disabled and
 *   explained).
 * - on: the fine Look switched on. Kept while the controls are hidden (a card over the case): their sampling stops, the
 *   state the user set does not.
 */
export type TiltSupport = 'unknown' | 'probing' | 'none' | TiltKind | 'ask' | 'denied';

interface TiltState {
  support: TiltSupport;
  on: boolean;
}

export const useTiltStore = create<TiltState>(() => ({ support: 'unknown', on: false }));
