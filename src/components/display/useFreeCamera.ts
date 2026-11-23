/**
 * NAV-1A, the Free camera: the live pose and the gestures that move it (rulings S2, S6, S8; spec 2.1, 2.2, 6).
 * The pose lives in a ref, not in Preact state: while a finger moves it, each animation frame writes the scene root's
 * transform and data-camera directly (the viewport keeps its perspective and never a translate), and the scene renders
 * only when the cull must change (stickyWhole) or a gesture ends. One finger drags MOVE the eye (truck and pedestal);
 * a mouse held still LOOK_HOLD_MS first, or a right or Shift+left mouse drag, LOOKs (NAVLOOK 1a: a finger's hold no longer
 * does; the hat's eye is touch's Look) (yaw and pitch through the realism cone,
 * eased back to its soft limit when let go). A still release is a tap, as today. NAV-2A: the stored swipe mode (the
 * old path's) has no say here. NAV-LOOKDRIVE: the hat can drive a Look too, by rate (lookStart, lookAim, lookStop): the
 * thumb's offset is an angular speed, through the same cone; and nothing begun while a look eases back makes the view jump.
 */
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { cssSceneTransform, type Camera, type Vec3 } from './caseCamera';
import { DEPTH_STOP_MM, aheadMm, depthSpeed, dollyStep } from './caseDepth';
import { capSpanMm, frameSpanMm, yawCapRad, type Box, type RoomSpan } from './caseFraming';
import { DRAWN_CABINETS_LIMIT, stickyWhole, type CullView } from './caseCull';
import {
  DRAG_WALK_GAIN_X,
  DRAG_WALK_GAIN_Y,
  JOG_MAX_STEP_MS,
  LOOK_REBASE_MS,
  LOOK_TICK_BACK,
  SPRING_MS,
  anchorDepth,
  axisGate,
  budgetCone,
  coneIn,
  jogStep,
  lookRaw,
  lookStep,
  lookWind,
  poseOf,
  springBack,
  turn,
  turnBy,
  turnInside,
  turnRaw,
  walk,
  withPose,
  yawLimits,
  type Pose,
  type YawCone,
  type YawSide,
} from './casePose';
import { SCENE_CEILING_VIEWPORTS, fitsCeiling, projector, type BudgetScene, type Projector, type SceneCost } from './caseBudget';
import type { WallLayout } from './packCabinets';
import type { Point } from './caseZoom';
import { hapticLight } from '../../utils/haptics';

/** What the scene stands now, for the gestures: refreshed every render. */
export interface FreeScene {
  /** The view's framing camera: its lens and frame, and the pose while none is held. */
  readonly base: Camera;
  /** The px per mm the scene's DOM is drawn at (texelScale): the root's transform is written at it. */
  readonly s: number;
  readonly wall: WallLayout;
  readonly fronts: RoomSpan;
  /** The cabinets (wall indexes) the last render drew: a move re-culls once the frame shows a front not among them. */
  readonly drawn: readonly number[];
  /** Every cabinet's box (cabinetBox, its headroom included) and where the eye may be (eyeSpace). */
  readonly boxes: readonly Box[];
  readonly space: Box;
  readonly zBack: number;
  /** NAV-DEPTH-OCCL: the room's corners (everything drawn stands among them): the root's transform puts the CSS z = 0 plane past them. */
  readonly reach: readonly Vec3[];
  readonly lookHoldMs: number;
  /** NAV-2B: the jog's top speed, in the 10-28 jog's (?jogmax=, JOG_MAX_X). */
  readonly jogMax: number;
  /** NAV-LOOKDRIVE: the hat's Look top speed, in LOOK_DEG_PER_S (LOOK_MAX_X when absent). */
  readonly lookMax?: number;
  readonly reducedMotion: boolean;
  /** What a look's projected scene is worked out from (NAV-1A b): a look stops where it would pass the ceiling. */
  readonly budget: BudgetScene;
}

/** The DOM the writer writes to. */
export interface FreeDom {
  readonly host: { current: HTMLElement | null };
  readonly root: { current: HTMLElement | null };
  /** The 28 px ring shown under a finger that has armed Look (rulings S6). */
  readonly ring: { current: HTMLElement | null };
}

/** What a press is: its pointer, where (client px), its button and whether Shift was held. */
export interface FreePress {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button?: number;
  readonly shiftKey?: boolean;
  /** 'touch': a finger, whose still hold arms no Look (NAVLOOK 1a: on touch the hat's eye is Look). */
  readonly pointerType?: string;
}

interface Gesture {
  readonly id: number;
  /** Where the press began, in the frame's px. */
  readonly at0: Point;
  readonly lookAtOnce: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  armed: boolean;
  mode: 'move' | 'look' | null;
  start: Pose;
  /** The pose held when the press began (null: the framing's): what a cancelled gesture goes back to. */
  heldBefore: Pose | null;
  committed: Pose;
  shown: Pose;
  last: Point;
  anchor: number;
  unlocked: boolean;
  limits: YawCone;
  crossed: boolean;
  /** The longest stretch of the fronts a MOVE may make the frame show (the Classic cap). */
  span: number;
  /** NAV-1A (b): the cone worked out while the armed finger was still, from this start at this scene. */
  cone?: { start: Pose; scene: FreeScene; limits: YawCone };
  /** NAV-LOOKDRIVE: a look let go was easing back when the press began: the drag starts from where it rests, not where the press saw it. */
  readonly eased: boolean;
  /** NAV-LOOKDRIVE: a Look that took over that ease mid-way: the turn (turnRaw) that shows where it had got, added to the finger's. */
  over?: { dYaw: number; dPitch: number };
}

