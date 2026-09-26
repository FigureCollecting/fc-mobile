/**
 * Empty shelves under a short collection, so the case reads as one cabinet
 * standing down to the bottom of the screen rather than a short box over a
 * blank page. Asked of Ross in PR #17 and not yet answered; this is the
 * orchestrator's default, kept to this one function so it is easy to change.
 *
 * Returns the heights of the empty bays to append: whole shelves at the
 * pitch of the median occupied shelf (lower middle for an even count, so a
 * single tall shelf does not set it), as many as fit in `availablePx`
 * together with the occupied ones. Never a partial shelf.
 */
export function emptyShelfFill(occupiedPx: number[], availablePx: number): number[] {
  if (occupiedPx.length === 0 || !(availablePx > 0)) return [];
  const sorted = [...occupiedPx].sort((a, b) => a - b);
  const pitch = sorted[Math.floor((sorted.length - 1) / 2)];
  if (!(pitch > 0)) return [];
  const used = occupiedPx.reduce((sum, h) => sum + h, 0);
  const count = Math.floor((availablePx - used) / pitch);
  return count > 0 ? new Array<number>(count).fill(pitch) : [];
}
