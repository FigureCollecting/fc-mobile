import { describe, it, expect, vi, afterEach, beforeEach, onTestFinished } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import type { PictureMargins } from '../figureArt';
import { JOG_FULL_PX, JOG_MAX_STEP_MS, jogSpeed } from '../casePose';
import { castRay, project, rayHitPlane, type Camera } from '../caseCamera';
import { cullRect } from '../caseCull';
import { HUSH_MS, REVEAL_MAX_MS } from '../layoutBasis';
import { useJogStore } from '../../../stores/jog';

// NAV-2B (critique 19): at twice the jog's speed the Free camera re-culls about twice as often, and each re-cull draws
// cabinets whose pictures may still be loading. Held at full reach on a long wall, 100 ms frames (the most a frame
// moves), with the pictures read in batches as it goes: every frame, the frame is within what the cull drew, every front
// it shows is drawn, and every figure drawn is its picture or, still being read, its plate: never a blank box.

/** What the canvas read of each mask says, by URL (absent while it is still being read); the same map until a read. */
const measured = vi.hoisted(() => ({
  margins: new Map<string, PictureMargins>(),
  version: 0,
  last: null as { version: number; urls: readonly string[]; out: Map<string, PictureMargins> } | null,
}));

vi.mock('../alphaMargin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../alphaMargin')>();
  return {
    ...real,
    // as the hook does: a new map only when a read has come in, so the layout basis sees what arrived and nothing else
    useAlphaMarginsOf: (urls: readonly string[]) => {
      const last = measured.last;
      if (last !== null && last.version === measured.version && last.urls === urls) return last.out;
      const out = new Map(urls.flatMap((u) => (measured.margins.has(u) ? [[u, measured.margins.get(u)!] as const] : [])));
      measured.last = { version: measured.version, urls, out };
      return out;
    },
    useContactBand: () => null,
    alphaPictureLoaded: () => {},
  };
});

/** These masks have been read. */
function read(urls: readonly string[]) {
  for (const u of urls) measured.margins.set(u, MARGINS);
  measured.version++;
}

const COVER = { width: 443, height: 418 };
const MARGINS: PictureMargins = { top: 0.1, bottom: 0.05, left: 0.1, right: 0.1 };
// a wall of 21 cabinets: about 10 m of the jog's travel from the opening
const FIGURES = Array.from({ length: 1000 }, (_, i): Figure => ({ _id: `j${i}`, name: `Jog ${i}`, dimensions: { heightMm: 90, widthMm: 40 } }) as Figure);
const masked = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800 });
const MASKS = FIGURES.map((f) => masked(f).maskUrl);

const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const jog = () => useJogStore.getState().target!;
const cam = (): Camera => {
  const c = JSON.parse(host().dataset.camera!) as { x: number; y: number; z: number; yaw: number; pitch: number; focalPx: number; width: number; height: number };
  return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
};

/** The animation frames by hand: each runs every callback asked for at the time given (as a browser's frame does). */
function handFrames() {
  const asked = new Map<number, FrameRequestCallback>();
  let id = 0;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (asked.set(++id, cb), id));
  const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((n) => void asked.delete(n));
  onTestFinished(() => {
    raf.mockRestore();
    caf.mockRestore();
  });
  return (t: number) =>
    act(() => {
      const due = [...asked.values()];
      asked.clear();
      for (const cb of due) cb(t);
    });
}

function scene(loading: boolean) {
  const props = {
    figures: FIGURES,
    onSelect: vi.fn(),
    prefs: { ...DEFAULT_CASE_PREFS, clearanceMm: 0, freeCamera: true },
    frameFallback: COVER,
    imageFor: masked,
    steadyLayout: true,
  };
  const utils = render(<CabinetScene {...props} imagesComplete={!loading} />);
  // the first layout: at once with every picture read, else at its deadline with those that are (LAYOUT-STABLE-1)
  act(() => {
    vi.advanceTimersByTime(REVEAL_MAX_MS);
  });
  const again = (stillLoading: boolean) => {
    utils.rerender(<CabinetScene {...props} imagesComplete={!stillLoading} />);
    act(() => {
      vi.advanceTimersByTime(HUSH_MS);
    });
  };
  return { ...utils, again };
}

/** Whether the frame's corners, cast to the fronts' plane, draw inside the cull's rect: all it shows was culled for. */
function frameWithinCull(): boolean {
  const live = cam();
  const cull = { ...live, x: Number(host().dataset.cullX) };
  const r = cullRect(live.frame);
  return [
    [0, 0],
    [live.frame.width, 0],
    [0, live.frame.height],
    [live.frame.width, live.frame.height],
  ].every(([sx, sy]) => {
    const ray = castRay(live, sx, sy);
    const hit = rayHitPlane(ray, 'z', 0) ?? rayHitPlane(ray, 'y', 0);
    if (hit === null) return false;
    const q = project(cull, hit.at);
    return q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
  });
}

/** The cabinets whose front the frame shows (a pixel's grace at either edge) that the scene does not draw. */
function frontsNotDrawn(): number[] {
  const live = cam();
  const drawn = new Set(Array.from(document.querySelectorAll<HTMLElement>('.cab')).map((el) => Number(el.dataset.index)));
  const boxes = JSON.parse(host().dataset.wall!) as [number, number][];
  return boxes.flatMap(([x0, x1], i) => (project(live, [x1, 0, 0]).x > 1 && project(live, [x0, 0, 0]).x < live.frame.width - 1 && !drawn.has(i) ? [i] : []));
}