/**
 * NAV-LOOKDRIVE: the hat in Look mode: the thumb's offset and its last frame's time; the cone (limits) and the pose it
 * was worked out from (start: the committed pose, at the place the eye is at now); the turn asked for from that start
 * (dYaw, dPitch: integrated from the thumb, lookWind); whether the soft limit's tick has been given for this crossing;
 * and, while the depth moves the eye, when the cone was last worked out and whether the eye has moved since.
 */
interface Look {
  aim: Point;
  last: number | undefined;
  start: Pose;
  limits: YawCone;
  dYaw: number;
  dPitch: number;
  crossed: boolean;
  coneAt: number;
  stale: boolean;
}

/** NAV-JOG: the hat (the bottom-centre button's jog) running: the thumb's offset, its last frame's time, and a MOVE's depth and cap. */
interface Hat {
  aim: Point;
  last: number | undefined;
  /** The depth the frame centre looks at (anchorDepth): from the hat's start, and again wherever the depth moves the eye. */
  anchor: number;
  readonly span: number;
}

/**
 * NAV-DEPTH-2: the depth drive running: the rocker's reach, its last frame's time, the Classic cap, the cost the last
 * dolly handed back (v0) with the scene and pose it is the cost at, the projector for that scene, and where a dolly
 * pushed against a limit held the eye still (the scene, the pose and the way it was pushed: nothing to ask again while
 * they stand).
 */
interface Depth {
  r: number;
  last: number | undefined;
  readonly span: number;
  v0: number | undefined;
  at: { readonly scene: FreeScene; readonly pose: Pose } | null;
  project: { readonly scene: FreeScene; readonly fn: Projector } | null;
  stuck: Stuck | null;
}

/**
 * NAV-DEPTH-2: a dolly that asked for DEPTH_STOP_MM or more and was held still: at this scene, place, reach and px per
 * mm (unturned), at each of these frame lengths (as dollyStep caps them). dollyStep is a pure function of exactly these
 * and the cost it was handed (here the true cost at the place, as the hold handed back), so a frame that matches them
 * all would hold the eye there again: it is not asked.
 */
interface Stuck {
  readonly scene: FreeScene;
  readonly pose: Pose;
  readonly r: number;
  readonly unturned: Pose | null;
  readonly dts: number[];
}

/** The most frame lengths a hold keeps (a display's frames come in a few: 16.6 and 16.7 ms at 60 Hz). */
const STUCK_DTS = 4;

const samePose = (a: Pose, b: Pose) => a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pitch === b.pitch;

/**
 * NAV-DEPTH-2: the drives of one pose, the hat and the depth, either or both held at once: each frame the hat walks it
 * (hat) or turns it (look: NAV-LOOKDRIVE, the same thumb in Look mode, never both), then the depth dollies it. `pose` is
 * the committed pose (never past a soft limit); `shown` the one drawn: a Look's rubber band, or a look let go still
 * easing back under the drive.
 */
interface Drives {
  pose: Pose;
  shown: Pose;
  hat: Hat | null;
  look: Look | null;
  depth: Depth | null;
}

const num = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** The data-camera a Free camera publishes: today's fields and its yaw. */
export function cameraData(camera: Camera): string {
  return JSON.stringify({
    x: num(camera.x),
    y: num(camera.y),
    z: num(camera.z),
    yaw: num(camera.yaw ?? 0),
    pitch: num(camera.pitch),
    focalPx: num(camera.focalPx),
    width: camera.frame.width,
    height: camera.frame.height,
  });
}

/** Rulings S8: the yaw limits at this camera's frame and lens, the Classic cap (yawCapRad at its eye) included. */
export function coneOf(camera: Camera, wall: WallLayout, fronts: RoomSpan): { soft: number; hard: number } {
  return yawLimits(2 * Math.atan(camera.frame.width / 2 / camera.focalPx), yawCapRad(camera, wall, fronts));
}

const DEG_PER_RAD = 180 / Math.PI;

/** A MOVE's Classic cap from this camera: the longest stretch of the fronts it may make the frame show (Infinity: none). */
function spanOf(s: FreeScene, camera: Camera): number {
  const limit = capSpanMm(s.wall, DRAWN_CABINETS_LIMIT);
  return limit === Infinity ? Infinity : Math.max(limit, frameSpanMm(camera, s.fronts));
}

/** Where a MOVE from `pose` may stand the eye under that cap (undefined: anywhere). */
function capOf(s: FreeScene, pose: Pose, span: number): ((p: readonly number[]) => boolean) | undefined {
  return span === Infinity ? undefined : (p) => frameSpanMm(withPose(s.base, { ...pose, x: p[0], y: p[1], z: p[2] }), s.fronts) <= span;
}

/**
 * NAV-JOG: where a jog from `pose` may stand the eye: within the Classic cap (capOf), and no farther past the wall's ends
 * than it is. Inside them, no farther than an end: there the frame centre is on the wall's end, so half the frame still
 * shows the wall (a held jog never walks off into the empty room; a swipe still may, and the jog brings it back).
 */
