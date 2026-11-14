/**
 * NAV-1A, the Free camera: the live pose and the gestures that move it (rulings S2, S6, S8; spec 2.1, 2.2, 6).
 * The pose lives in a ref, not in Preact state: while a finger moves it, each animation frame writes the scene root's
 * transform and data-camera directly (the viewport keeps its perspective and never a translate), and the scene renders
 * only when the cull must change (stickyWhole) or a gesture ends. One finger drags MOVE the eye (truck and pedestal);
 * held still LOOK_HOLD_MS first, or a right or Shift+left mouse drag, they LOOK (yaw and pitch through the realism cone,
 * eased back to its soft limit when let go). A still release is a tap, as today. NAV-2A: the stored swipe mode (the
 * old path's) has no say here.
 */
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { cssSceneTransform, type Camera, type Vec3 } from './caseCamera';
import { DEPTH_STOP_MM, aheadMm, depthSpeed, dollyStep } from './caseDepth';
import { capSpanMm, frameSpanMm, focusEdgesPx, yawCapRad, type Box, type RoomSpan } from './caseFraming';
import { DRAWN_CABINETS_LIMIT, stickyWhole, type CullView } from './caseCull';
import { DRAG_WALK_GAIN_X, DRAG_WALK_GAIN_Y, JOG_MAX_STEP_MS, SPRING_MS, anchorDepth, axisGate, budgetCone, jogStep, poseOf, springBack, turn, walk, withPose, yawLimits, type Pose, type YawCone, type YawSide } from './casePose';
import { SCENE_CEILING_VIEWPORTS, fitsCeiling, projector, type BudgetScene, type Projector, type SceneCost } from './caseBudget';
import type { WallLayout, WallSlot } from './packCabinets';
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
  /** The one-cabinet view's focus cabinet, whose neighbours are dimmed; null in the other views. */
  readonly dimmed: WallSlot | null;
  readonly lookHoldMs: number;
  /** NAV-2B: the jog's top speed, in the 10-28 jog's (?jogmax=, JOG_MAX_X). */
  readonly jogMax: number;
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

/** NAV-DEPTH-2: the drives of one pose, either or both held at once: each frame the hat walks it, then the depth dollies it. */
interface Drives {
  pose: Pose;
  hat: Hat | null;
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
  /** The pose drawn now: a gesture's shown pose, the spring's, or the held one (null: the framing's). */
  const drawn = (now?: number): Pose | null => {
    const g = gesture.current;
    if (g?.mode) return g.shown;
    if (drives.current) return drives.current.pose;
    const sp = spring.current;
    if (sp) {
      const t = (now ?? performance.now()) - sp.t0;
      return { ...sp.to, yaw: springBack(sp.from.yaw, sp.to.yaw, t), pitch: springBack(sp.from.pitch, sp.to.pitch, t) };
    }
    return held.current;
  };

  /** Write the camera to the DOM: the root's transform, data-camera, the dimming veils; ask for a render when the cull must change. */
  const write = (camera: Camera) => {
    const { host, root } = dom;
    if (!host.current || !root.current) return;
    root.current.style.transform = cssSceneTransform(camera, scene.current.s);
    host.current.dataset.camera = cameraData(camera);
    host.current.dataset.cameraX = String(num(camera.x));
    const slot = scene.current.dimmed;
    if (slot) {
      const edges = focusEdgesPx(camera, slot);
      for (const veil of Array.from(host.current.querySelectorAll<HTMLElement>('.cabinet-scene__dim'))) {
        const left = veil.dataset.side === 'left';
        const x0 = -4;
        const x1 = camera.frame.width + 4;
        const [a, b] = left ? [x0, edges.left] : [edges.right, x1];
        veil.style.left = `${num(a)}px`;
        veil.style.width = `${num(Math.max(0, b - a))}px`;
      }
    }
    const next: CullView = { camera, panPx: 0 };
    if (stickyWhole(culled.current, next, scene.current.wall, scene.current.drawn) !== culled.current) onRender();
  };

