import { create } from 'zustand';

/**
 * NAV-JOG (Ross 10-28): what the bottom-centre button drives as a jog. A Free camera case offers one while it is shown;
 * the button then moves its camera the way the thumb holds it from where it went down (CabinetScene, useFreeCamera).
 */
export interface JogTarget {
  /** The thumb has left the dead zone: the jog begins (false: the scene is busy with a finger of its own). */
  start(): boolean;
  /** The thumb's offset (CSS px) from where it went down: the way and how fast. */
  aim(dxPx: number, dyPx: number): void;
  /** The thumb lifts (or the browser takes it): the camera stops where the jog got it. */
  stop(): void;
}

interface JogState {
  /** The jog on offer; null: the button is the Add button. */
  target: JogTarget | null;
}

export const useJogStore = create<JogState>(() => ({ target: null }));

/** Offer this jog to the bottom-centre button; the call returned takes it back (unless another has been offered since). */
export function offerJog(target: JogTarget): () => void {
  useJogStore.setState({ target });
  return () => {
    if (useJogStore.getState().target === target) useJogStore.setState({ target: null });
  };
}
