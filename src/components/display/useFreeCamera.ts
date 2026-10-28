/**
 * NAV-1A, the Free camera (trial): the live pose and the gestures that move it (rulings S2, S6, S8; spec 2.1, 2.2, 6).
 * The pose lives in a ref, not in Preact state: while a finger moves it, each animation frame writes the scene root's
 * transform and data-camera directly (the viewport keeps its perspective and never a translate), and the scene renders
 * only when the cull must change (stickyPose) or a gesture ends. One finger drags MOVE the eye (truck and pedestal);
 * held still LOOK_HOLD_MS first, or with the header's Look around, a right or Shift+left mouse drag, they LOOK (yaw and
 * pitch through the realism cone, eased back to its soft limit when let go). A still release is a tap, as today.
 */
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { cssSceneTransform, type Camera } from './caseCamera';
import { capSpanMm, frameSpanMm, focusEdgesPx, yawCapRad, type Box, type RoomSpan } from './caseFraming';
import { DRAWN_CABINETS_LIMIT, stickyPose, type CullView } from './caseCull';
import { SPRING_MS, anchorDepth, axisGate, budgetCone, poseOf, springBack, turn, walk, withPose, yawLimits, type Pose, type YawCone, type YawSide } from './casePose';
import { SCENE_CEILING_VIEWPORTS, projector, type BudgetScene, type SceneCost } from './caseBudget';
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
  /** Every cabinet's box (cabinetBox, its headroom included) and where the eye may be (eyeSpace). */
  readonly boxes: readonly Box[];
  readonly space: Box;
  readonly zBack: number;
  /** The one-cabinet view's focus cabinet, whose neighbours are dimmed; null in the other views. */
  readonly dimmed: WallSlot | null;
  /** A drag in the header's Look around mode turns the eye at once. */
  readonly lookMode: boolean;
  readonly lookHoldMs: number;
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

/**
 * NAV-1A (a+b), Ross 10-28: a look's yaw cone, from `start` at this scene: the realism cone (coneOf) kept to the GPU
 * budget (budgetCone over the scene projected at each yaw asked, at the held px per mm). `publish` hears what was
 * projected, nothing more worked out for it: each way the hard limit's cost and the last yaw that fits where (b)
 * engaged; the start's where (b) asked it; and how long the cone took.
 */
export function lookCone(scene: FreeScene, start: Pose, publish: (budget: string) => void): YawCone {
  const t0 = performance.now();
  const camera = withPose(scene.base, start);
  const realism = coneOf(camera, scene.wall, scene.fronts);
  const project = projector(scene.budget);
  const seen = new Map<number, { vp: number; cost: SceneCost }>();
  const at = (yaw: number) => {
    let p = seen.get(yaw);
    if (p === undefined) {
      p = project(withPose(scene.base, { ...start, yaw }));
      seen.set(yaw, p);
    }
    return p;
  };
  const cone = budgetCone(realism, start.yaw, (yaw) => at(yaw).vp <= SCENE_CEILING_VIEWPORTS);
  const ms = num(performance.now() - t0);
  const deg = (r: number) => num(r * DEG_PER_RAD);
  const shown = (yaw: number) => {
    const { vp, cost } = at(yaw);
    const px = { figures: num(cost.figures), shadows: num(cost.shadows), mesh: num(cost.mesh), room: num(cost.room), faces: num(cost.faces) };
    return { vp: num(vp), drawn: cost.drawn.length, figures: cost.figuresDrawn, px };
  };
  const side = (sign: 1 | -1, fit: YawSide | undefined) => ({ hard: deg(realism.hard), ...shown(sign * realism.hard), fit: fit ? deg(fit.hard) : null });
  const begun = seen.has(start.yaw) ? { yaw: deg(start.yaw), ...shown(start.yaw) } : null;
  publish(JSON.stringify({ ceiling: SCENE_CEILING_VIEWPORTS, start: begun, left: side(-1, cone.left), right: side(1, cone.right), ms }));
  return cone;
}

export function useFreeCamera(scene: { current: FreeScene }, dom: FreeDom, culled: { current: CullView | null }, onRender: () => void) {
  /** The pose held between gestures; null: the framing's (re-based on a new view, wall pattern or filter, and by the arrows). */
  const held = useRef<Pose | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** A look let go past its soft limit easing back (spec 1.5) over SPRING_MS from t0, the lift (a late first frame catches up). */
  const spring = useRef<{ from: Pose; to: Pose; t0: number } | null>(null);
  const raf = useRef<number | undefined>(undefined);

  const cameraOf = (pose: Pose | null): Camera => (pose === null ? scene.current.base : withPose(scene.current.base, pose));
  /** The pose drawn now: a gesture's shown pose, the spring's, or the held one (null: the framing's). */
  const drawn = (now?: number): Pose | null => {
    const g = gesture.current;
    if (g?.mode) return g.shown;
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
    if (stickyPose(culled.current, next) !== culled.current) onRender();
  };

  const loop = (now: number) => {
    raf.current = undefined;
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
  useEffect(
    () => () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      const g = gesture.current;
      if (g?.timer !== undefined) clearTimeout(g.timer);
    },
    [],
  );

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
  const setGesture = (mode: 'move' | 'look' | null) => {
    const host = dom.host.current;
    if (!host) return;
    if (mode === null) delete host.dataset.gesture;
    else host.dataset.gesture = mode;
  };

  /** A finger down on the scene (not on a control, not zoomed, not a pinch): Look arms if it stays still LOOK_HOLD_MS. */
  const press = useCallback((e: FreePress, at: Point) => {
    const prev = gesture.current;
    if (prev?.timer !== undefined) clearTimeout(prev.timer);
    const s = scene.current;
    const lookAtOnce = s.lookMode || e.button === 2 || (e.button === 0 && e.shiftKey === true);
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
        // a drag comes from a pointer on the scene's host
        g.limits = lookCone(s, g.start, (budget) => (dom.host.current!.dataset.yawBudget = budget));
        // rulings S6: the haptic is the first Look move's, never the arming's
        hapticLight();
      } else {
        g.mode = 'move';
        g.anchor = anchorDepth(camera, g.at0.x, g.at0.y, { x0: s.wall.leftMm, x1: s.wall.rightMm }, s.zBack);
        const limit = capSpanMm(s.wall, DRAWN_CABINETS_LIMIT);
        g.span = limit === Infinity ? Infinity : Math.max(limit, frameSpanMm(camera, s.fronts));
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
      const ok = g.span === Infinity ? undefined : (p: readonly number[]) => frameSpanMm(withPose(base, { ...g.committed, x: p[0], y: p[1], z: p[2] }), s.fronts) <= g.span;
      g.committed = walk(g.committed, ddx, ddy, g.anchor, base.focalPx, s.space, s.boxes, ok);
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

  return {
    /** The camera drawn now (the framing's when no pose is held). */
    camera: (base: Camera): Camera => {
      const pose = drawn();
      return pose === null ? base : withPose(base, pose);
    },
    /** A gesture moves the pose, or a look let go eases back. */
    live: (): boolean => gesture.current?.mode != null || spring.current !== null,
    /** A pose held off the framing (null: the framing). */
    held: (): Pose | null => held.current,
    /** Hold this pose (null: go back to the framing); any spring stops. */
    hold: (pose: Pose | null) => {
      spring.current = null;
      held.current = pose;
    },
    press,
    drag,
    release,
    /** Write the drawn pose to the DOM again (after a render, which may have rewritten it). */
    sync: () => {
      const pose = drawn();
      if (pose !== null) write(cameraOf(pose));
    },
  };
}
