import { describe, it, expect } from 'vitest';
import { IKEA_KLINGSBO } from '../cabinetPresets';
import type { Camera } from '../caseCamera';
import { frameCase, frontsOf } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import { BUDGET_PROBE_STEP, BUDGET_YAW_STEP, poseOf, withPose, type Pose } from '../casePose';
import { SCENE_CEILING_VIEWPORTS, fitsCeiling, type Projector, type SceneCost } from '../caseBudget';
import { coneOf, lookCone, type FreeScene } from '../useFreeCamera';

// NAV-1A a+b, Ross 10-28: a look's cone, worked out from the scene projected at each yaw it asks. The projection is
// stubbed here (caseBudget's own tests and the scene's pin it): what is pinned is the production ceiling, which camera
// every yaw is projected at, and where a look that starts turned searches from.

const DEG = Math.PI / 180;
const OPEN = { width: 870, height: 475 };
const WALL = wallLayout(Array.from({ length: 40 }, () => IKEA_KLINGSBO));
const HEADROOM = WALL.cabinets.map(() => 300);
const base = frameCase({ frame: OPEN, wall: WALL, headroomMm: HEADROOM, view: 'wall', focus: 20, shelf: 0, level: true }).camera;
const scene = { base, wall: WALL, fronts: frontsOf(WALL, HEADROOM) } as unknown as FreeScene;
const realism = coneOf(base, WALL, scene.fronts);
const opening = poseOf(base);

const COST: SceneCost = { s: 0.25, drawn: [19, 20, 21], figuresDrawn: 30, figures: 1000, shadows: 256, mesh: 500, room: 0, faces: 6144 };
/** A projector costing `vp(yaw)` viewports, recording the cameras it was asked at and the camera each was held from. */
function stub(vp: (yaw: number) => number) {
  const asked: { camera: Camera; held: Camera | undefined }[] = [];
  const project: Projector = (camera, held) => {
    asked.push({ camera, held });
    return { vp: vp(camera.yaw ?? 0), cost: COST };
  };
  return { project, asked };
}
const quiet = () => undefined;

describe('fitsCeiling (NAV-1A b): the production ceiling', () => {
  it('at 3 viewports or under fits; a hair over does not', () => {
    expect(SCENE_CEILING_VIEWPORTS).toBe(3);
    expect(fitsCeiling(3)).toBe(true);
    expect(fitsCeiling(3 - 1e-9)).toBe(true);
    expect(fitsCeiling(2.81)).toBe(true);
    expect(fitsCeiling(3 + 1e-9)).toBe(false);
    expect(fitsCeiling(3.19)).toBe(false);
  });
});

