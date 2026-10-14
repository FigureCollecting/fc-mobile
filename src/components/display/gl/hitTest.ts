/**
 * CASE-GL taps: the ray through the tapped pixel, cast onto the figure
 * cards drawn. A card is flat at its own z facing the viewer, so the ray
 * meets each card's plane at one point (unprojectToPlaneZ, the inverse of
 * the camera's projection); the nearest card whose tap box holds that point
 * takes the tap, the same tap box the classic view's figure button is.
 */
import { unprojectToPlaneZ, type Camera } from '../caseCamera';

/** A card's tap box: x0..x1 by y0..y1 (world mm) at z. */
export interface TapBox {
  readonly id: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
}

/** The id of the nearest card under (sx, sy), CSS px from the frame's top left; null when none is. */
export function hitCard(camera: Camera, panPx: number, cards: readonly TapBox[], sx: number, sy: number): number | null {
  let best: TapBox | null = null;
  const onPlane = new Map<number, ReturnType<typeof unprojectToPlaneZ>>();
  for (const card of cards) {
    if (best && card.z <= best.z) continue;
    let p = onPlane.get(card.z);
    if (p === undefined) {
      p = unprojectToPlaneZ(camera, sx - panPx, sy, card.z);
      onPlane.set(card.z, p);
    }
    if (p && p[0] >= card.x0 && p[0] <= card.x1 && p[1] >= card.y0 && p[1] <= card.y1) best = card;
  }
  return best ? best.id : null;
}
