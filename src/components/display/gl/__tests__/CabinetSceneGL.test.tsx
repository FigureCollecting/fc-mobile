import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../../casePrefs';
import { FIXTURE_FIGURES, getFixtureFigures } from '../../../../dev-fixtures/fixtures';
import { project, type Camera } from '../../caseCamera';
import { CaseGL, type CaseGLOptions } from '../glScene';

/** WebGL2 here or not: jsdom has none, so each test says. */
const webgl = vi.hoisted(() => ({ ok: true }));
vi.mock('../webgl', () => ({ hasWebGL2: () => webgl.ok }));

afterEach(() => {
  cleanup();
  webgl.ok = true;
});

function fakeCanvas(w: number, h: number) {
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: (t, k, v) => ((t[k as string] = v), true) });
  return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

function glFactory() {
  const made: { gl: CaseGL; renderer: { render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } }[] = [];
  const createGL = (o: Pick<CaseGLOptions, 'canvas' | 'still' | 'onLost'>) => {
    let renderer!: (typeof made)[number]['renderer'];
    const gl = new CaseGL({
      ...o,
      createRenderer: (canvas) =>
        (renderer = {
          domElement: canvas,
          setPixelRatio: vi.fn(),
          setSize: vi.fn(),
          render: vi.fn(),
          dispose: vi.fn(),
          forceContextLoss: vi.fn(),
          info: { render: { calls: 0 }, memory: { textures: 0, geometries: 0 } },
        } as never),
      makeCanvas: fakeCanvas,
      loadImage: async () => ({ width: 100, height: 200 }) as unknown as CanvasImageSource,
      schedule: (f) => f(),
    });
    made.push({ gl, renderer });
    return gl;
  };
  return { createGL, made };
}

const canvasPrefs: CasePrefs = { ...DEFAULT_CASE_PREFS, renderer: 'canvas', view: 'cabinet' };

function open(prefs: CasePrefs, onSelect = vi.fn<(f: Figure, i: number) => void>(), figures: readonly Figure[] = FIXTURE_FIGURES) {
  const factory = glFactory();
  const r = render(<CabinetScene figures={figures} onSelect={onSelect} prefs={prefs} createGL={factory.createGL} />);
  const host = r.container.querySelector<HTMLElement>('.cabinet-scene')!;
  return { ...r, host, onSelect, ...factory };
}