function jogOk(s: FreeScene, pose: Pose, span: number): (p: readonly number[]) => boolean {
  const cap = capOf(s, pose, span);
  const past = (x: number) => Math.max(0, s.wall.leftMm - x, x - s.wall.rightMm);
  const limit = past(pose.x);
  return (p) => past(p[0]) <= limit && (cap === undefined || cap(p));
}

/** NAV-JOG: the depth a hat at `pose` walks at: where the frame centre looks (anchorDepth over the wall). */
function hatAnchor(s: FreeScene, pose: Pose): number {
  const camera = withPose(s.base, pose);
  return anchorDepth(camera, camera.frame.width / 2, camera.frame.height / 2, { x0: s.wall.leftMm, x1: s.wall.rightMm }, s.zBack);
}

const samePlace = (a: Pose, b: Pose) => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * NAV-1A (a+b), Ross 10-28: a look's yaw cone, from `start` at this scene: the realism cone (coneOf) kept to the GPU
 * budget (budgetCone over the scene projected at each yaw asked, fitsCeiling). Every yaw is projected at the px per mm
 * the scene would draw it at (a): held from where the turn left yaw 0, this start where it is unturned, else `unturned`.
 * `publish` hears what was projected, nothing more worked out for it: the start's cost (where it was asked); each way the
 * hard limit's (where the search got that far) and the last yaw that fits where (b) engaged; every yaw asked with its
 * cost, in the order asked; and how long the cone took.
 */
export function lookCone(scene: FreeScene, start: Pose, unturned: Pose | null, publish: (budget: string) => void, project: Projector = projector(scene.budget)): YawCone {
  const t0 = performance.now();
  const camera = withPose(scene.base, start);
  const realism = coneOf(camera, scene.wall, scene.fronts);
  const from = start.yaw ? unturned : start;
  const held = from === null ? undefined : withPose(scene.base, from);
  const seen = new Map<number, { vp: number; cost: SceneCost }>();
  const at = (yaw: number) => {
    let p = seen.get(yaw);
    if (p === undefined) {
      p = project(withPose(scene.base, { ...start, yaw }), held);
      seen.set(yaw, p);
    }
    return p;
  };
  const cone = budgetCone(realism, start.yaw, (yaw) => fitsCeiling(at(yaw).vp));
  const ms = num(performance.now() - t0);
  const deg = (r: number) => num(r * DEG_PER_RAD);
  const shown = (yaw: number) => {
    const { vp, cost } = seen.get(yaw)!;
    const px = { figures: num(cost.figures), shadows: num(cost.shadows), mesh: num(cost.mesh), room: num(cost.room), faces: num(cost.faces) };
    return { vp: num(vp), drawn: cost.drawn.length, figures: cost.figuresDrawn, px };
  };
  const side = (sign: 1 | -1, fit: YawSide | undefined) => {
    const hard = sign * realism.hard;
    return { hard: deg(realism.hard), fit: fit ? deg(fit.hard) : null, atHard: seen.has(hard) ? shown(hard) : null };
  };
  const begun = seen.has(start.yaw) ? { yaw: deg(start.yaw), ...shown(start.yaw) } : null;
  const asked = Array.from(seen, ([yaw, p]) => [deg(yaw), num(p.vp)]);
  publish(JSON.stringify({ ceiling: SCENE_CEILING_VIEWPORTS, start: begun, left: side(-1, cone.left), right: side(1, cone.right), asked, ms }));
  return cone;
}