describe('lookCone: the realism cone kept to the ceiling, every yaw projected at the px per mm it would be drawn at', () => {
  it('a projection exactly at the ceiling at every yaw it asks: the realism cone, (b) never engaged', () => {
    const { project, asked } = stub(() => 3);
    const cone = lookCone(scene, opening, null, quiet, project);
    expect(cone).toEqual(realism);
    expect(asked.length).toBeGreaterThan(2);
  });

  it('a hair over the ceiling at the right hard limit only: that side ends short of it; the left keeps the cone', () => {
    const { project } = stub((yaw) => (yaw === realism.hard ? 3 + 1e-9 : 3));
    const cone = lookCone(scene, opening, null, quiet, project);
    expect(cone.left).toBeUndefined();
    expect(cone.right!.hard).toBeLessThan(realism.hard);
    expect(cone.right!.hard).toBeGreaterThan(realism.hard - BUDGET_YAW_STEP);
  });

  it('held from where the turn left yaw 0: this start unturned; a start already turned, `unturned`; none known, each yaw unturned', () => {
    const level = stub(() => 1);
    lookCone(scene, opening, null, quiet, level.project);
    for (const { held } of level.asked) expect(held).toEqual(withPose(base, opening));
    const left: Pose = { ...opening, x: opening.x - 900 };
    const turned: Pose = { ...left, x: left.x + 400, z: left.z - 700, yaw: 20 * DEG };
    const on = stub(() => 1);
    lookCone(scene, turned, left, quiet, on.project);
    for (const { camera, held } of on.asked) {
      expect(held).toEqual(withPose(base, left));
      expect([camera.x, camera.y, camera.z, camera.pitch]).toEqual([turned.x, turned.y, turned.z, turned.pitch]);
    }
    const unknown = stub(() => 1);
    lookCone(scene, turned, null, quiet, unknown.project);
    for (const { held } of unknown.asked) expect(held).toBeUndefined();
  });

  it('a look that starts turned searches its side from where it starts, never a yaw between straight ahead and it', () => {
    const limit = 30 * DEG;
    const from: Pose = { ...opening, yaw: 20 * DEG };
    const { project, asked } = stub((yaw) => (yaw > limit ? 3.5 : 2));
    const cone = lookCone(scene, from, opening, quiet, project);
    const yaws = asked.map(({ camera }) => camera.yaw!);
    expect(yaws[0]).toBe(20 * DEG);
    expect(yaws.filter((y) => y > 0 && y < 20 * DEG)).toEqual([]);
    expect(yaws).toContain(20 * DEG + BUDGET_PROBE_STEP);
    expect(cone.right!.hard).toBeLessThanOrEqual(limit);
    expect(cone.right!.hard).toBeGreaterThan(limit - BUDGET_YAW_STEP);
    // the other side from straight ahead
    expect(yaws).toContain(0);
    expect(cone.left).toBeUndefined();
  });

  it('a start already past the hard limit (a fold narrowed the cone): nothing asked that way, the start not projected', () => {
    let out = '';
    const past: Pose = { ...opening, yaw: realism.hard + 2 * DEG };
    const { project, asked } = stub(() => 2);
    const cone = lookCone(scene, past, opening, (b) => (out = b), project);
    expect(cone.right).toBeUndefined();
    expect(asked.every(({ camera }) => (camera.yaw ?? 0) <= 0)).toBe(true);
    expect((JSON.parse(out) as { start: unknown }).start).toBeNull();
  });

  it('publishes the start, each way the hard limit where it was asked and the fit, every yaw asked with its cost, and the time', () => {
    let out = '';
    const { project, asked } = stub((yaw) => (yaw > 25 * DEG ? 3.5 : 2 + yaw));
    lookCone(scene, opening, null, (b) => (out = b), project);
    type Side = { hard: number; fit: number | null; atHard: { vp: number; drawn: number; figures: number; px: Record<string, number> } | null };
    const b = JSON.parse(out) as { ceiling: number; start: { yaw: number; vp: number; drawn: number; figures: number }; left: Side; right: Side; asked: [number, number][]; ms: number };
    expect(b.ceiling).toBe(3);
    expect(b.start).toMatchObject({ yaw: 0, vp: 2, drawn: 3, figures: 30 });
    // right: stopped at 25 deg, its hard limit never asked; left: asked out to it, no fit
    expect(b.right.atHard).toBeNull();
    expect(b.right.fit).toBeGreaterThan(25 - BUDGET_YAW_STEP / DEG);
    expect(b.right.fit).toBeLessThanOrEqual(25);
    expect(b.left.fit).toBeNull();
    expect(b.left.atHard).toMatchObject({ drawn: 3, figures: 30, px: { figures: 1000, shadows: 256, mesh: 500, room: 0, faces: 6144 } });
    expect(b.left.hard).toBeCloseTo(realism.hard / DEG, 4);
    // every yaw asked, once, in the order asked
    expect(b.asked).toHaveLength(asked.length);
    expect(new Set(b.asked.map(([y]) => y)).size).toBe(b.asked.length);
    expect(b.ms).toBeGreaterThanOrEqual(0);
  });
});