  /**
   * NAV-DEPTH-2: the depth drive's frame from `pose` (where the hat left it this frame): dollyStep through the jog's
   * rules (the room, the furniture, jogOk) and the scene's budget, projected at the camera the scene renders with (the
   * framing's lens and frame at the pose, its px per mm held from where the turn left yaw 0: freeTexelScale's). The cost
   * the last dolly handed back is trusted only at the same scene (a render, a resize or a new budget is a new scene)
   * and the same place (the hat has not moved the eye since). A dolly that held the eye still (against the budget, the
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
    const v0 = d.at !== null && d.at.scene === s && samePlace(d.at.pose, pose) ? d.v0 : undefined;
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
      // NAV-DEPTH-2: then the depth, from where the hat left the eye; moved, the hat walks at the depth it is at now
      const depth = d.depth;
      if (depth) {
        if (depth.last !== undefined) {
          const next = depthFrame(s, depth, pose, now - depth.last);
          if (hat && !samePlace(next, pose)) hat.anchor = hatAnchor(s, next);
          pose = next;
        }
        depth.last = now;
      }
      // the pose written once a frame, only when it moved
      if (!samePlace(pose, d.pose)) {
        d.pose = pose;
        write(cameraOf(pose));
      }
      raf.current = requestAnimationFrame(loop);
      return;
    }
    const sp = spring.current;
    if (sp && !gesture.current?.mode && now - sp.t0 >= SPRING_MS) {
      spring.current = null;
      write(cameraOf(held.current));
      onRender();
      return;
    }
    write(cameraOf(drawn(now)));
    if (sp && !gesture.current?.mode) raf.current = requestAnimationFrame(loop);
  };
  const schedule = () => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(loop);
  };
  /** NAV-DEPTH-2: the last drive stops: the eye stays where the drives got it, held. Returns that pose. */
  const endDrives = (d: Drives): Pose => {
    drives.current = null;
    // a running drive always has its next frame asked for (beginDrives, the loop)
    cancelAnimationFrame(raf.current!);
    raf.current = undefined;
    setGesture(null);
    held.current = d.pose;
    write(cameraOf(d.pose));
    onRender();
    return d.pose;
  };
  useEffect(() => {
    // NAV-DEPTH-2: the window losing focus or the page hidden stops every drive where it is (its lift may never come);
    // the lift that does come first returns where it held the eye (haltedStop), as a lift returns where it got
    const halt = () => {
      const d = drives.current;
      if (d) halted.current = { pose: endDrives(d), hat: d.hat !== null, depth: d.depth !== null };
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
  const setGesture = (mode: 'move' | 'look' | 'jog' | 'depth' | null) => {
    const host = dom.host.current;
    if (!host) return;
    if (mode === null) delete host.dataset.gesture;
    else host.dataset.gesture = mode;
  };

  /** A finger down on the scene (not on a control, not zoomed, not a pinch): Look arms if it stays still LOOK_HOLD_MS. */
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
    };
    if (!lookAtOnce) {
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
      // a spring still easing back is done: the look starts from where it rests
      if (spring.current) {
        g.start = spring.current.to;
        spring.current = null;
      }
      g.committed = g.start;
      g.shown = g.start;
      const camera = cameraOf(g.start);
      if (g.armed || g.lookAtOnce) {
        g.mode = 'look';
        const ready = g.cone !== undefined && g.cone.start === g.start && g.cone.scene === s ? g.cone.limits : null;
        g.limits = ready ?? coneFrom(s, g.start);
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
      const t = turn(g.start, a0, b0, a1, b1, g.limits);
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
      held.current = g.heldBefore;
      write(cameraOf(g.heldBefore));
      onRender();
      return null;
    }
    held.current = g.committed;
    const off = g.shown.yaw !== g.committed.yaw || g.shown.pitch !== g.committed.pitch;
    if (off && !scene.current.reducedMotion) {
      spring.current = { from: g.shown, to: g.committed, t0: performance.now() };
      write(cameraOf(g.shown));
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
    // only while the eye still stands there: a swipe, a look, Reset view or any pose held since set the focus their own way
    const now = drawn() ?? poseOf(scene.current.base);
    return samePose(now, h.pose) ? h.pose : null;
  };

  const beginDrives = (): Drives => {
    if (drives.current) return drives.current;
    const easing = spring.current;
    spring.current = null;
    const d: Drives = { pose: held.current ?? poseOf(scene.current.base), hat: null, depth: null };
    drives.current = d;
    // a halt before it is no lift's to return now: this drive's last stop returns where it gets
    halted.current = null;
    // a look easing back is done: the drive starts from where it rests (held already)
    if (easing) write(cameraOf(d.pose));
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
    return d;
  };

  /**
   * NAV-JOG: a thumb has started the bottom-centre button's jog: from the pose drawn now (a look easing back, from where
   * it rests; a depth drive running, from where it has got), at the depth the frame centre looks at. Refused (false)
   * while a finger is on the scene or a jog runs.
   */
  const jogStart = useCallback((): boolean => {
    if (gesture.current !== null || drives.current?.hat) return false;
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
   * NAV-DEPTH-2: the depth rocker leaves its centre at reach r in [-1, 1] (+ forward): the eye dollies along its
   * horizontal heading (dollyStep) from the pose drawn now, with the hat or alone. Refused (false) while a finger is on
   * the scene or a depth drive runs.
   */
  const depthStart = useCallback((r: number): boolean => {
    if (gesture.current !== null || drives.current?.depth) return false;
    const d = beginDrives();
    d.depth = { r, last: undefined, span: spanOf(scene.current, cameraOf(d.pose)), v0: undefined, at: null, project: null, stuck: null };
    if (!d.hat) setGesture('depth');
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
    return d.hat ? null : endDrives(d);
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