/** Every figure drawn: its picture (grounded, shown, no plate) or, still being read, its plate with its name (picture hidden). */
function figuresDrawn() {
  let pictures = 0;
  let plates = 0;
  const blank: string[] = [];
  for (const b of document.querySelectorAll<HTMLElement>('button.cab-figure')) {
    const art = b.querySelector<HTMLElement>('.cab-figure__art');
    const plate = b.querySelector<HTMLElement>('.cab-figure__plate');
    if (b.dataset.grounded === '1' && art !== null && art.style.visibility !== 'hidden' && plate === null) pictures++;
    else if (b.dataset.grounded === '0' && plate?.textContent === b.getAttribute('aria-label') && art?.style.visibility === 'hidden') plates++;
    else blank.push(b.getAttribute('aria-label')!);
  }
  return { pictures, plates, blank };
}

beforeEach(() => {
  useJogStore.setState({ target: null });
  measured.margins.clear();
  measured.last = null;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the jog at twice the speed while pictures load (NAV-2B, critique 19)', () => {
  /** Held at full reach for `n` 100 ms frames, `read` before each (pictures arriving); what every frame saw. */
  function heldJog(n: number, read: (i: number) => boolean) {
    const s = scene(true);
    const frameAt = handFrames();
    act(() => {
      jog().start();
      jog().aim(JOG_FULL_PX, 0);
    });
    let t = 1000;
    frameAt(t);
    const x0 = cam().x;
    const seen = { frames: 0, reculls: 0, pictures: 0, plates: 0, blank: [] as string[], outrun: 0, holes: [] as number[], firstStep: 0 };
    let cullX = host().dataset.cullX;
    for (let i = 1; i <= n; i++) {
      if (read(i)) s.again(MASKS.some((u) => !measured.margins.has(u)));
      const before = cam().x;
      frameAt((t += JOG_MAX_STEP_MS));
      if (i === 1) seen.firstStep = cam().x - before;
      if (cam().x === before) break;
      seen.frames++;
      if (host().dataset.cullX !== cullX) seen.reculls++;
      cullX = host().dataset.cullX;
      if (!frameWithinCull()) seen.outrun++;
      seen.holes.push(...frontsNotDrawn());
      const f = figuresDrawn();
      seen.pictures += f.pictures;
      seen.plates += f.plates;
      seen.blank.push(...f.blank);
    }
    act(() => jog().stop());
    return { ...seen, travel: cam().x - x0, s };
  }

  it('held at full reach, pictures arriving as it goes: every frame within the cull, every front drawn, every figure its picture or its plate', () => {
    // a third of the masks read at the opening; another 60 every second frame
    read(MASKS.slice(0, 340));
    const c0 = { focalPx: 0, z: 0, width: 0 };
    let batch = 0;
    const seen = heldJog(40, (i) => {
      if (i === 1) Object.assign(c0, { focalPx: cam().focalPx, z: cam().z, width: cam().frame.width });
      if (i % 2 !== 0) return false;
      read(MASKS.slice(340 + batch * 60, 340 + (batch + 1) * 60));
      batch++;
      return true;
    });
    // twice today's top: a 100 ms frame moves the picture a fifth of a frame width at the anchor depth (a level eye's distance)
    expect((seen.firstStep * c0.focalPx) / c0.z / c0.width).toBeCloseTo((jogSpeed(JOG_FULL_PX) * JOG_MAX_STEP_MS) / 1000, 6);
    expect(jogSpeed(JOG_FULL_PX)).toBe(2);
    expect(seen.outrun).toBe(0);
    expect(seen.holes).toEqual([]);
    expect(seen.blank).toEqual([]);
    // measured 10-31: 17 frames, 11 re-culls, 3,630 pictures and 2,359 plates drawn over them
    expect(seen.frames).toBeGreaterThan(12);
    expect(seen.reculls).toBeGreaterThan(6);
    // both kinds were drawn while it ran: pictures read and plates still being read
    expect(seen.pictures).toBeGreaterThan(0);
    expect(seen.plates).toBeGreaterThan(0);
    // the rest read: every figure drawn is its picture
    read(MASKS);
    seen.s.again(false);
    const after = figuresDrawn();
    expect(after.blank).toEqual([]);
    expect(after.plates).toBe(0);
    expect(after.pictures).toBeGreaterThan(0);
  }, 60_000);

  it('at 2x the cull redraws more often than at ?jogmax=1 over the same frames (measured 11 to 7), and the frame never outruns it', () => {
    onTestFinished(() => window.history.replaceState(null, '', '/'));
    const run = (query: string) => {
      window.history.replaceState(null, '', `/${query}`);
      read(MASKS);
      const seen = heldJog(16, () => false);
      cleanup();
      return seen;
    };
    const today = run('?jogmax=1');
    const doubled = run('');
    expect(doubled.travel / today.travel).toBeCloseTo(2, 1);
    expect(doubled.reculls / today.reculls).toBeGreaterThan(1.3);
    expect(doubled.reculls / today.reculls).toBeLessThan(2.6);
    for (const seen of [today, doubled]) {
      expect(seen.outrun).toBe(0);
      expect(seen.holes).toEqual([]);
      expect(seen.blank).toEqual([]);
    }
  }, 60_000);
});
