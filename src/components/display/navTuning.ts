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
export const NAV_OPACITY = { fill: 0.14, line: 0.25, knob: 0.55, active: 0.8 } as const;

/**
 * The hat's ring (CSS px across): compact, and wide once the case's SHORTER side is `wideFrom` px or more (not the width
 * alone: a wide but short scene keeps the compact ring). Its hit shape is the ring's circle.
 */
export const HAT_RING_PX = { compact: 104, wide: 120, wideFrom: 600 } as const;
/** The hat's knob (px across): at full reach (JOG_FULL_PX of thumb travel) its edge touches the ring's. */
export const HAT_KNOB_PX = 36;
/** Where on the ring the eye will sit (NAV-EYE), degrees anticlockwise from the right: its upper-left, inboard shoulder. */
export const EYE_SLOT_DEG = 135;
/** The eye's place kept free (px across). */
export const EYE_SLOT_PX = 32;

/** The Z rail (px): what is drawn, the larger box that takes the thumb, the knob, and how far the knob shows full reach. */
export const DEPTH_RAIL_PX = { width: 28, height: 92, hitWidth: 56, hitHeight: 132, knob: 24, travel: 34 } as const;

/**
 * NAV-LOGPOSE: the Log-Pose orb (px): what is drawn, the round target that takes the thumb, and the clear space between
 * that target and the Z rail's target below it (handoff: smaller than the sextant concepts, visibly detached). `clear`
 * is Chromium's touch adjustment reach: a touch is retargeted to a button within half its 32 DIP adjustment area, so
 * with less a push begun in the rail's top would go to the orb.
 */
export const ORB_PX = { size: 34, hit: 48, clear: 16 } as const;
/**
 * NAV-LOGPOSE (Ross's reference, ross-1122/logpose-orb.png): the orb's colours (HSL triples): its dark translucent dial,
 * the thin teal outer ring (quiet OFF, brighter with a soft glow ON) and the teal pivot, and the needle's muted red half
 * (never vivid, never gold) and its pale grey half.
 */
export const ORB_GLOBE = '200 30% 12%';
export const ORB_TEAL = '172 55% 50%';
export const ORB_RED = '355 45% 42%';
export const ORB_PALE = '205 15% 82%';
/**
 * NAV-LOGPOSE: the needle: where it rests (degrees clockwise from straight up: the reference's diagonal), degrees of
 * needle a degree of yaw, and px of lift a degree of pitch.
 */
export const ORB_NEEDLE = { restDeg: 45, turnPerDeg: 6, liftPxPerDeg: 0.375 } as const;

/** Each control's drawn edge, in from the safe area's side (px). */
export const NAV_EDGE_PX = 20;
/** Each control's drawn bottom, above the case's pull-up tabs (px). */
export const NAV_LIFT_PX = 16;
/** The gap (px) the scene's own low chips keep from a control beside them. */
export const NAV_CHIP_GAP_PX = 12;
/** A mouse-only desktop draws both controls this much smaller (the thumb's travel is the same px). */
export const NAV_MOUSE_SCALE = 0.85;
