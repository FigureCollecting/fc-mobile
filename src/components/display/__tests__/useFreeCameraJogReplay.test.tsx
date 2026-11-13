import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/preact';
import { JOG_FULL_PX, poseOf } from '../casePose';
import { useFreeCamera, type FreeScene } from '../useFreeCamera';
import { LONG_WALL, freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-DEPTH-2 REGRESSION: the hat (the 10-28 jog) alone, replayed through the thumb offsets and frame times caseJog's
// tests pin, writes the very frames it wrote before the depth drive joined it: the fixture was recorded at cd02ca1
// (RECORD_JOG_REPLAY=1) and is compared byte for byte.

const FIXTURE = join(process.cwd(), 'src/components/display/__tests__/__fixtures__/jogReplay.json');
const DEG = Math.PI / 180;

type Step = readonly ['aim', number, number] | readonly ['frames', number, number] | readonly ['start'] | readonly ['stop'];

const ROUTE: readonly Step[] = [
  ['start'],
  ['frames', 1, 16],
  ['aim', JOG_FULL_PX, 0],
  ['frames', 10, 16],
  ['aim', -200, 0],
  ['frames', 10, 50],
  ['aim', 0, -JOG_FULL_PX],
  ['frames', 10, 16],
  ['aim', 0, 90],
  ['frames', 10, 16],
  ['aim', 30, 40],
  ['frames', 8, 16],
  ['aim', 50, -50],
  ['frames', 8, 16],
  ['aim', 60, 60 * Math.tan(19 * DEG)],
  ['frames', 8, 16],
  ['aim', 5, -5],
  ['frames', 5, 16],
  ['aim', JOG_FULL_PX, 0],
  ['frames', 3, 400],
  ['frames', 1, 8],
  ['frames', 1, 33],
  ['frames', 1, 120],
  ['stop'],
  ['frames', 2, 16],
  ['start'],
  ['frames', 1, 16],
  ['aim', JOG_FULL_PX, 0],
  ['frames', 300, 16],
  ['aim', 0, -JOG_FULL_PX],
  ['frames', 50, 16],
  ['aim', -JOG_FULL_PX, JOG_FULL_PX],
  ['frames', 40, 16],
  ['stop'],
];

const LONG_ROUTE: readonly Step[] = [
  ['start'],
  ['frames', 1, 16],
  ['aim', 0, JOG_FULL_PX],
  ['frames', 200, 16],
  ['aim', -JOG_FULL_PX, 0],
  ['frames', 200, 16],
  ['stop'],
];

const TURNED_ROUTE: readonly Step[] = [['start'], ['frames', 1, 16], ['aim', -JOG_FULL_PX, 0], ['frames', 60, 16], ['aim', 0, JOG_FULL_PX], ['frames', 60, 16], ['stop']];

/** Drive the hat along `route` and record every frame's writes: the transform, data-camera, gesture and renders asked. */
function replay(scene: FreeScene, route: readonly Step[], turnedYaw?: number) {
  const frames = handFrames();
  const dom = freeDom();
  let renders = 0;
  const ref = { current: scene };
  const { result, unmount } = renderHook(() => useFreeCamera(ref, dom, { current: null }, () => renders++));
  if (turnedYaw !== undefined) result.current.hold({ ...poseOf(scene.base), yaw: turnedYaw });
  const out: unknown[] = [];
  const snap = (what: string) =>
    out.push([what, dom.rootEl.style.transform, dom.hostEl.dataset.camera ?? null, dom.hostEl.dataset.gesture ?? null, renders, result.current.live()]);
  for (const step of route) {
    if (step[0] === 'start') {
      let ok = false;
      act(() => {
        ok = result.current.jogStart();
      });
      out.push(['start', ok]);
    } else if (step[0] === 'stop') {
      let left: unknown = null;
      act(() => {
        left = result.current.jogStop();
      });
      out.push(['stop', left]);
      snap('stopped');
    } else if (step[0] === 'aim') {
      result.current.jogAim(step[1], step[2]);
    } else {
      for (let i = 0; i < step[1]; i++) {
        frames.tick(step[2]);
        snap('frame');
      }
    }
  }
  unmount();
  return out;
}

function record() {
  return {
    ross: replay(freeSceneOf(), ROUTE),
    phone: replay(freeSceneOf({ frame: { width: 412, height: 780 }, focus: 3 }), ROUTE),
    long: replay(freeSceneOf({ wall: LONG_WALL, focus: 20 }), LONG_ROUTE),
    turned: replay(freeSceneOf({ wall: LONG_WALL, focus: 20 }), TURNED_ROUTE, 20 * DEG),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('NAV-DEPTH-2 regression: a hat-only jog writes the same frames as before the depth drive', () => {
  it('the caseJog offsets and frame times, on Ross\'s wall, a long wall at the Classic cap, and turned: byte for byte', () => {
    const now = `${JSON.stringify(record(), null, 1)}\n`;
    if (process.env.RECORD_JOG_REPLAY === '1') writeFileSync(FIXTURE, now);
    const then = readFileSync(FIXTURE, 'utf8');
    // a replay that moved nothing would prove nothing
    expect(then.length).toBeGreaterThan(10_000);
    expect(now).toBe(then);
  });
});
