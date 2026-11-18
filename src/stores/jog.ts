import { create } from 'zustand';

/**
 * NAV-JOG (Ross 10-28): what the hat drives as a jog. A Free camera case offers one while it is shown; the hat then moves
 * its camera the way the thumb holds it from where it went down (CabinetScene, useFreeCamera). NAV-FLOAT (11-18): the hat
 * is the floating control lower-right of the case (NavHat), no longer the tab bar's bottom-centre button.
 */
export interface JogTarget {
  /** The thumb has left the dead zone: the jog begins (false: the scene is busy with a finger of its own). */
  start(): boolean;
  /** The thumb's offset (CSS px) from where it went down: the way and how fast. */
  aim(dxPx: number, dyPx: number): void;
  /** The thumb lifts (or the browser takes it): the camera stops where the jog got it. */
  stop(): void;
  /** NAV-2B: its top speed in the 10-28 jog's (?jogmax=; JOG_MAX_X when absent): where the button's detents tick (jogSpeed). */
  readonly max?: number;
  /**
   * NAV-DEPTH-2: the depth rocker's drive of the same camera, held with the jog or alone (useFreeCamera's depthStart,
   * depthRate, depthStop): the rocker leaves its centre at reach r in [-1, 1] (+ forward; false: the scene is busy with
   * a finger of its own), its reach now, and its spring back to the centre. Absent, the jog offers no depth.
   */
  readonly depth?: DepthDrive;
}

/** NAV-DEPTH-2: what the depth rocker drives (JogTarget's depth). */
export interface DepthDrive {
  start(r: number): boolean;
  rate(r: number): void;
  stop(): void;
}

interface JogState {
  /** The jog on offer; null: no control floats. */
  target: JogTarget | null;
}

export const useJogStore = create<JogState>(() => ({ target: null }));

/** Offer this jog to the floating controls; the call returned takes it back (unless another has been offered since). */
export function offerJog(target: JogTarget): () => void {
  useJogStore.setState({ target });
  return () => {
    if (useJogStore.getState().target === target) useJogStore.setState({ target: null });
  };
}
