/**
 * The case's interim layout rules (CASE-FB2a, Ross 2026-10-16), until saved layouts, saved positions and moving a
 * figure by hand exist ("we will have to think about saved layout behavior once we do have saved layouts, saved
 * positions and the ability to reposition"). Each is one switch a saved-layout mode turns off.
 */

/**
 * A filter shows its figures packed alone from the wall's start, in the list's order, as if the others did not
 * exist (Collection gives the case the filtered, sorted list), and a new filter or sort starts the view there
 * again: the walk, the lift, the pans, the cabinet and the shelf in view ("it might only show a few figures instead
 * of hundreds... else much empty"). Off, the view stays where it is when the filter changes.
 */
export const REPACK_ON_FILTER = true;

/**
 * Each figure's base stands centred in its surface's usable depth, front to back, its picture at the base's front
 * (the picture draws the figure from the front: the bottom of its base is the base's front edge). Off, the picture
 * stands at the middle of the depth with the base behind it, as before CASE-FB2a ("being in a line and recessed
 * quite far back especially on the deeper shelf unit looks funny").
 */
export const CENTRE_IN_DEPTH = true;

/**
 * A figure only a top takes (taller than every compartment: many 1/6 and 1/4 figures in a KLINGSBO) stands on the
 * earliest top of a cabinet the shelves have already opened, or waits for the next one they open; those left when
 * the shelf figures are all placed go at the wall's end. Off, each took the first top from the shelves' cabinet on and
 * opened cabinets ahead of the shelves (Ross 10-16: "empty cases"). Tops hold only about two such figures, so a
 * collection with many keeps a tail of cabinets used only on top until shelves can be taken out (CASE-FB2b, TALL1).
 */
export const TALL_ON_OPENED_TOPS = true;

/**
 * CASE-FB2b (Ross TALL1 10-15, option 1, as the default): a figure too tall for every stock compartment (most 1/6
 * and 1/4 figures in a KLINGSBO: 403 of Ross's 1,146 copies are over 256 mm) stands in a tier a cabinet makes by
 * taking lift-out glass shelves out; one shelf out makes about 530 mm in a KLINGSBO, two together 805 mm. The
 * layout is derived for each cabinet, never saved; off (a saved layout that keeps its shelves), they go on the tops.
 */
export const TALL_SHELF_REMOVAL_DEFAULT = true;

/** Where a base stands front to back, z in mm (0 = the cabinet front, negative = back). */
export interface BaseDepth {
  readonly frontMm: number;
  readonly backMm: number;
}

/**
 * Where a base `depthMm` deep stands on a surface whose usable depth runs back from `frontZMm`: centred in it, or
 * (a base deeper than the surface) from its front, overhanging behind.
 */
export function baseDepth(slot: { readonly frontZMm: number; readonly depthMm: number }, depthMm: number, centred: boolean = CENTRE_IN_DEPTH): BaseDepth {
  const middle = slot.frontZMm - slot.depthMm / 2;
  const frontMm = centred ? Math.min(slot.frontZMm, middle + depthMm / 2) : middle;
  return { frontMm, backMm: frontMm - depthMm };
}