export function useFreeCamera(scene: { current: FreeScene }, dom: FreeDom, culled: { current: CullView | null }, onRender: () => void) {
  /** The pose held between gestures; null: the framing's (re-based on a new view, wall pattern or filter, and by the arrows). */
  const held = useRef<Pose | null>(null);
  /** NAV-1A (a): where the turn left yaw 0 (the start of the look that left it); turned, the scene's px per mm is held from it. */
  const unturned = useRef<Pose | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** NAV-JOG, NAV-DEPTH-2: the hat (the bottom-centre button's jog) and the depth rocker, while either is held. */
  const drives = useRef<Drives | null>(null);
  /** NAV-DEPTH-2: drives a blur or a hidden page stopped before their lift: where they held the eye, for that lift. */
  const halted = useRef<{ readonly pose: Pose; readonly hat: boolean; readonly depth: boolean } | null>(null);
  /** A look let go past its soft limit easing back (spec 1.5) over SPRING_MS from t0, the lift (a late first frame catches up). */
  const spring = useRef<{ from: Pose; to: Pose; t0: number } | null>(null);
  const raf = useRef<number | undefined>(undefined);

  const cameraOf = (pose: Pose | null): Camera => (pose === null ? scene.current.base : withPose(scene.current.base, pose));
  /** `pose` aimed where the spring has it now: a look let go easing back (the pose itself when none runs). */
  const eased = (pose: Pose, now?: number): Pose => {
    const sp = spring.current;
    if (!sp) return pose;
    const t = (now ?? performance.now()) - sp.t0;
    return { ...pose, yaw: springBack(sp.from.yaw, sp.to.yaw, t), pitch: springBack(sp.from.pitch, sp.to.pitch, t) };
  };
  /**
   * The pose drawn now: a gesture's shown pose (NAV-LOOKDRIVE: a MOVE's with a look still easing back under it), the
   * drives', the spring's, or the held one (null: the framing's).
   */
  const drawn = (now?: number): Pose | null => {
    const g = gesture.current;
    if (g?.mode) return g.mode === 'move' ? eased(g.shown, now) : g.shown;
    if (drives.current) return drives.current.shown;
    const sp = spring.current;
    if (sp) return eased(sp.to, now);
    return held.current;
  };

  /** Write the camera to the DOM: the root's transform, data-camera; ask for a render when the cull must change. */
  const write = (camera: Camera) => {
    const { host, root } = dom;
    if (!host.current || !root.current) return;
    root.current.style.transform = cssSceneTransform(camera, scene.current.s, scene.current.reach);
    host.current.dataset.camera = cameraData(camera);
    host.current.dataset.cameraX = String(num(camera.x));
    const next: CullView = { camera, panPx: 0 };
    if (stickyWhole(culled.current, next, scene.current.wall, scene.current.drawn) !== culled.current) onRender();
  };

  /**
   * NAV-DEPTH-2: the depth drive's frame from `pose` (where the hat left it this frame): dollyStep through the jog's
   * rules (the room, the furniture, jogOk) and the scene's budget, projected at the camera the scene renders with (the
   * framing's lens and frame at the pose, its px per mm held from where the turn left yaw 0: freeTexelScale's). The cost
   * the last dolly handed back is trusted only at the same scene (a render, a resize or a new budget is a new scene)
   * and the same pose (the hat has not moved the eye since, nor its Look turned it). A dolly that held the eye still (against the budget, the
   * cap, a wall's end or the room: Stuck) is not asked again for a frame with all the same inputs: it would hold it there
   * again, and at the ceiling that costs three projections a frame. Any other frame (a longer or shorter one included)
   * asks it.
   */
  const depthFrame = (s: FreeScene, d: Depth, pose: Pose, dtMs: number): Pose => {
    const dt = Math.min(dtMs, JOG_MAX_STEP_MS);
    const st = d.stuck;
    const same = st !== null && st.scene === s && Object.is(st.r, d.r) && st.unturned === unturned.current && samePose(st.pose, pose);
    if (same && st.dts.includes(dt)) return pose;
    if (d.project?.scene !== s) d.project = { scene: s, fn: projector(s.budget) };
    const project = d.project.fn;
    const held = unturned.current === null ? undefined : withPose(s.base, unturned.current);
    const vp = (p: Vec3) => project(withPose(s.base, { ...pose, x: p[0], y: p[1], z: p[2] }), held).vp;
    // NAV-LOOKDRIVE: the same pose, its aim too: the cost is another once the hat's Look has turned the eye
    const v0 = d.at !== null && d.at.scene === s && samePose(d.at.pose, pose) ? d.v0 : undefined;
    const step = dollyStep(pose, d.r, dtMs, { space: s.space, boxes: s.boxes, ok: jogOk(s, pose, d.span), vp }, v0);
    d.v0 = step.vp;
    d.at = { scene: s, pose: step.pose };
    // held: it asked for a millimetre or more (as dollyStep works it out) and the eye stayed
    if (!samePlace(step.pose, pose) || !(dt > 0)) d.stuck = null;
    else {
      const ahead = aheadMm(pose, s.space, s.boxes);
      const asked = Math.abs(depthSpeed(d.r, d.r < 0 ? Math.min(ahead, aheadMm(pose, s.space, s.boxes, -1)) : ahead) * dt) / 1000;
      if (!(asked >= DEPTH_STOP_MM)) d.stuck = null;
      else if (same) {
        if (st.dts.length === STUCK_DTS) st.dts.shift();
        st.dts.push(dt);
      } else d.stuck = { scene: s, pose, r: d.r, unturned: unturned.current, dts: [dt] };
    }
    return step.pose;
  };

  const loop = (now: number) => {
    raf.current = undefined;
    const d = drives.current;
    if (d) {
      const s = scene.current;
      let pose = d.pose;
      const hat = d.hat;
      // NAV-JOG: a MOVE each frame by the time since the last (jogStep), as a swipe's: slid along the room and the
      // furniture, within the Classic cap and the wall's ends (jogOk)
      if (hat) {
        if (hat.last !== undefined) {
          const step = jogStep(hat.aim.x, hat.aim.y, now - hat.last, s.base.frame.width, s.jogMax);
          if (step.x !== 0 || step.y !== 0) {
            const ok = jogOk(s, pose, hat.span);
            let next = walk(pose, -step.x, -step.y, hat.anchor, s.base.focalPx, s.space, s.boxes, ok);
            // at a wall's end a diagonal keeps its rise
            if (samePlace(next, pose) && step.x !== 0 && step.y !== 0) next = walk(pose, 0, -step.y, hat.anchor, s.base.focalPx, s.space, s.boxes, ok);
            if (!samePlace(next, pose)) pose = next;
          }
        }
        hat.last = now;
      }
      // NAV-LOOKDRIVE: or the hat in Look mode turns it: the thumb's rate added to the turn asked for (lookStep, never
      // wound up past the hard limit: lookWind), then through the cone a scene Look goes through (turnBy)
      const look = d.look;
      let shown: Pose | null = null;
      if (look) {
        if (look.last !== undefined) {
          const step = lookStep(look.aim.x, look.aim.y, now - look.last, s.lookMax);
          if (step.yaw !== 0 || step.pitch !== 0) Object.assign(look, lookWind(look.start, look.dYaw, look.dPitch, step, look.limits));
        }
        look.last = now;
        const t = lookTurn(look);
        pose = t.committed;
        shown = t.shown;
      }
      // NAV-DEPTH-2: then the depth, from where the hat left the eye; moved, the hat walks at the depth it is at now
      const depth = d.depth;
      let moved = false;
      if (depth) {
        if (depth.last !== undefined) {
          const next = depthFrame(s, depth, pose, now - depth.last);
          moved = !samePlace(next, pose);
          if (hat && moved) hat.anchor = hatAnchor(s, next);
          pose = next;
        }
        depth.last = now;
      }
      if (look) {
        // NAV-LOOKDRIVE: the depth moved the eye under the Look: its cone stands at the place it was worked out at. It
        // is worked out again from where the eye is (as the hat's anchor is), the view drawn kept as it is: at most
        // every LOOK_REBASE_MS while the eye moves (a cone is a dozen projections or more), and once it rests. Every
        // frame between, the cone is kept inside the realism cone of where the eye is (coneOf: the Classic cap, no
        // projection), so a cap that closes in never leaves the view standing past it till the next working-out
        if (moved) {
          look.start = { ...look.start, x: pose.x, y: pose.y, z: pose.z };
          look.stale = true;
          shown = { ...(shown as Pose), x: pose.x, y: pose.y, z: pose.z };
        }
        if (look.stale && (!moved || now - look.coneAt >= LOOK_REBASE_MS)) {
          rebase(s, look, pose, shown as Pose, now);
          const t = lookTurn(look);
          pose = t.committed;
          shown = t.shown;
        } else if (moved) {
          const within = coneIn(look.limits, coneOf(withPose(s.base, pose), s.wall, s.fronts));
          if (within !== look.limits) {
            keep(look, pose, shown as Pose, within, false);
            const t = lookTurn(look);
            pose = t.committed;
            shown = t.shown;
          }
        }
      } else if (spring.current) {
        // NAV-LOOKDRIVE: a look let go still easing back when the drive began goes on easing under it: no jump
        if (now - spring.current.t0 >= SPRING_MS) spring.current = null;
        else shown = eased(pose, now);
      }
      // the pose written once a frame, only when what is drawn changed: where the eye is or where it aims
      const draw = shown ?? pose;
      d.pose = pose;
      if (!samePose(draw, d.shown)) {
        d.shown = draw;
        write(cameraOf(draw));
      }
      raf.current = requestAnimationFrame(loop);
      return;
    }
    const sp = spring.current;
    if (sp && now - sp.t0 >= SPRING_MS) {
      spring.current = null;
      // (NAV-LOOKDRIVE: under a MOVE still held, the ease is over and the drag goes on)
      if (!gesture.current?.mode) {
        write(cameraOf(held.current));
        onRender();
        return;
      }
    }
    write(cameraOf(drawn(now)));
    if (spring.current) raf.current = requestAnimationFrame(loop);
  };
  /** NAV-LOOKDRIVE: the hat's Look through its cone, with the soft limit's tick: one a crossing, armed again LOOK_TICK_BACK inside. */
  const lookTurn = (look: Look) => {
    const t = turnBy(look.start, look.dYaw, look.dPitch, look.limits);
    if (t.past) {
      if (!look.crossed) {
        look.crossed = true;
        hapticLight();
      }
    } else if (look.crossed && turnInside(look.start, look.dYaw, look.dPitch, look.limits, LOOK_TICK_BACK)) look.crossed = false;
    return t;
  };
  /**
   * NAV-LOOKDRIVE: the Look goes on from the committed pose `at` through `limits`, the turn asked for the one that shows
   * `shown` there, never past a hard limit (lookRaw: a cone that closed in on the view leaves nothing wound up, and
   * brings it in by no more than it closed). `taken`: a drawn view taken over (lookStart), drawn in this very cone.
   */
  const keep = (look: Look, at: Pose, shown: Pose, limits: YawCone, taken: boolean) => {
    const was = taken ? { start: at, limits } : { start: look.start, limits: look.limits };
    look.start = at;
    look.limits = limits;
    Object.assign(look, lookRaw(at, shown.yaw, shown.pitch, limits, was));
  };
  /** NAV-LOOKDRIVE: the Look's cone worked out from the committed pose `at` (keep). `taken`: a drawn view taken over (lookStart). */
  const rebase = (s: FreeScene, look: Look, at: Pose, shown: Pose, now: number, taken = false) => {
    keep(look, at, shown, coneFrom(s, at), taken);
    look.coneAt = now;
    look.stale = false;
  };
  const schedule = () => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(loop);
  };
  /**
   * NAV-LOOKDRIVE: the hat's Look stops: a turn shown past its soft limit eases back to it (spec 1.5) as a scene look
   * let go does, at once under reduced motion.
   */
  const dropLook = (d: Drives) => {
    if (!d.look) return;
    d.look = null;
    const off = d.shown.yaw !== d.pose.yaw || d.shown.pitch !== d.pose.pitch;
    if (off && !scene.current.reducedMotion) spring.current = { from: d.shown, to: d.pose, t0: performance.now() };
  };
  /**
   * NAV-DEPTH-2: the last drive stops: the eye stays where the drives got it, held. Returns that pose. NAV-LOOKDRIVE: a
   * look still easing back (the hat's, let go past its soft limit, or one the drive began under) goes on to its rest there.
   */
  const endDrives = (d: Drives): Pose => {
    drives.current = null;
    // a running drive always has its next frame asked for (beginDrives, the loop)
    cancelAnimationFrame(raf.current!);
    raf.current = undefined;
    setGesture(null);
    dropLook(d);
    held.current = d.pose;
    const sp = spring.current;
    if (sp) {
      spring.current = { ...sp, to: d.pose };
      write(cameraOf(drawn()));
      schedule();
    } else write(cameraOf(d.pose));
    onRender();
    return d.pose;
  };
  useEffect(() => {
    // NAV-DEPTH-2: the window losing focus or the page hidden stops every drive where it is (its lift may never come);
    // the lift that does come first returns where it held the eye (haltedStop), as a lift returns where it got
    const halt = () => {
      const d = drives.current;
      if (!d) return;
      const hat = d.hat !== null || d.look !== null;
      halted.current = { pose: endDrives(d), hat, depth: d.depth !== null };
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') halt();
    };
    window.addEventListener('blur', halt);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', halt);
      document.removeEventListener('visibilitychange', hidden);
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
      drives.current = null;
      // gone, the scene has no focus left to set from a halt
      halted.current = null;
      const g = gesture.current;
      if (g?.timer !== undefined) clearTimeout(g.timer);
    };
  }, []);

  /** NAV-1A (a+b): a look's cone from `start`, held from where it leaves yaw 0 (a drag comes from a pointer on the host). */
  const coneFrom = (s: FreeScene, start: Pose): YawCone => {
    if (!start.yaw) unturned.current = start;
    return lookCone(s, start, unturned.current, (budget) => (dom.host.current!.dataset.yawBudget = budget));
  };

  const dropRing = () => {
    if (dom.ring.current) delete dom.ring.current.dataset.on;
  };
  const showRing = (at: Point) => {
    const el = dom.ring.current;
    if (!el) return;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    el.dataset.on = '';
  };
  const setGesture = (mode: 'move' | 'look' | 'jog' | 'jog-look' | 'depth' | null) => {
    const host = dom.host.current;
    if (!host) return;
    if (mode === null) delete host.dataset.gesture;
    else host.dataset.gesture = mode;
  };

  /** A press on the scene (not on a control, not zoomed, not a pinch): a mouse's arms Look if it stays still LOOK_HOLD_MS. */
  const press = useCallback((e: FreePress, at: Point) => {
    // NAV-JOG, NAV-DEPTH-2: while a drive moves the eye, a finger on the scene is no gesture of its own
    if (drives.current) return;
    const prev = gesture.current;
    if (prev?.timer !== undefined) clearTimeout(prev.timer);
    const s = scene.current;
    const lookAtOnce = e.button === 2 || (e.button === 0 && e.shiftKey === true);
    const start = drawn() ?? poseOf(s.base);
    const g: Gesture = {
      id: e.pointerId,
      at0: at,
      lookAtOnce,
      timer: undefined,
      armed: false,
      mode: null,
      start,
      heldBefore: held.current,
      committed: start,
      shown: start,
      last: at,
      anchor: 0,
      unlocked: false,
      limits: { soft: 0, hard: 0 },
      crossed: false,
      span: Infinity,
      eased: spring.current !== null,
    };
    // NAVLOOK 1a (Ross 11-17): a finger's still hold no longer arms Look (the hat's eye is touch's Look); a mouse's still does
    if (!lookAtOnce && e.pointerType !== 'touch') {
      g.timer = setTimeout(() => {
        g.timer = undefined;
        if (gesture.current !== g || g.mode !== null) return;
        g.armed = true;
        showRing(at);
        setGesture('look');
        // NAV-1A (b): the cone is worked out while the finger is still, once the ring has painted, so the turn's first
        // frame waits on none of it (a turn that starts sooner works it out then)
        requestAnimationFrame(() => {
          if (gesture.current !== g || g.mode !== null) return;
          // (a drag, a lift or a new press clears it first)
          g.timer = setTimeout(() => {
            g.timer = undefined;
            const start = spring.current?.to ?? g.start;
            g.cone = { start, scene: scene.current, limits: coneFrom(scene.current, start) };
          }, 0);
        });
      }, s.lookHoldMs);
    }
    gesture.current = g;
  }, []);

  /** The finger has moved past the tap slop (the scene's axis lock picked `axis`): the drag MOVEs or LOOKs, from the press. */
  const drag = useCallback((pointerId: number, at: Point, axis: 'x' | 'y') => {
    const g = gesture.current;
    if (!g || g.id !== pointerId) return;
    const s = scene.current;
    if (g.mode === null) {
      if (g.timer !== undefined) clearTimeout(g.timer);
      g.timer = undefined;
      const looks = g.armed || g.lookAtOnce;
      // NAV-LOOKDRIVE: a look let go still easing back: the drag starts from where it rests, the view from where it is
      // drawn (no jump). A Look takes the ease over (the turn that shows it, added to the finger's); under a MOVE it
      // goes on to its rest. One that came to rest since the press: from there (the press saw it mid-ease)
      const easing = spring.current;
      const mid = easing && looks ? drawn() : null;
      if (easing) {
        g.start = easing.to;
        if (looks) spring.current = null;
      } else if (g.eased) g.start = held.current ?? poseOf(s.base);
      g.committed = g.start;
      g.shown = g.start;
      const camera = cameraOf(g.start);
      if (looks) {
        g.mode = 'look';
        const ready = g.cone !== undefined && g.cone.start === g.start && g.cone.scene === s ? g.cone.limits : null;
        g.limits = ready ?? coneFrom(s, g.start);
        if (mid) {
          g.over = turnRaw(g.start, mid.yaw, mid.pitch, g.limits);
          // still past the soft limit: this crossing's tick was the look's before
          g.crossed = turnBy(g.start, g.over.dYaw, g.over.dPitch, g.limits).past;
        }
        // rulings S6: the haptic is the first Look move's, never the arming's
        hapticLight();
      } else {
        g.mode = 'move';
        g.anchor = anchorDepth(camera, g.at0.x, g.at0.y, { x0: s.wall.leftMm, x1: s.wall.rightMm }, s.zBack);
        g.span = spanOf(s, camera);
      }
      setGesture(g.mode);
    }
    const base = s.base;
    if (g.mode === 'look') {
      const f = base.focalPx;
      const bearing = (p: Point) => [(p.x - base.frame.width / 2) / f, (base.frame.height / 2 - p.y) / f] as const;
      const [a0, b0] = bearing(g.at0);
      const [a1, b1] = bearing(at);
      const t = g.over
        ? turnBy(g.start, g.over.dYaw + (Math.atan(a0) - Math.atan(a1)), g.over.dPitch + (Math.atan(b1) - Math.atan(b0)), g.limits)
        : turn(g.start, a0, b0, a1, b1, g.limits);
      g.committed = t.committed;
      g.shown = t.shown;
      if (t.past && !g.crossed) {
        g.crossed = true;
        hapticLight();
      }
    } else {
      const gate = axisGate(axis, g.unlocked, at.x - g.at0.x, at.y - g.at0.y);
      g.unlocked = gate.unlocked;
      const ddx = gate.x ? at.x - g.last.x : 0;
      const ddy = gate.y ? at.y - g.last.y : 0;
      g.committed = walk(g.committed, ddx * DRAG_WALK_GAIN_X, ddy * DRAG_WALK_GAIN_Y, g.anchor, base.focalPx, s.space, s.boxes, capOf(s, g.committed, g.span));
      g.shown = g.committed;
    }
    g.last = at;
    schedule();
  }, []);

  /**
   * The finger lifts (commit) or the gesture is cancelled (a pointercancel, a second finger: nothing committed). Returns
   * the pose a drag left (exactly the last live one: no settle), or null when the press never became a drag.
   */
  const release = useCallback((pointerId: number, commit: boolean): Pose | null => {
    const g = gesture.current;
    if (!g || g.id !== pointerId) return null;
    gesture.current = null;
    if (g.timer !== undefined) clearTimeout(g.timer);
    dropRing();
    setGesture(null);
    if (g.mode === null) return null;
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = undefined;
    if (!commit) {
      // (a look that was easing back under a MOVE is done: the eye goes back to where it was held)
      spring.current = null;
      held.current = g.heldBefore;
      write(cameraOf(g.heldBefore));
      onRender();
      return null;
    }
    held.current = g.committed;
    const off = g.shown.yaw !== g.committed.yaw || g.shown.pitch !== g.committed.pitch;
    const sp = spring.current;
    if (off && !scene.current.reducedMotion) {
      spring.current = { from: g.shown, to: g.committed, t0: performance.now() };
      write(cameraOf(g.shown));
      schedule();
    } else if (sp) {
      // NAV-LOOKDRIVE: a look still easing back under the MOVE goes on to its rest, where the drag left the eye
      spring.current = { ...sp, to: g.committed };
      write(cameraOf(drawn()));
      schedule();
    } else write(cameraOf(g.committed));
    onRender();
    return g.committed;
  }, []);

  /**
   * NAV-DEPTH-2: the drives running, or (none yet) begun from the pose held, a look easing back from where it rests,
   * with their first frame asked for.
   */
  /** NAV-DEPTH-2: a stop with no such drive running: where a halt held the eye, if it stopped this drive (once). */
  const haltedStop = (which: 'hat' | 'depth'): Pose | null => {
    const h = halted.current;
    if (h === null || !h[which]) return null;
    halted.current = null;
    // only while the eye still stands there (a halted Look easing back: where it rests): a swipe, a look, Reset view or
    // any pose held since set the focus their own way
    const now = spring.current?.to ?? drawn() ?? poseOf(scene.current.base);
    return samePose(now, h.pose) ? h.pose : null;
  };

  const beginDrives = (): Drives => {
    if (drives.current) return drives.current;
    const pose = held.current ?? poseOf(scene.current.base);
    // NAV-LOOKDRIVE: a look easing back goes on easing under the drive (the loop), drawn from where it is: no jump
    const d: Drives = { pose, shown: drawn() ?? pose, hat: null, look: null, depth: null };
    drives.current = d;
    // a halt before it is no lift's to return now: this drive's last stop returns where it gets
    halted.current = null;
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
    return d;
  };

  /**
   * NAV-JOG: a thumb has started the bottom-centre button's jog: from the pose held now (a look easing back goes on to
   * its rest under it; a depth drive running, from where it has got), at the depth the frame centre looks at. Refused
   * (false) while a finger is on the scene or the hat runs (a jog, or its Look).
   */
  const jogStart = useCallback((): boolean => {
    if (gesture.current !== null || drives.current?.hat || drives.current?.look) return false;
    const s = scene.current;
    const d = beginDrives();
    d.hat = { aim: { x: 0, y: 0 }, last: undefined, anchor: hatAnchor(s, d.pose), span: spanOf(s, cameraOf(d.pose)) };
    setGesture('jog');
    return true;
  }, []);

  /** NAV-JOG: the thumb's offset (px) from where it went down: the way the eye moves, and how fast (jogStep). */
  const jogAim = useCallback((dxPx: number, dyPx: number) => {
    const hat = drives.current?.hat;
    if (hat) hat.aim = { x: dxPx, y: dyPx };
  }, []);

  /**
   * NAV-JOG: the thumb lifts: the hat stops. The last drive stopping, the eye stays where they got it, held, and that
   * pose is returned; null while the depth still moves it (its stop returns it), or when no jog ran (after a halt, the
   * first lift returns where it held the eye: haltedStop).
   */
  const jogStop = useCallback((): Pose | null => {
    const d = drives.current;
    if (!d?.hat) return haltedStop('hat');
    d.hat = null;
    if (d.depth) {
      setGesture('depth');
      return null;
    }
    return endDrives(d);
  }, []);

  /**
   * NAV-LOOKDRIVE: the hat in Look mode: a thumb has started it. The eye turns at the rate the thumb holds (lookAim)
   * from the pose drawn now, through the cone a scene Look from there has (coneFrom); a look still easing back is taken
   * over where it is drawn. With the depth or alone. Refused (false) while a finger is on the scene or the hat runs.
   */
  const lookStart = useCallback((): boolean => {
    if (gesture.current !== null || drives.current?.hat || drives.current?.look) return false;
    const d = beginDrives();
    spring.current = null;
    const look: Look = { aim: { x: 0, y: 0 }, last: undefined, start: d.pose, limits: { soft: 0, hard: 0 }, dYaw: 0, dPitch: 0, crossed: false, coneAt: 0, stale: false };
    rebase(scene.current, look, d.pose, d.shown, performance.now(), true);
    // drawn past a soft limit already (the ease taken over): this crossing's tick was the look's before
    look.crossed = turnBy(look.start, look.dYaw, look.dPitch, look.limits).past;
    d.look = look;
    setGesture('jog-look');
    return true;
  }, []);

  /** NAV-LOOKDRIVE: the thumb's offset (px) from where it went down: the way the eye turns, and how fast (lookStep). */
  const lookAim = useCallback((dxPx: number, dyPx: number) => {
    const look = drives.current?.look;
    if (look) look.aim = { x: dxPx, y: dyPx };
  }, []);

  /**
   * NAV-LOOKDRIVE: the thumb lifts: the Look stops, and a turn shown past its soft limit eases back to it. As jogStop:
   * the last drive stopping, the committed pose is held and returned; null while the depth still moves the eye.
   */
  const lookStop = useCallback((): Pose | null => {
    const d = drives.current;
    if (!d?.look) return haltedStop('hat');
    if (d.depth) {
      dropLook(d);
      setGesture('depth');
      return null;
    }
    return endDrives(d);
  }, []);

  /**
   * NAV-DEPTH-2: the depth rocker leaves its centre at reach r in [-1, 1] (+ forward): the eye dollies along its
   * horizontal heading (dollyStep) from the pose drawn now, with the hat or alone. Refused (false) while a finger is on
   * the scene or a depth drive runs.
   */
  const depthStart = useCallback((r: number): boolean => {
    if (gesture.current !== null || drives.current?.depth) return false;
    const d = beginDrives();
    d.depth = { r, last: undefined, span: spanOf(scene.current, cameraOf(d.pose)), v0: undefined, at: null, project: null, stuck: null };
    if (!d.hat && !d.look) setGesture('depth');
    return true;
  }, []);

  /** NAV-DEPTH-2: the rocker's reach now (DEPTH_DEAD and under moves nothing). */
  const depthRate = useCallback((r: number) => {
    const depth = drives.current?.depth;
    if (depth) depth.r = r;
  }, []);

  /** NAV-DEPTH-2: the rocker springs back to its centre: as jogStop, for the depth (null while the hat still moves the eye). */
  const depthStop = useCallback((): Pose | null => {
    const d = drives.current;
    if (!d?.depth) return haltedStop('depth');
    d.depth = null;
    if (d.look) setGesture('jog-look');
    return d.hat || d.look ? null : endDrives(d);
  }, []);

  return {
    /** The camera drawn now (the framing's when no pose is held). */
    camera: (base: Camera): Camera => {
      const pose = drawn();
      return pose === null ? base : withPose(base, pose);
    },
    /** A gesture or a drive moves the pose, or a look let go eases back. */
    live: (): boolean => gesture.current?.mode != null || drives.current !== null || spring.current !== null,
    /** A pose held off the framing (null: the framing). */
    held: (): Pose | null => held.current,
    /** NAV-1A (a): the camera where the turn left yaw 0 (freeTexelScale holds a turned scene's px per mm from it). */
    unturned: (base: Camera): Camera | undefined => (unturned.current === null ? undefined : withPose(base, unturned.current)),
    /** Hold this pose (null: go back to the framing); any spring stops. */
    hold: (pose: Pose | null) => {
      spring.current = null;
      held.current = pose;
    },
    press,
    drag,
    release,
    jogStart,
    jogAim,
    jogStop,
    lookStart,
    lookAim,
    lookStop,
    depthStart,
    depthRate,
    depthStop,
    /** Write the drawn pose to the DOM again (after a render, which may have rewritten it). */
    sync: () => {
      const pose = drawn();
      if (pose !== null) write(cameraOf(pose));
    },
  };
}
