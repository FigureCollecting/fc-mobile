/**
 * CASE-GL: the canvas the case draws into when the Renderer is Canvas. It
 * loads the renderer (three.js) on demand, so the classic view never pays
 * for it; feeds it the scene and the camera CabinetScene works out for both
 * views; turns a tap into the figure under it (a ray onto the cards); and
 * while the GPU has lost the context shows the last settled picture as a
 * still. It publishes what it draws on the canvas (data-gl-*) for the e2e.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { CaseGL, CaseGLOptions, GLSceneInput, GLStats, GLView } from './glScene';

/** What CabinetScene needs of the renderer. */
export type CaseGLLike = Pick<CaseGL, 'setScene' | 'setView' | 'pick' | 'tapPoints' | 'dispose' | 'stats'>;
export type CreateGL = (o: Pick<CaseGLOptions, 'canvas' | 'still' | 'onLost' | 'onDrawn'>) => CaseGLLike | Promise<CaseGLLike>;

const lazyGL: CreateGL = (o) => import('./glScene').then((m) => new m.CaseGL(o));

interface CaseCanvasProps {
  scene: GLSceneInput;
  view: Omit<GLView, 'dpr'>;
  lost: boolean;
  onPick: (figureIndex: number) => void;
  onLost: (lost: boolean) => void;
  onFail: (error: unknown) => void;
  createGL?: CreateGL;
}

function publish(canvas: HTMLCanvasElement | null, s: GLStats): void {
  if (!canvas) return;
  const d = canvas.dataset;
  d.glStages = JSON.stringify(s.stages);
  d.glDrawn = String(s.cardsDrawn);
  d.glPlaceholders = String(s.placeholders);
  d.glDrawCalls = String(s.drawCalls);
  d.glPages = String(s.pages);
  d.glTextureBytes = String(s.textureBytes);
  d.glBudgetBytes = String(s.budgetBytes);
  d.glDpr = String(s.dpr);
  d.glCullMs = s.cullMs.toFixed(3);
  d.glFrames = String(Number(d.glFrames ?? 0) + 1);
}

export function CaseCanvas({ scene, view, lost, onPick, onLost, onFail, createGL = lazyGL }: CaseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stillRef = useRef<HTMLCanvasElement>(null);
  const gl = useRef<CaseGLLike | null>(null);
  const applied = useRef<GLSceneInput | null>(null);
  const latest = useRef({ scene, view, onLost, onFail });
  latest.current = { scene, view, onLost, onFail };

  useLayoutEffect(() => {
    let gone = false;
    let made: CaseGLLike | null = null;
    const start = (g: CaseGLLike) => {
      made = g;
      if (gone) return g.dispose();
      gl.current = g;
      applied.current = latest.current.scene;
      g.setScene(latest.current.scene);
      g.setView({ ...latest.current.view, dpr: window.devicePixelRatio || 1 });
      canvasRef.current?.setAttribute('data-gl-ready', '1');
    };
    try {
      const out = createGL({
        canvas: canvasRef.current!,
        still: stillRef.current,
        onLost: (l) => latest.current.onLost(l),
        onDrawn: (s) => {
          publish(canvasRef.current, s);
          // where the e2e taps: a few drawn figures, in screen px
          if (gl.current) canvasRef.current?.setAttribute('data-gl-taps', JSON.stringify(gl.current.tapPoints(6)));
        },
      });
      if (out instanceof Promise) out.then(start, (e: unknown) => !gone && latest.current.onFail(e));
      else start(out);
    } catch (e) {
      latest.current.onFail(e);
    }
    return () => {
      gone = true;
      gl.current = null;
      made?.dispose();
    };
  }, [createGL]);

  useLayoutEffect(() => {
    if (!gl.current || applied.current === scene) return;
    applied.current = scene;
    gl.current.setScene(scene);
  }, [scene]);

  // every render of the scene is a new camera or pan: before the browser paints, so the frame it schedules is this one's
  useLayoutEffect(() => {
    gl.current?.setView({ ...view, dpr: window.devicePixelRatio || 1 });
  });

  const onClick = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !gl.current) return;
    const r = canvas.getBoundingClientRect();
    const hit = gl.current.pick(e.clientX - r.left, e.clientY - r.top);
    if (hit !== null) onPick(hit);
  };

  return (
    <>
      <canvas ref={canvasRef} class="case-gl" hidden={lost} onClick={onClick} />
      <canvas ref={stillRef} class="case-gl__still" hidden={!lost} aria-hidden="true" />
    </>
  );
}