const cameraOf = (host: HTMLElement): Camera => {
  const c = JSON.parse(host.dataset.camera!) as Record<string, number>;
  return { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
};

describe('CabinetScene, Renderer: Canvas (CASE-GL)', () => {
  it('Classic stays the default: the CSS 3D scene, no canvas', () => {
    const { host, made } = open(DEFAULT_CASE_PREFS);
    expect(host.dataset.renderer).toBe('classic');
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.querySelector('.cabinet-scene__root')).not.toBeNull();
    expect(made).toHaveLength(0);
  });

  it('Canvas: one canvas instead of the CSS 3D scene, fed the same camera', () => {
    const { host, made } = open(canvasPrefs);
    expect(host.dataset.renderer).toBe('canvas');
    expect(host.querySelectorAll('canvas.case-gl')).toHaveLength(1);
    expect(host.querySelector('.cabinet-scene__root')).toBeNull();
    expect(host.querySelectorAll('button.cab-figure')).toHaveLength(0);
    expect(made).toHaveLength(1);
    expect(made[0].renderer.render).toHaveBeenCalled();
    // the 5-front and 250-figure caps are the classic view's: the canvas is given every figure
    expect(made[0].gl.stats.stages.total).toBeGreaterThanOrEqual(FIXTURE_FIGURES.length);
    // the nav stays DOM: two buttons over the canvas
    expect(host.querySelector('.cabinet-scene__step--next')).not.toBeNull();
  });

  it('no WebGL2: falls back to the classic view and says why', () => {
    webgl.ok = false;
    const { host, made } = open(canvasPrefs);
    expect(host.dataset.renderer).toBe('classic');
    expect(host.dataset.glFallback).toBe('no-webgl2');
    expect(host.querySelector('.cabinet-scene__root')).not.toBeNull();
    expect(made).toHaveLength(0);
  });

  it('a renderer that cannot start falls back to the classic view', () => {
    const r = render(
      <CabinetScene
        figures={FIXTURE_FIGURES}
        onSelect={vi.fn()}
        prefs={canvasPrefs}
        createGL={() => {
          throw new Error('no context');
        }}
      />,
    );
    const host = r.container.querySelector<HTMLElement>('.cabinet-scene')!;
    expect(host.dataset.renderer).toBe('classic');
    expect(host.dataset.glFallback).toBe('failed');
  });

  it('a tap on a drawn figure opens that figure; a tap on bare cabinet opens nothing', () => {
    const { host, made, onSelect } = open(canvasPrefs);
    const gl = made[0].gl;
    const card = gl.figureCards().find((c) => gl.visibleIds().includes(c.id))!;
    const cam = cameraOf(host);
    const p = project(cam, [(card.tap!.x0 + card.tap!.x1) / 2, (card.tap!.y0 + card.tap!.y1) / 2, card.z]);
    const canvas = host.querySelector('canvas.case-gl')!;
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe(card.figure);
    expect(onSelect.mock.calls[0][0]).toBe(FIXTURE_FIGURES[card.figure]);
    fireEvent.click(canvas, { clientX: 1, clientY: cam.frame.height - 1 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a swipe walks the same camera the classic view walks, and the canvas redraws it; the swipe opens nothing', () => {
    const { host, made, onSelect } = open({ ...canvasPrefs, view: 'cabinet', swipe: 'camera' }, undefined, getFixtureFigures(8));
    const x0 = Number(host.dataset.cameraX);
    made[0].renderer.render.mockClear();
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 225, clientY: 200 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 150, clientY: 200 });
    expect(made[0].renderer.render).toHaveBeenCalled();
    // the camera walks with the finger, as in the classic view
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    fireEvent.pointerUp(host, { pointerId: 1, clientX: 150, clientY: 200 });
    // the cabinet view walks as the finger says, and the canvas was given that camera
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    const gl = made[0].gl;
    const card = gl.figureCards().find((c) => gl.visibleIds().includes(c.id))!;
    const p = project(cameraOf(host), [(card.tap!.x0 + card.tap!.x1) / 2, (card.tap!.y0 + card.tap!.y1) / 2, card.z]);
    const canvas = host.querySelector('canvas.case-gl')!;
    // the click the browser makes of the swipe opens nothing; the next tap opens
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('context lost: a still frame stands in; restored: the canvas again', () => {
    const { host } = open(canvasPrefs);
    const canvas = host.querySelector<HTMLCanvasElement>('canvas.case-gl')!;
    const still = host.querySelector<HTMLCanvasElement>('canvas.case-gl__still')!;
    expect(still.hidden).toBe(true);
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });
    expect(still.hidden).toBe(false);
    expect(canvas.hidden).toBe(true);
    expect(host.dataset.glLost).toBe('1');
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    });
    expect(still.hidden).toBe(true);
    expect(canvas.hidden).toBe(false);
    expect(host.dataset.glLost).toBe('0');
  });

  it('unmounting lets every GL resource go', () => {
    const { unmount, made } = open(canvasPrefs);
    unmount();
    expect(made[0].renderer.dispose).toHaveBeenCalledTimes(1);
    expect(made[0].gl.resources()).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });

  it('a renderer that failed starts afresh when Canvas is chosen again', () => {
    let fail = true;
    const factory = glFactory();
    const createGL: typeof factory.createGL = (o) => {
      if (fail) throw new Error('no context');
      return factory.createGL(o);
    };
    const r = render(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={canvasPrefs} createGL={createGL} />);
    const host = () => r.container.querySelector<HTMLElement>('.cabinet-scene')!;
    expect(host().dataset.glFallback).toBe('failed');
    fail = false;
    r.rerender(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={{ ...canvasPrefs, renderer: 'classic' }} createGL={createGL} />);
    expect(host().dataset.glFallback).toBeUndefined();
    r.rerender(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={canvasPrefs} createGL={createGL} />);
    expect(host().dataset.renderer).toBe('canvas');
  });

  it('switching back to Classic lets the canvas go and draws the CSS 3D scene', () => {
    const factory = glFactory();
    const r = render(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={canvasPrefs} createGL={factory.createGL} />);
    r.rerender(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={{ ...canvasPrefs, renderer: 'classic' }} createGL={factory.createGL} />);
    expect(factory.made[0].renderer.dispose).toHaveBeenCalledTimes(1);
    expect(r.container.querySelector('canvas.case-gl')).toBeNull();
    expect(r.container.querySelector('.cabinet-scene__root')).not.toBeNull();
  });
});
