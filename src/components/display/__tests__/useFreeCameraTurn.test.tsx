import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { JOG_FULL_PX, poseOf } from '../casePose';
import type { Camera } from '../caseCamera';
import { useFreeCamera, type FreeScene } from '../useFreeCamera';
import { freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-FLAT: the Free camera writes the figures' turns with the camera, frame by frame (the scene renders only when its
// cull must change), through the scene's turnFigures: no figure is read or laid out by the writer itself.

afterEach(() => vi.restoreAllMocks());

function mount(scene: FreeScene) {
  const frames = handFrames();
  const dom = freeDom();
  const ref = { current: scene };
  const hook = renderHook(() => useFreeCamera(ref, dom, { current: null }, () => undefined));
  return { ref, frames, fc: () => hook.result.current, unmount: hook.unmount };
}

describe('the Free camera turns the figures as it writes the camera', () => {
  it('every frame the hat walks the eye, turnFigures hears the camera written that frame', () => {
    const seen: Camera[] = [];
    const m = mount({ ...freeSceneOf(), turnFigures: (camera) => seen.push(camera) });
    expect(m.fc().jogStart()).toBe(true);
    m.fc().jogAim(JOG_FULL_PX, 0);
    for (let i = 0; i < 12; i++) m.frames.tick(16);
    expect(seen.length).toBeGreaterThanOrEqual(11);
    // the last camera it heard is the one drawn now, and the eye walked along x
    expect(poseOf(seen[seen.length - 1])).toEqual(poseOf(m.fc().camera(m.ref.current.base)));
    expect(seen[seen.length - 1].x).toBeGreaterThan(seen[0].x);
    m.unmount();
  });

  it('a scene without turnFigures (none drawn yet) is written as before', () => {
    const m = mount(freeSceneOf());
    m.fc().jogStart();
    m.fc().jogAim(JOG_FULL_PX, 0);
    expect(() => {
      for (let i = 0; i < 4; i++) m.frames.tick(16);
    }).not.toThrow();
    m.unmount();
  });
});
