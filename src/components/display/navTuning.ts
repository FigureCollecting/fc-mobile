/**
 * NAV-FLOAT (handoff FINAL 11-17; plan section 3): the floating controls' tuning, in one place. These are starting values
 * to tune on the Fold, not finished constants: the tests name them, never their figures. The drives' own constants (the
 * jog's JOG_*, the depth's DEPTH_*) are not here and do not change with these.
 */

/** The one blue every ring, rail, knob and arrow is drawn in (an HSL triple: never white, never gold). */
export const NAV_BLUE = '205 65% 60%';

/**
 * How opaque each part is (Ross 11-17: at rest largely transparent, so no figure is hidden; in use, still muted): the
 * shell's fill, the ring and the rail's outline, the knob and the arrows, and the knob while a thumb holds it.
 */
export const NAV_OPACITY = { fill: 0.14, line: 0.25, knob: 0.55, active: 0.8, look: 0.75 } as const;
/** The knob's glyph (NAV-EYE: cross for Move, turning arrow for Look): a dark blue on the knob, never white. */
export const NAV_GLYPH = 'hsl(205 60% 12% / 0.75)';

/**
 * The hat's ring (CSS px across): compact, and wide once the case's SHORTER side is `wideFrom` px or more (not the width
 * alone: a wide but short scene keeps the compact ring). Its hit shape is the ring's circle.
 */
export const HAT_RING_PX = { compact: 104, wide: 120, wideFrom: 600 } as const;
/** The hat's knob (px across): at full reach (JOG_FULL_PX of thumb travel) its edge touches the ring's. */
export const HAT_KNOB_PX = 36;
/** Where on the ring the eye sits (NAV-EYE), degrees anticlockwise from the right: its upper-left, inboard shoulder. */
export const EYE_SLOT_DEG = 135;
/**
 * NAV-EYE shape (Ross 11-22, "fused"): the eye's bubble, wholly outside the ring but for where it fuses: its centre `at`
 * ring radii out from the hat's centre (at EYE_SLOT_DEG), its radius `r` ring radii. It is also the eye's hit circle.
 * The eye glyph is `glyph` of the bubble's width across. A share of the ring, so it grows and shrinks with it.
 */
export const EYE_BUBBLE = { at: 1.21, r: 0.465, glyph: 0.32 } as const;
/** The eye's hit circle (its bubble) is at least this much across (px) on the compact touch ring. */
export const EYE_HIT_PX = 48;
/** A tap on the eye: at most this much travel (px) and this long (ms) from press to lift. */
export const EYE_TAP = { slopPx: 10, ms: 500 } as const;
/**
 * NAVLOOK 3b: a double tap on the hat toggles Move <-> Look: each tap at most `tapMs` long and still (inside the jog's
 * dead zone: a tap that starts a jog never counts), the second pressed at most `gapMs` after the first lifted.
 */
export const HAT_DOUBLE_TAP = { tapMs: 250, gapMs: 300 } as const;
/** Look's accent (an HSL triple; NAV_OPACITY.look): a thin outline on the eye and the ring while the hat drives Look. */
export const NAV_TEAL = '172 55% 50%';

/** The Z rail (px): what is drawn, the larger box that takes the thumb, the knob, and how far the knob shows full reach. */
export const DEPTH_RAIL_PX = { width: 28, height: 92, hitWidth: 56, hitHeight: 132, knob: 24, travel: 34 } as const;

/** Each control's drawn edge, in from the safe area's side (px). */
export const NAV_EDGE_PX = 20;
/** Each control's drawn bottom, above the case's pull-up tabs (px). */
export const NAV_LIFT_PX = 16;
/** The gap (px) the scene's own low chips keep from a control beside them. */
export const NAV_CHIP_GAP_PX = 12;
/** A mouse-only desktop draws both controls this much smaller (the thumb's travel is the same px). */
export const NAV_MOUSE_SCALE = 0.85;
