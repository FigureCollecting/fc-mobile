import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act, waitFor } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, LABEL_HEIGHT_MM, SWIPE_START_PX, quadStyle } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { FIXTURE_FIGURES, getFixtureFigures, getFixtureImageRef } from '../../../dev-fixtures/fixtures';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { DRAWN_CABINETS_LIMIT, DRAWN_FIGURES_LIMIT, FIGURE_BUDGET_VIEWPORTS, FLAT_GRID, GRADIENT_GRID, MAX_DRAWN_CABINETS, MAX_DRAWN_FIGURES, cullRect, hiddenUnder, nearestCabinets, opaqueBoards, texelScale, trimFace } from '../caseCull';
import { wallLayout } from '../packCabinets';
import { cabinetBox, clampLift, frameCase, liftForDragMm, lifted, swipeCamera, type Framing } from '../caseFraming';
import { boxCorners, cssSceneTransform, project, unprojectToPlaneZ, type Camera } from '../caseCamera';
import { __clearAlphaMarginCache } from '../alphaMargin';

// each test starts with no picture read (jsdom cannot read one: every read fails and is known as all clear), so
// what a test checks at once is laid out on the labels, never on reads an earlier test left in the cache
beforeEach(() => {
  __clearAlphaMarginCache();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, ...patch });

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(<CabinetScene figures={figures} onSelect={onSelect} prefs={prefs(patch)} {...extra} />);
  const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
  return { ...utils, onSelect, host };
}

/** A face's side in world px (at the scene's px per mm), whether its element is that size or a texel grid its matrix stretches. */
function sideMm(q: HTMLElement, side: 'u' | 'v'): number {
  const m = q.style.transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
  const k = side === 'u' ? 0 : 4;
  return parseFloat(side === 'u' ? q.style.width : q.style.height) * Math.hypot(m[k], m[k + 1], m[k + 2]);
}

const figureButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));

/** The scene's px per mm (MOB-NAV-2 texelScale): a length it draws, in px, over this is the length in mm. */
const pxPerMm = (host: HTMLElement) => Number(host.dataset.pxPerMm);

/** Once every picture is read (in jsdom a read fails, known as all clear, unless a test says what the canvas reads): each figure drawn as its picture. */
async function grounded(host: HTMLElement) {
  await waitFor(() => expect(figureButtons(host).every((b) => b.dataset.grounded === '1')).toBe(true));
}

function drag(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 200 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 });
}

/** A finger's tap: down, up and the click the browser makes of them. */
function tap(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerId: 2, clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerUp(el, { pointerId: 2, clientX: 10, clientY: 10 });
  fireEvent.click(el);
}

describe('CabinetScene: faithful cabinets from the profile (CASE-CABINET)', () => {
  it('stands the seven fixtures in one KLINGSBO (the default), each a button named by its figure', () => {
    const { host } = scene(FIXTURE_FIGURES);
    expect(host.dataset.pattern).toBe('ikea-klingsbo');
    const cabs = host.querySelectorAll('.cab');
    expect(cabs).toHaveLength(1);
    expect((cabs[0] as HTMLElement).dataset.profile).toBe('ikea-klingsbo');
    expect(figureButtons(host).map((b) => b.getAttribute('aria-label'))).toEqual(FIXTURE_FIGURES.map((f) => f.name));
  });

  it('draws the cabinet as an object: posts, splayed legs, glass shelves, an open shelf, the top', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const cab = host.querySelector('.cab') as HTMLElement;
    expect(cab.querySelectorAll('.cab-leg')).toHaveLength(4);
    expect(cab.querySelectorAll('.cab-leg--splay')).toHaveLength(4);
    expect(cab.querySelectorAll('.cab-post')).toHaveLength(4);
    expect(cab.querySelectorAll('.cab-shelf--glass')).toHaveLength(4);
    expect(cab.querySelectorAll('.cab-shelf--open')).toHaveLength(1);
    expect(cab.querySelectorAll('.cab-top')).toHaveLength(1);
    // CC13: one see-through glass box per cabinet: clear panes, never an opaque slab
    expect(cab.querySelectorAll('.cab-pane').length).toBeGreaterThanOrEqual(4);
  });

  it('a Detolf has no legs and wood boards; the rack has posts and beams, no glass', () => {
    const many = getFixtureFigures(6);
    const { host } = scene(many, { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack', view: 'wall' });
    const ids = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => c.dataset.profile);
    expect(ids.slice(0, 3)).toEqual(['ikea-klingsbo', 'ikea-detolf', 'open-steel-rack']);
    const detolf = host.querySelector('.cab[data-profile="ikea-detolf"]') as HTMLElement;
    expect(detolf.querySelectorAll('.cab-leg')).toHaveLength(0);
    expect(detolf.querySelectorAll('.cab-board').length).toBeGreaterThanOrEqual(2);
    const rack = host.querySelector('.cab[data-profile="open-steel-rack"]') as HTMLElement;
    expect(rack.querySelectorAll('.cab-pane')).toHaveLength(0);
    expect(rack.querySelectorAll('.cab-post')).toHaveLength(4);
    expect(rack.querySelectorAll('.cab-beam').length).toBeGreaterThanOrEqual(5);
  });

  it('never scales figures to the screen: the same figure keeps its size in the world on every frame width', () => {
    const mm = (host: HTMLElement) => parseFloat(host.querySelector<HTMLElement>('.cab-figure')!.style.width) / pxPerMm(host);
    const narrow = scene(FIXTURE_FIGURES, {}, { frameFallback: { width: 300, height: 500 } });
    const a = mm(narrow.host);
    cleanup();
    const wide = scene(FIXTURE_FIGURES, {}, { frameFallback: { width: 900, height: 480 } });
    // the width is written to 1e-6 px: at the farther full-height camera's px per mm that is some 1e-5 mm
    expect(mm(wide.host)).toBeCloseTo(a, 4);
  });
});

describe('CabinetScene: figure art (CASE-ADAPT)', () => {
  it('a fixture is a cut-out carrying its own alpha', () => {
    const { host } = scene(FIXTURE_FIGURES);
    for (const b of figureButtons(host)) expect(b.dataset.art).toBe('cutout');
    expect(host.querySelector('.cab-figure img')?.getAttribute('src')).toBe(FIXTURE_FIGURES[0].imageUrl);
  });

  it('an image with a mask is composited at display time (CSS mask-image), never cut out', () => {
    window.history.pushState({}, '', '/?fxbranch=masked');
    const figures = getFixtureFigures(1, 'masked');
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    for (const b of figureButtons(host)) {
      expect(b.dataset.art).toBe('masked');
      const art = b.querySelector('.cab-figure__art--masked') as HTMLElement;
      expect(art.dataset.maskUrl).toMatch(/\/synthetic\/mask\//);
      expect(art.dataset.imageUrl).toMatch(/\/synthetic\/clean\//);
    }
  });

  it('a clean copy without a mask stands framed; no picture at all is a plate with the name', () => {
    const framed = getFixtureFigures(1, 'framed');
    const { host } = scene(framed);
    for (const b of figureButtons(host)) {
      expect(b.dataset.art).toBe('framed');
      expect(b.querySelector('.cab-figure__frame img')).not.toBeNull();
    }
    cleanup();
    const bare = getFixtureFigures(1, 'silhouette');
    const plates = scene(bare).host;
    for (const b of figureButtons(plates)) {
      expect(b.dataset.art).toBe('plate');
      expect(b.querySelector('.cab-figure__plate')?.textContent).toBe(b.getAttribute('aria-label'));
    }
  });

  it('its pictures load as CORS images (ADDR-1: the service worker keeps only a CORS answer), cut-out or framed', () => {
    const cut = scene(FIXTURE_FIGURES.slice(0, 1)).host;
    expect(cut.querySelector('img.cab-figure__art--cutout')).toHaveAttribute('crossorigin', 'anonymous');
    cleanup();
    const framed = scene(getFixtureFigures(1, 'framed').slice(0, 1)).host;
    expect(framed.querySelector('.cab-figure__frame img')).toHaveAttribute('crossorigin', 'anonymous');
  });

  it('a figure whose picture fails to load stands as its plate (ADDR-1), cut-out or framed', async () => {
    const cutout = FIXTURE_FIGURES[0];
    const framed = { ...getFixtureFigures(1, 'framed')[1], _id: 'framed-copy' };
    expect(framed.name).not.toBe(cutout.name);
    const { host } = scene([cutout, framed]);
    const arts = () => Object.fromEntries(figureButtons(host).map((b) => [b.getAttribute('aria-label'), b.dataset.art]));
    expect(arts()).toEqual({ [cutout.name]: 'cutout', [framed.name]: 'framed' });
    fireEvent.error(host.querySelector('img.cab-figure__art--cutout')!);
    await waitFor(() => expect(arts()).toEqual({ [cutout.name]: 'plate', [framed.name]: 'framed' }));
    fireEvent.error(host.querySelector('.cab-figure__frame img')!);
    await waitFor(() => expect(arts()).toEqual({ [cutout.name]: 'plate', [framed.name]: 'plate' }));
    expect(host.querySelectorAll('.cab-figure img')).toHaveLength(0);
  });

  it("a contact band from the image list places the shadow under the figure's real base", async () => {
    const at = (centerXFrac: number) => (f: Figure) => ({ url: `/c/${f._id}.png`, maskUrl: `/m/${f._id}.png`, bottomMarginFrac: 0.1, contactBand: { centerXFrac, widthFrac: 0.4 } });
    const shadowOf = async (centerXFrac: number) => {
      const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: at(centerXFrac) });
      await grounded(host);
      return host.querySelector<HTMLElement>('.cab-shadow')!.style.transform;
    };
    const left = await shadowOf(0.2);
    cleanup();
    const right = await shadowOf(0.8);
    const tx = (t: string) => Number(t.replace(/^matrix3d\(/, '').split(',')[12]);
    expect(tx(right)).toBeGreaterThan(tx(left));
  });

  it('grounds each figure with a contact shadow on its surface', () => {
    const { host } = scene(FIXTURE_FIGURES);
    expect(host.querySelectorAll('.cab-shadow')).toHaveLength(FIXTURE_FIGURES.length);
  });

  it('nameplates on the shelf edge only when labels are on', () => {
    expect(scene(FIXTURE_FIGURES).host.querySelectorAll('.cab-plate')).toHaveLength(0);
    cleanup();
    const { host } = scene(FIXTURE_FIGURES, {}, { labels: true });
    expect(Array.from(host.querySelectorAll('.cab-plate')).map((p) => p.textContent)).toEqual(FIXTURE_FIGURES.map((f) => f.name));
  });

  it('a nameplate is never wider than its figure: narrow figures (Nendoroids) keep their plates apart', () => {
    const nendo = (i: number, widthMm: number) => ({ _id: `n${i}`, name: `Nendoroid ${i}`, dimensions: { heightMm: 100, widthMm } }) as Figure;
    // labels are on by default for real data; ten 60 mm figures, then one wider than a full plate
    const { host } = scene([...Array.from({ length: 10 }, (_, i) => nendo(i, 60)), nendo(10, 150)], {}, { labels: true });
    const plates = Array.from(host.querySelectorAll<HTMLElement>('.cab-plate')).map((p) => {
      const m = p.style.transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
      const s = pxPerMm(host);
      return { name: p.textContent, x0: m[12] / s, x1: (m[12] + sideMm(p, 'u')) / s, y: m[13], z: m[14] };
    });
    const tap = new Map(figureButtons(host).map((b) => [b.getAttribute('aria-label'), JSON.parse(b.dataset.world!) as { x0: number; x1: number }]));
    expect(plates).toHaveLength(11);
    const rows = new Map<string, typeof plates>();
    for (const p of plates) rows.set(`${p.y}:${p.z}`, [...(rows.get(`${p.y}:${p.z}`) ?? []), p]);
    let pairs = 0;
    for (const row of rows.values()) {
      row.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < row.length; i++) {
        pairs++;
        expect(row[i].x0, `${row[i - 1].name} / ${row[i].name}`).toBeGreaterThan(row[i - 1].x1);
      }
    }
    expect(pairs).toBeGreaterThan(0);
    // each plate centred under its figure, as wide as the figure (CASE-FB2a: its brass face as wide as the name within it)
    for (const p of plates) {
      const t = tap.get(p.name)!;
      expect((p.x0 + p.x1) / 2, p.name!).toBeCloseTo((t.x0 + t.x1) / 2, 6);
      expect(p.x1 - p.x0, p.name!).toBeCloseTo(p.name === 'Nendoroid 10' ? 150 : 60, 6);
    }
  });
});

describe('CabinetScene: taps and the CC4 swipe toggle', () => {
  it('a tap opens the figure (onSelect with its list index)', () => {
    const { host, onSelect } = scene(FIXTURE_FIGURES);
    fireEvent.click(figureButtons(host)[3]);
    expect(onSelect).toHaveBeenCalledWith(FIXTURE_FIGURES[3], 3);
  });

  it('camera mode: a sideways drag walks the camera along the wall, and the click after it opens nothing', () => {
    const many = getFixtureFigures(8);
    const { host, onSelect } = scene(many, { swipe: 'camera', view: 'cabinet' });
    const x0 = Number(host.dataset.cameraX);
    drag(host, -150);
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    expect(host.dataset.pan).toBe('0');
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    // the next tap, without a drag, opens
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('camera mode, wall view: a walk settles on a stop where three cabinets or more stand whole (Ross 12:1xC, desk MN2 a); the cabinet view walks as the finger says', () => {
    const many = getFixtureFigures(60);
    const wallOf = (host: HTMLElement) => (JSON.parse(host.dataset.wall!) as number[][]).map(([x0, x1]) => (x0 + x1) / 2);
    for (const frame of [{ width: 443, height: 454 }, { width: 870, height: 400 }]) {
      const { host } = scene(many, { swipe: 'camera', view: 'wall' }, { frameFallback: frame });
      const centres = wallOf(host);
      const stops = centres.flatMap((x, i) => (i + 1 < centres.length ? [x, (x + centres[i + 1]) / 2] : [x]));
      let x0 = Number(host.dataset.cameraX);
      for (let k = 0; k < 4; k++) {
        // past the dead zone (a quarter of a cabinet, at least 40 px: NOTE 30)
        drag(host, -80);
        const camera = cameraOf(host);
        expect(camera.x, `${frame.width} ${k}`).toBeGreaterThan(x0);
        expect(stops.some((x) => Math.abs(x - camera.x) < 1e-6), `${camera.x}`).toBe(true);
        const lookY = unprojectToPlaneZ(camera, frame.width / 2, frame.height / 2, 0)![1];
        // whole: the body (the box less its splayed feet), side to side at the height the frame aims at
        const whole = (JSON.parse(host.dataset.wall!) as number[][]).filter(([b0, b1]) => {
          const feet = (b1 - b0 - IKEA_KLINGSBO.outer.widthMm) / 2;
          return [b0 + feet, b1 - feet].every((x) => {
            const p = project(camera, [x, lookY, 0]).x;
            return p >= 0 && p <= frame.width;
          });
        });
        expect(whole.length, `${frame.width} ${k}`).toBeGreaterThanOrEqual(3);
        x0 = camera.x;
      }
      cleanup();
    }
    const { host } = scene(many, { swipe: 'camera', view: 'cabinet' }, { frameFallback: { width: 443, height: 454 } });
    const before = cameraOf(host);
    drag(host, -40);
    expect(Number(host.dataset.cameraX)).toBeCloseTo(before.x + (40 * before.z) / before.focalPx, 6);
  });

  it('camera mode, wall view (NOTE 30): a drag short of the dead zone, or one that comes back near its start, settles back; it is still a swipe, not a tap', () => {
    const { host, onSelect } = scene(getFixtureFigures(60), { swipe: 'camera', view: 'wall' }, { frameFallback: { width: 443, height: 454 } });
    const x0 = host.dataset.cameraX;
    drag(host, -30);
    expect(host.dataset.cameraX).toBe(x0);
    expect(host.dataset.focus).toBe('0');
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    // out a long way and back to 10 px from where it started
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 100, clientY: 200 });
    expect(host.dataset.cameraX).not.toBe(x0);
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 290, clientY: 200 });
    fireEvent.pointerUp(host, { pointerId: 1, clientX: 290, clientY: 200 });
    expect(host.dataset.cameraX).toBe(x0);
    drag(host, -80);
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(Number(x0));
  });

  it('pan mode: a sideways drag slides the drawn wall like a photo; the camera stays', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, { swipe: 'pan', view: 'cabinet' });
    const x0 = host.dataset.cameraX;
    drag(host, -150);
    expect(host.dataset.cameraX).toBe(x0);
    expect(Number(host.dataset.pan)).toBeLessThan(0);
  });

  it('pan mode, wall view (NOTE 31): two swipes in on the open-rotated panel settle the photo where three cabinets stand whole', () => {
    const frame = { width: 657, height: 473 };
    const { host } = scene(getFixtureFigures(120), { swipe: 'pan', view: 'wall' }, { frameFallback: frame });
    const wall = klingsbos((JSON.parse(host.dataset.wall!) as number[][]).length);
    // a drag short of the dead zone leaves the photo where it was
    drag(host, -30);
    expect(host.dataset.pan).toBe('0');
    for (let k = 0; k < 2; k++) drag(host, -400);
    const camera = cameraOf(host);
    const pan = Number(host.dataset.pan);
    expect(pan).toBeLessThan(0);
    const lookY = unprojectToPlaneZ(camera, frame.width / 2, frame.height / 2, 0)![1];
    const whole = wall.cabinets.filter((slot) =>
      [slot.leftMm, slot.rightMm].every((x) => {
        const p = project(camera, [x, lookY, 0]).x + pan;
        return p >= -0.5 && p <= frame.width + 0.5;
      }),
    );
    expect(whole.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('a cancelled swipe moves nothing; another finger never steers this one', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, { swipe: 'camera', view: 'cabinet' });
    const x0 = host.dataset.cameraX;
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 2, clientX: 40, clientY: 200 });
    expect(host.dataset.cameraX).toBe(x0);
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 60, clientY: 200 });
    expect(host.dataset.cameraX).not.toBe(x0);
    fireEvent.pointerCancel(host, { pointerId: 1, clientX: 60, clientY: 200 });
    expect(host.dataset.cameraX).toBe(x0);
    expect(host.dataset.focus).toBe('0');
  });

  it(`a move under ${SWIPE_START_PX} px is still a tap`, () => {
    const { host, onSelect } = scene(FIXTURE_FIGURES);
    drag(host, SWIPE_START_PX - 1);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('CabinetScene: views and navigation', () => {
  it('starts on the view kept per device, and steps cabinet by cabinet', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, { view: 'cabinet' });
    expect(host.dataset.view).toBe('cabinet');
    expect(host.dataset.focus).toBe('0');
    expect(screen.getByRole('button', { name: 'Previous cabinet' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
    expect(host.dataset.focus).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Previous cabinet' }));
    expect(host.dataset.focus).toBe('0');
  });

  it('the wall view steps a page of cabinets at a time', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, { view: 'wall' }, { frameFallback: { width: 360, height: 480 } });
    expect(host.dataset.focus).toBe('0');
    expect(screen.getByRole('button', { name: 'Previous cabinet' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
    // two cabinets a page at this width: the next page starts at the third, never the second
    expect(host.dataset.focus).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous cabinet' }));
    expect(host.dataset.focus).toBe('0');
  });

  it('the shelf view steps shelf by shelf, top first', () => {
    const { host } = scene(FIXTURE_FIGURES, { view: 'shelf' });
    expect(host.dataset.shelf).toBe('0');
    expect(screen.getByRole('button', { name: 'Shelf above' })).toBeDisabled();
    const top = cameraOf(host).y;
    fireEvent.click(screen.getByRole('button', { name: 'Shelf below' }));
    expect(host.dataset.shelf).toBe('1');
    // and the camera goes down with it
    expect(cameraOf(host).y).toBeLessThan(top);
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Shelf below' }));
    expect(host.dataset.shelf).toBe('6');
    expect(screen.getByRole('button', { name: 'Shelf below' })).toBeDisabled();
  });

  it('a long wall draws only the cabinets the camera can see, in either swipe mode', () => {
    // about 1,200 figures: some hundred cabinets along the wall
    const lots = getFixtureFigures(170);
    for (const swipe of ['camera', 'pan'] as const) {
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        const { host } = scene(lots, { swipe, view });
        const drawn = host.querySelectorAll('.cab').length;
        expect(drawn, `${swipe} ${view}`).toBeGreaterThan(0);
        expect(drawn, `${swipe} ${view}`).toBeLessThanOrEqual(8);
        expect(figureButtons(host).length, `${swipe} ${view}`).toBeLessThanOrEqual(8 * 16);
        cleanup();
      }
    }
  });

  it('pan mode: the cabinets the slid picture brings into view are drawn', () => {
    const lots = getFixtureFigures(40);
    const { host } = scene(lots, { swipe: 'pan', view: 'cabinet' });
    const before = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    drag(host, -2000);
    const after = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    expect(Number(host.dataset.pan)).toBeLessThan(0);
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
  });

  it('pan mode: however far a long wall is panned, a bounded handful of cabinets is drawn, and its far end comes into view', () => {
    // about 1,200 figures, the whole wall view; ten swipes of 800 px, then on to the wall's end (MOB-NAV-1)
    const lots = getFixtureFigures(170);
    const { host } = scene(lots, { swipe: 'pan', view: 'wall' });
    const atRest = host.querySelectorAll('.cab').length;
    const x0 = Number(host.dataset.cameraX);
    const slid: number[] = [];
    for (let i = 0; i < 10; i++) {
      drag(host, -800);
      slid.push(Number(host.dataset.pan));
      // the unbounded photo drew 39 cabinets here at -8000 px
      expect(host.querySelectorAll('.cab').length, `after ${i + 1} swipes`).toBeLessThanOrEqual(atRest * 2);
    }
    // the picture slides no farther than a frame's worth; the rest of the swipes walk the photo's camera along
    expect(Math.min(...slid)).toBeGreaterThan(-1000);
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    // on to the wall's end: every pan stops at it
    drag(host, -100_000);
    const shown = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    expect(shown.length).toBeLessThanOrEqual(atRest * 2);
    cleanup();
    // the wall's last cabinet: where the walking camera stops
    const walker = scene(lots, { swipe: 'camera', view: 'wall' }).host;
    drag(walker, -1_000_000);
    const last = Math.max(...Array.from(walker.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
    expect(last).toBeGreaterThan(50);
    expect(Math.max(...shown)).toBe(last);
  }, 20_000);

  it('pan mode, panned past the slide: the scene is drawn from the walked camera it reports, never the one it walked from', () => {
    const { host } = scene(getFixtureFigures(170), { swipe: 'pan', view: 'wall' });
    const x0 = Number(host.dataset.cameraX);
    for (let i = 0; i < 6; i++) drag(host, -800);
    const camera = cameraOf(host);
    // the photo was retaken farther along the wall
    expect(camera.x).toBeGreaterThan(x0 + 1000);
    // the root's transform is that camera at the scene's px per mm
    const numbers = (t: string) => t.replace(/translate3d|rotateX/g, '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
    const drawn = numbers(host.querySelector<HTMLElement>('.cabinet-scene__root')!.style.transform);
    const want = numbers(cssSceneTransform(camera, pxPerMm(host)));
    expect(drawn).toHaveLength(want.length);
    drawn.forEach((v, i) => expect(v, `term ${i}`).toBeCloseTo(want[i], 2));
  }, 20_000);

  it('with nothing to show it still stands one empty cabinet', () => {
    const { host } = scene([]);
    expect(host.querySelectorAll('.cab')).toHaveLength(1);
    expect(figureButtons(host)).toHaveLength(0);
  });
});

describe('CabinetScene: the scene is the space its page gives it, and the camera frames that space', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets no height of its own: the page sizes it (CSS), so it follows whatever comes or goes above it', () => {
    const { host } = scene(FIXTURE_FIGURES);
    expect(host.style.height).toBe('');
  });

  it('close-out 4, ruling 33: never scrolls sideways or down under its picture: it clips what overflows (no scroll box), and a scroll that gets in anyway is put back at once', () => {
    const { host } = scene(getFixtureFigures(30), { view: 'wall' });
    expect(getComputedStyle(host).overflow).toBe('clip');
    host.scrollLeft = 202;
    host.scrollTop = 40;
    fireEvent.scroll(host);
    expect([host.scrollLeft, host.scrollTop]).toEqual([0, 0]);
  });

  it('re-frames the camera when the scene itself is resized (a banner or chips row above it), not only the window', () => {
    const observed: { callback: () => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets: Element[] = [];
        constructor(callback: () => void) {
          observed.push({ callback, targets: this.targets });
        }
        observe(el: Element) {
          this.targets.push(el);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    let size = { width: 616, height: 181 };
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cabinet-scene') ? size.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cabinet-scene') ? size.height : 0;
    });
    const { host } = scene(FIXTURE_FIGURES, { view: 'cabinet' });
    const camera = () => JSON.parse(host.dataset.camera!) as { width: number; height: number; z: number };
    expect(camera()).toMatchObject({ width: 616, height: 181 });
    const before = camera().z;
    // the offline banner comes in above: the page gives the scene 38 px less, the window keeps its size
    size = { width: 616, height: 143 };
    const watching = observed.filter((o) => o.targets.includes(host));
    expect(watching).toHaveLength(1);
    act(() => watching[0].callback());
    expect(camera()).toMatchObject({ width: 616, height: 143 });
    // the cabinet still has to fit the shorter frame: the camera steps back
    expect(camera().z).toBeGreaterThan(before);
  });
});

describe('CabinetScene: will it fit (FIT-CHECK)', () => {
  // taller than any place: the top's room less 2 in (587.6 mm) and the tallest tier (the KLINGSBO with its four glass shelves out, 1351 mm)
  const tall = { ...FIXTURE_FIGURES[0], _id: 'tall', name: 'Tall Statue', dimensions: { heightMm: 1500 } } as Figure;
  // deeper than any place is wide or deep, turned or not (the top takes 450 x 400)
  const deep = { ...FIXTURE_FIGURES[1], _id: 'deep', name: 'Deep Diorama', dimensions: { heightMm: 200, depthMm: 520 } } as Figure;

  // MISFIT-CHIP-1: the flag is a chip; its list opens on a tap
  const openFit = (host: HTMLElement) => {
    fireEvent.click(host.querySelector('.cabinet-scene__misfit') as HTMLElement);
    return host.querySelector('.cabinet-scene__fit') as HTMLElement;
  };

  it('flags figures that fit nowhere in the active profile, never drawing them', () => {
    const { host } = scene([...FIXTURE_FIGURES, tall, deep]);
    const fit = openFit(host);
    expect(fit.dataset.count).toBe('2');
    expect(fit.textContent).toContain('Tall Statue');
    expect(fit.textContent).toContain('too tall');
    expect(fit.textContent).toContain('Deep Diorama');
    expect(fit.textContent).toContain('too deep');
    expect(fit.textContent).toContain('IKEA KLINGSBO');
    expect(figureButtons(host).map((b) => b.getAttribute('aria-label'))).not.toContain('Tall Statue');
  });

  it('says what was measured and from what: the reason, the size and where it came from, the most any place takes, and the wall (CASE-FB3b)', () => {
    const { host } = scene([...FIXTURE_FIGURES, tall, deep]);
    openFit(host);
    const lines = Array.from(host.querySelectorAll('.cabinet-scene__fit li'), (li) => li.textContent);
    expect(lines).toContain('Tall Statue: too tall: 1500 mm, labeled; the most any place takes is 1351 mm, for the IKEA KLINGSBO glass-door cabinet');
    expect(lines).toContain('Deep Diorama: too deep: 520 mm, labeled; the deepest place takes 400 mm, for the IKEA KLINGSBO glass-door cabinet');
  });

  it('a wall of several cabinets names none of them: this wall', () => {
    const giant = { ...FIXTURE_FIGURES[0], _id: 'giant', name: 'Giant', dimensions: { heightMm: 2400 } } as Figure;
    const { host } = scene([...FIXTURE_FIGURES, giant], { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' });
    openFit(host);
    const line = host.querySelector('.cabinet-scene__fit li')!.textContent!;
    expect(line).toMatch(/^Giant: too tall: 2400 mm, labeled; the most any place takes is [\d.]+ mm, for this wall$/);
  });

  it('one misfit reads in the singular', () => {
    const fit = openFit(scene([...FIXTURE_FIGURES, tall]).host);
    expect(fit.querySelector('.cabinet-scene__fit-title')?.textContent).toBe('1 figure does not fit');
  });

  it('a figure deeper than the shelf it lands on is drawn overhanging and listed', () => {
    // deeper than the KLINGSBO's glass plates (314 mm), not its floor or open shelf (335 mm): the packer fills top first, so the plates' share overhangs
    const deepish = Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_FIGURES[2], _id: `deepish-${i}`, name: `Deepish ${i}`, dimensions: { heightMm: 150, depthMm: 330 } }) as Figure);
    const { host } = scene(deepish);
    const over = host.querySelectorAll('.cab-figure--overhang');
    expect(over.length).toBeGreaterThan(0);
    const fit = openFit(host);
    expect(fit.dataset.count).toBe(String(over.length));
    expect(fit.textContent).toContain('too deep for its shelf, it overhangs');
  });

  it('no flag when everything fits', () => {
    const { host } = scene(FIXTURE_FIGURES);
    expect(host.querySelector('.cabinet-scene__fit')).toBeNull();
    expect(host.querySelector('.cabinet-scene__misfit')).toBeNull();
  });
});

interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  surface: number;
}

/** Neighbours on one surface, left to right, as their tap boxes (data-world) and their picture boxes (data-art-box). */
function bySurface(host: HTMLElement) {
  const rows = figureButtons(host).map((b) => ({
    name: b.getAttribute('aria-label')!,
    tap: JSON.parse(b.dataset.world!) as WorldBox,
    art: JSON.parse(b.dataset.artBox!) as WorldBox,
    button: b,
  }));
  const groups = new Map<number, typeof rows>();
  for (const r of rows) groups.set(r.tap.surface, [...(groups.get(r.tap.surface) ?? []), r]);
  return [...groups.values()].map((g) => g.sort((a, b) => a.tap.x0 - b.tap.x0));
}

describe('CabinetScene: one figure, one tap box (CASE-FIX dead tap)', () => {
  // masked art whose transparent margin is a third of the picture: the pictures overlap their neighbours' margins
  const marginRef = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800, bottomMarginFrac: 0.3 });

  /** Every mask as the canvas reads it: drawn from top to bottom, but for a fifth of its width clear at the left and at the right. */
  function masksClearAtTheSides() {
    const [w, h] = [20, 20];
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 4; x < 16; x++) data[(y * w + x) * 4 + 3] = 255;
    (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = () => Promise.resolve();
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(w);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(h);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {}, getImageData: () => ({ width: w, height: h, data }) } as unknown as CanvasRenderingContext2D);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it("neighbours' tap boxes never overlap, even where their pictures' transparent margins do", async () => {
    masksClearAtTheSides();
    const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: marginRef });
    await grounded(host);
    let artOverlaps = 0;
    for (const row of bySurface(host)) {
      for (let i = 1; i < row.length; i++) {
        if (row[i].art.x0 < row[i - 1].art.x1) artOverlaps++;
        expect(row[i].tap.x0, `${row[i - 1].name} / ${row[i].name}`).toBeGreaterThanOrEqual(row[i - 1].tap.x1 - 1e-6);
      }
    }
    // the case under test: some pictures do reach over their neighbours
    expect(artOverlaps).toBeGreaterThan(0);
  });

  it('the tap box is the figure standing on its surface, inside its picture; the picture never takes a tap', async () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: marginRef });
    await grounded(host);
    for (const row of bySurface(host)) {
      for (const r of row) {
        expect(r.tap.y0).toBe(r.tap.surface);
        expect(r.tap.y1).toBeCloseTo(r.art.y1, 6);
        expect(r.art.y0).toBeLessThan(r.tap.surface);
        expect(r.tap.x0).toBeGreaterThanOrEqual(r.art.x0 - 1e-6);
        expect(r.tap.x1).toBeLessThanOrEqual(r.art.x1 + 1e-6);
        const box = r.button.querySelector<HTMLElement>('.cab-figure__box')!;
        expect(box.style.pointerEvents).toBe('none');
        // the picture box sits in the button's own px (the scene's px per mm), centred on it, hanging below it by the margin
        const s = pxPerMm(host);
        expect(parseFloat(box.style.width) / s).toBeCloseTo(r.art.x1 - r.art.x0, 3);
        expect(parseFloat(box.style.height) / s).toBeCloseTo(r.art.y1 - r.art.y0, 3);
        expect(parseFloat(box.style.left) / s).toBeCloseTo(r.art.x0 - r.tap.x0, 3);
        expect(parseFloat(r.button.style.width) / s).toBeCloseTo(r.tap.x1 - r.tap.x0, 3);
        expect(parseFloat(r.button.style.height) / s).toBeCloseTo(r.tap.y1 - r.tap.y0, 3);
      }
    }
  });

  it('a picture of its own shape is packed by that shape: framed copies never overlap', () => {
    // the image list says the picture is twice as wide as it is tall, wider than the display meta's guess
    const wide = (f: Figure) => ({ url: `/clean/${f._id}.png`, width: 2000, height: 1000 });
    const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: wide });
    let pairs = 0;
    for (const row of bySurface(host)) {
      for (let i = 1; i < row.length; i++) {
        pairs++;
        expect(row[i].art.x0, `${row[i - 1].name} / ${row[i].name}`).toBeGreaterThanOrEqual(row[i - 1].art.x1 - 1e-6);
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe('CabinetScene: opaque boxes (framed copies, plates) on real figures with a labelled width', () => {
  // a real synced figure: a plain picture (no display meta) or none, its labelled height and width (ProductCard)
  const framed = (i: number): Figure => ({ _id: `r${i}`, name: `Real ${i}`, imageUrl: `https://img.example/r${i}.jpg`, dimensions: { heightMm: 230, widthMm: 100 } }) as Figure;
  const plate = (i: number): Figure => ({ _id: `p${i}`, name: `Plate ${i}`, dimensions: { heightMm: 230, widthMm: 100 } }) as Figure;

  for (const [kind, make] of [['framed', framed], ['plate', plate]] as const) {
    it(`${kind}: the drawn box never reaches over a neighbour (packed 100 mm wide, drawn no wider)`, () => {
      const { host } = scene(Array.from({ length: 12 }, (_, i) => make(i)));
      let pairs = 0;
      for (const row of bySurface(host)) {
        for (let i = 1; i < row.length; i++) {
          pairs++;
          expect(row[i].button.dataset.art).toBe(kind);
          expect(row[i].art.x0, `${row[i - 1].name} / ${row[i].name}`).toBeGreaterThanOrEqual(row[i - 1].art.x1 - 1e-6);
        }
      }
      expect(pairs).toBeGreaterThan(0);
    });
  }
});

/** The scene's published camera (data-camera). */
function cameraOf(host: HTMLElement): Camera {
  const c = JSON.parse(host.dataset.camera!);
  return { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
}

/** The default wall: KLINGSBOs side by side, as many as asked. */
const klingsbos = (n: number) => wallLayout(Array.from({ length: n }, () => IKEA_KLINGSBO));

describe('CabinetScene: where a walk, the wall ends and a change of view leave the camera', () => {
  it('camera mode: after a walk the focus is the cabinet nearest the camera, and Next steps on from there', () => {
    // some thirty cabinets: the walk never reaches the end of the wall
    const { host } = scene(getFixtureFigures(120), { swipe: 'camera', view: 'cabinet' });
    const wall = klingsbos(60);
    for (const dx of [-400, -400, -250]) {
      drag(host, dx);
      const x = Number(host.dataset.cameraX);
      const nearest = wall.cabinets.reduce((best, c, i) => (Math.abs(c.centerMm - x) < Math.abs(wall.cabinets[best].centerMm - x) ? i : best), 0);
      expect(nearest).toBeGreaterThan(0);
      expect(host.dataset.focus, `camera at ${x}`).toBe(String(nearest));
    }
    const focus = Number(host.dataset.focus);
    expect(screen.getByRole('button', { name: 'Next cabinet' })).not.toBeDisabled();
    tap(screen.getByRole('button', { name: 'Next cabinet' }));
    expect(host.dataset.focus).toBe(String(focus + 1));
    expect(Number(host.dataset.cameraX)).toBeCloseTo(wall.cabinets[focus + 1].centerMm, 6);
  });

  /** The mixed wall at a frame: its host, and the cabinets whose body stands whole side to side at the height the frame aims at. */
  const mixedWall = (frame: { width: number; height: number }) => {
    const { host } = scene(getFixtureFigures(30), { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack', view: 'wall', swipe: 'camera' }, { frameFallback: frame });
    const n = (JSON.parse(host.dataset.wall!) as number[][]).length;
    expect(n).toBeGreaterThan(8);
    const wall = wallLayout(Array.from({ length: n }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    const whole = () => {
      const camera = cameraOf(host);
      const lookY = unprojectToPlaneZ(camera, frame.width / 2, frame.height / 2, 0)![1];
      return wall.cabinets.flatMap((slot, i) =>
        [slot.leftMm, slot.rightMm].every((x) => {
          const p = project(camera, [x, lookY, 0]).x;
          return p >= -1e-6 && p <= frame.width + 1e-6;
        })
          ? [i]
          : [],
      );
    };
    return { host, n, all: wall.cabinets.map((_, i) => i), whole };
  };
  const FULL_FRAMES = [{ width: 444, height: 487 }, { width: 657, height: 656 }, { width: 443, height: 344 }];

  it('the mixed wall on the full-screen Fold8 frames (close-out 3, ruling 27): Next pages on to the last cabinet, every press moving the camera on, every cabinet whole on its page', () => {
    for (const frame of FULL_FRAMES) {
      const { host, n, all, whole } = mixedWall(frame);
      const at = `${frame.width}x${frame.height}`;
      const paged = new Set(whole());
      const next = screen.getByRole('button', { name: 'Next cabinet' });
      let x = Number(host.dataset.cameraX);
      for (let k = 0; k < n && !(next as HTMLButtonElement).disabled; k++) {
        fireEvent.click(next);
        expect(Number(host.dataset.cameraX), `${at} press ${k}`).toBeGreaterThan(x);
        x = Number(host.dataset.cameraX);
        whole().forEach((i) => paged.add(i));
      }
      expect(next).toBeDisabled();
      expect(whole(), `${at} last page`).toContain(n - 1);
      expect([...paged].sort((a, b) => a - b), `${at} paged`).toEqual(all);
      cleanup();
    }
  }, 60_000);

  it('the mixed wall on the full-screen Fold8 frames (close-out 3, ruling 27): a walk out to the far end and back stands every cabinet whole somewhere', () => {
    for (const frame of FULL_FRAMES) {
      const { host, n, all, whole } = mixedWall(frame);
      const walked = new Set(whole());
      for (const dx of [-100, 100]) {
        for (let k = 0; k < 4 * n; k++) {
          const before = host.dataset.cameraX;
          drag(host, dx);
          if (host.dataset.cameraX === before) break;
          whole().forEach((i) => walked.add(i));
        }
      }
      expect([...walked].sort((a, b) => a - b), `${frame.width}x${frame.height} walked`).toEqual(all);
      cleanup();
    }
  }, 60_000);

  /** The wall x the scene's frame centres on, on the cabinets' front: its camera's, less what the photo is slid. */
  const centreX = (host: HTMLElement) => {
    const camera = cameraOf(host);
    return unprojectToPlaneZ(camera, camera.frame.width / 2 - Number(host.dataset.pan), camera.frame.height / 2, 0)![0];
  };

  it('the mixed wall (close-out 4, ruling 32): after a walk from any page, Next moves the camera on and Prev back, never staying put', () => {
    // the Fold8 cover's frame, where the challenger's walk (70 px) then Next went nowhere; the walk and pager property
    // over every pattern, frame and stop is the unit's (caseFraming.test.ts, ruling 32), the open-rotated panel the e2e's
    for (const frame of [{ width: 443, height: 344 }]) {
      const { host } = mixedWall(frame);
      const next = screen.getByRole('button', { name: 'Next cabinet' }) as HTMLButtonElement;
      const prev = screen.getByRole('button', { name: 'Previous cabinet' }) as HTMLButtonElement;
      let moves = 0;
      let last = false;
      for (let page = 0; page < 40 && !last; page++) {
        const opened = host.dataset.cameraX;
        last = next.disabled;
        for (const dx of [-70, 130]) {
          for (const [button, sign] of [[next, 1], [prev, -1]] as const) {
            drag(host, dx);
            const x = Number(host.dataset.cameraX);
            const at = `${frame.width}x${frame.height} page ${page} walk ${dx} to ${x} focus ${host.dataset.focus}`;
            if (!button.disabled) {
              tap(button);
              expect(Math.sign(Number(host.dataset.cameraX) - x), `${at}: ${button.getAttribute('aria-label')} to ${host.dataset.cameraX}`).toBe(sign);
              moves++;
            }
            // back to this page as it opened: the pages open left to right (a walk within the first page leaves Prev off)
            if (prev.disabled && host.dataset.cameraX !== opened) tap(next);
            while (Number(host.dataset.cameraX) > Number(opened) && !prev.disabled) tap(prev);
            while (Number(host.dataset.cameraX) < Number(opened) && !next.disabled) tap(next);
            expect(host.dataset.cameraX, at).toBe(opened);
          }
        }
        if (!last) tap(next);
      }
      // CF1 (a): the cover's whole panel holds more cabinets a page than its cropped frame did: fewer pages to press through
      expect(moves).toBeGreaterThan(12);
      cleanup();
    }
  }, 180_000);

  it('the pager answers to the settled picture (close-out 4, ruling 32): mid-swipe, out past the far end, Next and Prev hold until the finger lifts', () => {
    for (const swipe of ['camera', 'pan'] as const) {
      const { host } = scene(getFixtureFigures(120), { swipe, view: 'wall' }, { frameFallback: { width: 657, height: 473 } });
      const next = screen.getByRole('button', { name: 'Next cabinet' }) as HTMLButtonElement;
      const prev = screen.getByRole('button', { name: 'Previous cabinet' }) as HTMLButtonElement;
      fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
      fireEvent.pointerMove(host, { pointerId: 1, clientX: -20_000, clientY: 200 });
      // the picture is out past the far end of the first page
      expect(centreX(host), swipe).toBeGreaterThan(5_000);
      expect([next.disabled, prev.disabled], `${swipe} mid-swipe`).toEqual([false, true]);
      fireEvent.pointerUp(host, { pointerId: 1, clientX: -20_000, clientY: 200 });
      expect(prev.disabled, `${swipe} settled`).toBe(false);
      cleanup();
    }
  });

  it('pan mode, wall view (close-out 4, ruling 32): the pager pages from where the pan settled, never back past it', () => {
    for (const frame of [{ width: 657, height: 473 }, { width: 443, height: 344 }]) {
      // (104 copies: 70 KLINGSBOs with CASE-FB2b's shelves out; a wall of 61, 67 or 81 makes the pager miss its last
      // page, as on 086f61c5: a pager unit of its own)
      const { host } = scene(getFixtureFigures(104), { swipe: 'pan', view: 'wall' }, { frameFallback: frame });
      const next = screen.getByRole('button', { name: 'Next cabinet' }) as HTMLButtonElement;
      const prev = screen.getByRole('button', { name: 'Previous cabinet' }) as HTMLButtonElement;
      const at = `${frame.width}x${frame.height}`;
      // a few swipes into the wall, then Next opens a page farther on than the picture stands, and Prev one nearer
      for (let k = 0; k < 3; k++) drag(host, -400);
      const panned = centreX(host);
      expect(Number(host.dataset.pan), at).toBeLessThan(0);
      tap(next);
      expect(host.dataset.pan, at).toBe('0');
      expect(centreX(host), `${at} Next after the pan`).toBeGreaterThan(panned);
      for (let k = 0; k < 3; k++) drag(host, -400);
      const again = centreX(host);
      tap(prev);
      expect(centreX(host), `${at} Prev after the pan`).toBeLessThan(again);
      // panned out to the wall's end, the picture is on the last page: Next has nowhere to go
      for (let k = 0; k < 60; k++) drag(host, -400);
      const end = centreX(host);
      expect(next.disabled, `${at} Next at the end at ${end}`).toBe(true);
      tap(prev);
      expect(centreX(host), `${at} Prev from the end`).toBeLessThan(end);
      cleanup();
    }
  }, 120_000);

  for (const view of ['cabinet', 'shelf'] as const) {
    it(`${view} view: Next is disabled on the last cabinet, Previous on the first`, () => {
      const { host } = scene(getFixtureFigures(8), { view });
      const next = screen.getByRole('button', { name: 'Next cabinet' });
      let steps = 0;
      while (!(next as HTMLButtonElement).disabled && steps < 50) {
        fireEvent.click(next);
        steps++;
      }
      expect(steps).toBeGreaterThan(1);
      expect(next).toBeDisabled();
      expect(host.dataset.focus).toBe(String(steps));
      expect(screen.getByRole('button', { name: 'Previous cabinet' })).not.toBeDisabled();
    });
  }

  it('a new view, wall pattern or swipe mode starts unpanned', () => {
    const figs = getFixtureFigures(40);
    const view = (patch: Partial<CasePrefs>) => <CabinetScene figures={figs} onSelect={vi.fn()} prefs={prefs({ swipe: 'pan', view: 'cabinet', ...patch })} />;
    const { container, rerender } = render(view({}));
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    const panned = () => {
      drag(host, -2000);
      expect(Number(host.dataset.pan)).toBeLessThan(0);
    };
    panned();
    rerender(view({ view: 'shelf' }));
    expect(host.dataset.pan).toBe('0');
    panned();
    rerender(view({ view: 'shelf', pattern: 'ikea-detolf' }));
    expect(host.dataset.pan).toBe('0');
    panned();
    rerender(view({ view: 'shelf', pattern: 'ikea-detolf', swipe: 'camera' }));
    rerender(view({ view: 'shelf', pattern: 'ikea-detolf', swipe: 'pan' }));
    expect(host.dataset.pan).toBe('0');
  });

  it('a touch swipe, which no click follows, never eats the next tap', () => {
    const { host, onSelect } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    drag(host, -150);
    tap(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it(`a move of exactly ${SWIPE_START_PX} px is a swipe: the click after it opens nothing`, () => {
    const { host, onSelect } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    drag(host, -SWIPE_START_PX);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    drag(host, SWIPE_START_PX - 1);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  for (const swipe of ['camera', 'pan'] as const) {
    it(`every cabinet that draws into the frame is drawn when no more than the cap do, and never more than the cap, however far the ${swipe} swipe goes`, () => {
      const wall = klingsbos(60);
      let checked = 0;
      for (const v of ['wall', 'cabinet', 'shelf'] as const) {
        // some thirty cabinets: the first twenty are checked wherever the swipe goes
        const { host } = scene(getFixtureFigures(120), { swipe, view: v });
        for (const dx of [0, -300, -300, -900, 250, -1200]) {
          if (dx !== 0) drag(host, dx);
          const camera = cameraOf(host);
          const pan = Number(host.dataset.pan);
          const drawn = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
          const cap = Number(host.dataset.drawnCap);
          expect(cap, `${v} after ${dx}`).toBeGreaterThanOrEqual(MAX_DRAWN_CABINETS);
          expect(drawn.size, `${v} after ${dx}`).toBeLessThanOrEqual(cap);
          const shows: number[] = [];
          for (let i = 0; i < 20; i++) {
            const b = cabinetBox(wall.cabinets[i], 0);
            const pts = boxCorners(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1).map((c) => project(camera, c));
            if (pts.some((p) => p.depth <= 0)) continue;
            const x0 = Math.min(...pts.map((p) => p.x)) + pan;
            const x1 = Math.max(...pts.map((p) => p.x)) + pan;
            if (x1 > 0 && x0 < camera.frame.width) shows.push(i);
          }
          if (shows.length > cap) continue;
          checked++;
          for (const i of shows) expect(drawn.has(i), `${v} after ${dx}: cabinet ${i}`).toBe(true);
        }
        cleanup();
      }
      expect(checked).toBeGreaterThanOrEqual(8);
    });
  }

  it('the frame never shows the fronts of more cabinets than the case draws, in any view, however far either swipe goes (Ross 12:1xC)', () => {
    const wall = klingsbos(60);
    let checked = 0;
    for (const swipe of ['camera', 'pan'] as const) {
      for (const v of ['wall', 'cabinet', 'shelf'] as const) {
        const { host } = scene(getFixtureFigures(120), { swipe, view: v });
        for (const dx of [0, -300, -300, -900, 250, -1200]) {
          if (dx !== 0) drag(host, dx);
          const camera = cameraOf(host);
          const pan = Number(host.dataset.pan);
          const rect = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
          const drawn = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
          // each cabinet's front, feet to top, splayed feet and all, on the front plane
          const fronts = wall.cabinets.slice(0, 20).flatMap((slot, i) => {
            const b = cabinetBox(slot, 0);
            return trimFace({ camera, panPx: pan }, [b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0], rect) ? [i] : [];
          });
          expect(fronts.length, `${swipe} ${v} after ${dx}: ${fronts.join(',')}`).toBeLessThanOrEqual(Number(host.dataset.drawnCap));
          for (const i of fronts) expect(drawn.has(i), `${swipe} ${v} after ${dx}: cabinet ${i}`).toBe(true);
          checked++;
        }
        cleanup();
      }
    }
    expect(checked).toBe(36);
  }, 60_000);
});

describe('CabinetScene: the picture, its tap box and its shadow, at the edges', () => {
  it('an image list size without a height is not believed: the figure packs by its display shape', () => {
    // no labelled width: the footprint comes from the picture's shape
    const fig = { ...FIXTURE_FIGURES[0], _id: 'no-height', name: 'No Height', imageUrl: '/plain.jpg', dimensions: { heightMm: 230 } } as Figure;
    const { host } = scene([fig], {}, { imageFor: () => ({ url: '/plain.jpg', width: 600 }) });
    expect(figureButtons(host)).toHaveLength(1);
    expect(host.querySelector('.cabinet-scene__fit')).toBeNull();
  });

  it('a picture narrower than its labelled footprint: the tap box is the picture, not the footprint', () => {
    const wide = { ...FIXTURE_FIGURES[0], dimensions: { heightMm: 230, widthMm: 300 } } as Figure;
    const [r] = bySurface(scene([wide]).host).flat();
    expect(r.art.x1 - r.art.x0).toBeLessThan(300);
    expect(r.tap.x1 - r.tap.x0).toBeCloseTo(r.art.x1 - r.art.x0, 6);
  });

  it('a contact shadow is never thinner than 20 mm, nor deeper than the surface it lies on', async () => {
    const thin = { ...FIXTURE_FIGURES[0], _id: 'thin' } as Figure;
    const { host } = scene([thin], {}, { imageFor: () => ({ url: '/c.png', maskUrl: '/m.png', width: 550, height: 800, contactBand: { centerXFrac: 0.5, widthFrac: 0.001 } }) });
    await grounded(host);
    expect(sideMm(host.querySelector<HTMLElement>('.cab-shadow')!, 'u') / pxPerMm(host)).toBeCloseTo(20, 4);
    cleanup();
    // deeper than the KLINGSBO's glass plates (314 mm): it overhangs, its shadow stays on the plate
    const deepish = Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_FIGURES[2], _id: `deepish-${i}`, name: `Deepish ${i}`, dimensions: { heightMm: 150, depthMm: 330 } }) as Figure);
    const deep = scene(deepish).host;
    const over = Array.from(deep.querySelectorAll<HTMLElement>('.cab-figure--overhang'));
    expect(over.length).toBeGreaterThan(0);
    for (const b of over) expect(sideMm(b.previousElementSibling as HTMLElement, 'v') / pxPerMm(deep)).toBeCloseTo(314, 4);
  });
});

describe('quadStyle: one flat face of the mm world as a CSS 3D element', () => {
  it('a front-facing rectangle: its size in px (1 px per mm) and an identity frame at its top-left corner', () => {
    expect(quadStyle([10, 200, -5], [100, 0, 0], [0, -50, 0])).toEqual({
      width: '100px',
      height: '50px',
      transform: 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,-200,-5,1)',
    });
  });

  it('a horizontal face (a shelf top): its local y runs toward the viewer', () => {
    expect(quadStyle([0, 400, -300], [450, 0, 0], [0, 0, 300])).toEqual({
      width: '450px',
      height: '300px',
      transform: 'matrix3d(1,0,0,0,0,0,1,0,0,-1,0,0,0,-400,-300,1)',
    });
  });

  it('a slanted leg keeps its true length; a face with no area draws nothing', () => {
    const leg = quadStyle([0, 155, 0], [33, 0, 0], [-47.5, -155, 50])!;
    expect(parseFloat(leg.height)).toBeCloseTo(Math.hypot(47.5, 155, 50), 6);
    expect(quadStyle([0, 0, 0], [0, 0, 0], [0, 10, 0])).toBeNull();
    expect(quadStyle([0, 0, 0], [10, 0, 0], [0, 0, 0])).toBeNull();
  });
});

/** Where a quad's element point (x, y) px lands in the world, in CSS px (y down): its matrix3d applied. */
function landsAt(transform: string, x: number, y: number): number[] {
  const m = transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
  return [0, 1, 2].map((i) => m[i] * x + m[4 + i] * y + m[12 + i]);
}

const near = (got: number[], want: number[]) => got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 6));

describe('quadStyle on a texel grid (MOB-NAV-1)', () => {
  it('the element is the grid, however large the face; its corners still land on the face', () => {
    const a = [-6000, 0, -850] as const;
    const q = quadStyle(a, [24000, 0, 0], [0, 0, 6500], { u: 64, v: 256 })!;
    expect([q.width, q.height]).toEqual(['64px', '256px']);
    near(landsAt(q.transform, 0, 0), [-6000, 0, -850]);
    near(landsAt(q.transform, 64, 0), [18000, 0, -850]);
    near(landsAt(q.transform, 0, 256), [-6000, 0, 5650]);
    near(landsAt(q.transform, 64, 256), [18000, 0, 5650]);
  });

  it('a slanted face on a grid keeps its true extent; without a grid nothing changes (1 px per mm)', () => {
    const q = quadStyle([0, 155, 0], [33, 0, 0], [-47.5, -155, 50], { u: 8, v: 32 })!;
    near(landsAt(q.transform, 8, 32), [33 - 47.5, -(155 - 155), 50]);
    expect(quadStyle([10, 200, -5], [100, 0, 0], [0, -50, 0], undefined)).toEqual(quadStyle([10, 200, -5], [100, 0, 0], [0, -50, 0]));
    expect(quadStyle([0, 0, 0], [0, 0, 0], [0, 10, 0], { u: 8, v: 8 })).toBeNull();
  });
});

describe("CabinetScene: the room's wall and floor never cost the screen its chrome (MOB-NAV-1)", () => {
  // At 1 px per mm the floor was the wall plus 12 m long and 6.5 m deep: a 1,190-figure wall made a 105 m x 6.5 m
  // element (680 M px, 5 G px at the Fold8's 2.8125), whose tiles ran Chrome's compositor out of tile memory, so
  // it left the header, the collection tabs, the filters and the tab bar undrawn.
  const ROOM_MAX_PX = 64 * 256;
  const area = (q: HTMLElement) => parseFloat(q.style.width) * parseFloat(q.style.height);

  it('the wall and the floor are small elements, the same size for one cabinet and a hundred', () => {
    const sizes: number[][] = [];
    for (const n of [1, 170]) {
      const { host } = scene(getFixtureFigures(n));
      for (const cls of ['room-wall', 'room-floor']) {
        const q = host.querySelector(`.q.${cls}`) as HTMLElement;
        expect(area(q), `${cls} at ${n * 7} figures`).toBeLessThanOrEqual(ROOM_MAX_PX);
        sizes.push([n, area(q)]);
      }
      cleanup();
    }
    expect(sizes.map(([, px]) => px)).toEqual([sizes[0][1], sizes[1][1], sizes[0][1], sizes[1][1]]);
  });

  it('they still stand where they stood: 6 m past each end of the wall, the floor 6.5 m deep, the wall up to the room\'s ceiling (CASE-FB1), cut to what the frame sees', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const ceiling = DEFAULT_CASE_PREFS.ceilingMm;
    const s = pxPerMm(host);
    const wall = wallLayout([IKEA_KLINGSBO]);
    const zBack = -IKEA_KLINGSBO.outer.depthMm - 450;
    const [x0, x1] = [wall.leftMm - 6000, wall.rightMm + 6000];
    const world = (q: HTMLElement, x: number, y: number) => landsAt(q.style.transform, x, y).map((v) => v / s);
    // the styles are written to 1e-6 px, and a room texel is some 200 mm: read back, a corner is good to a hundredth of a mm
    const near = (got: number[], want: number[]) => got.forEach((g, i) => expect(Math.abs(g - want[i])).toBeLessThan(0.01));
    // the whole face lies under the element's background: its corners are where the room's corners were
    const whole = (q: HTMLElement) => {
      const [bw, bh] = q.style.backgroundSize.split(' ').map(parseFloat);
      const [bx, by] = q.style.backgroundPosition.split(' ').map(parseFloat);
      return [world(q, bx, by), world(q, bx + bw, by + bh)];
    };
    const floor = host.querySelector('.q.room-floor') as HTMLElement;
    const [f0, f1] = whole(floor);
    near(f0, [x0, -0, zBack]);
    near(f1, [x1, -0, zBack + 6500]);
    const back = host.querySelector('.q.room-wall') as HTMLElement;
    const [w0, w1] = whole(back);
    near(w0, [x0, -ceiling, zBack]);
    near(w1, [x1, -0, zBack]);
    // the ceiling over the room, as deep as the floor
    const [c0, c1] = whole(host.querySelector('.q.room-ceiling') as HTMLElement);
    near(c0, [x0, -ceiling, zBack]);
    near(c1, [x1, -ceiling, zBack + 6500]);
    // and the element itself, the part drawn, lies inside them
    const [ww, wh] = [parseFloat(back.style.width), parseFloat(back.style.height)];
    for (const [x, y] of [
      [0, 0],
      [ww, wh],
    ]) {
      const [wx, wy] = world(back, x, y);
      expect(wx).toBeGreaterThanOrEqual(x0 - 1e-6);
      expect(wx).toBeLessThanOrEqual(x1 + 1e-6);
      expect(wy).toBeGreaterThanOrEqual(-ceiling - 1e-6);
      expect(wy).toBeLessThanOrEqual(1e-6);
    }
  });
});

describe('CabinetScene: the numbers the e2e checks the drawing against', () => {
  it('publishes its camera and, per figure, the world box it draws and the surface it stands on', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const cam = JSON.parse(host.dataset.camera!);
    expect(Object.keys(cam).sort()).toEqual(['focalPx', 'height', 'pitch', 'width', 'x', 'y', 'z']);
    expect(cam.width).toBe(360);
    for (const b of figureButtons(host)) {
      const w = JSON.parse(b.dataset.world!);
      expect(w.x1).toBeGreaterThan(w.x0);
      expect(w.y1).toBeGreaterThan(w.y0);
      // the base stands on the surface: the box reaches below it only by the picture's transparent margin
      expect(w.y0).toBeLessThanOrEqual(w.surface + 1e-9);
      expect(w.surface - w.y0).toBeLessThan(0.5 * (w.y1 - w.y0));
    }
    const surfaces = new Set(figureButtons(host).map((b) => JSON.parse(b.dataset.world!).surface));
    // the seven fixtures, packed by their labelled widths, stand on the KLINGSBO's top and three of its glass shelves
    expect([...surfaces].sort((a, b) => a - b)).toEqual([969, 1243, 1519, 1800]);
  });

  it('publishes the wall: each cabinet\'s box, feet and body (x0, x1, its height, back and front, mm)', () => {
    const { host } = scene(getFixtureFigures(40));
    const wall = JSON.parse(host.dataset.wall!) as number[][];
    expect(wall.length).toBeGreaterThan(5);
    klingsbos(wall.length).cabinets.forEach((slot, i) => {
      const b = cabinetBox(slot, 0);
      expect(wall[i]).toEqual([b.x0, b.x1, b.y1, b.z0, b.z1]);
    });
  });
});

describe('CabinetScene: the Fold8 tile budget (MOB-NAV-2)', () => {
  // Chrome rasters every face under the scene's perspective at no less than the device pixel ratio per element
  // px, so each face costs its element's width x height (at 2.8125) whatever it shows; the case held some hundred
  // frames of them and the Fold8 ghosted its whole chrome.
  const COVER = { width: 443, height: 344 };
  const OPEN = { width: 870, height: 261 };
  const quads = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.cabinet-scene__root .q'));
  const area = (q: HTMLElement) => parseFloat(q.style.width) * parseFloat(q.style.height);

  for (const [panel, frame] of [
    ['cover', COVER],
    ['open', OPEN],
  ] as const) {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      // the shelf view stands its camera a hand from the shelf: its flat faces, tops and plates seen edge on, cost
      // their texel grid, not their width and depth (13 frames on the cover and 7 open before they did)
      const ceiling = 3;
      it(`some 1,190 figures, the ${view} view on the ${panel} panel: at most its cap of cabinets, every element at most ${ceiling} frames of px`, () => {
        const { host } = scene(getFixtureFigures(170), { view }, { frameFallback: frame });
        const cabs = host.querySelectorAll('.cab').length;
        expect(cabs).toBeGreaterThan(0);
        expect(cabs).toBeLessThanOrEqual(Number(host.dataset.drawnCap));
        expect(host.dataset.drawnCabinets).toBe(String(cabs));
        expect(host.dataset.drawnFigures).toBe(String(figureButtons(host).length));
        expect(figureButtons(host).length).toBeGreaterThan(0);
        const total = quads(host).reduce((a, q) => a + area(q), 0);
        expect(total / (frame.width * frame.height)).toBeLessThanOrEqual(ceiling);
      });
    }
  }

  /** A finger walking the picture in eight steps, each under the re-cull share of the frame, then lifted. */
  function slowDrag(el: HTMLElement, dx: number) {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    for (let k = 1; k <= 8; k++) fireEvent.pointerMove(el, { pointerId: 1, clientX: 300 + (dx * k) / 8, clientY: 200 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300 + dx, clientY: 200 });
  }

  for (const swipe of ['camera', 'pan'] as const) {
    it(`once a ${swipe} swipe settles the case culls for the settled picture: the cap's cabinets nearest its centre`, () => {
      const wall = klingsbos(60);
      // the wall view, and the shelf view, whose five are a cabinet or two framed and the nearest beside them
      for (const view of ['wall', 'shelf'] as const) {
        const { host } = scene(getFixtureFigures(170), { view, swipe }, { frameFallback: COVER });
        for (const [k, dx] of [-400, -130, -257, -61, -400, -333].entries()) {
          const before = `${host.dataset.cameraX} ${host.dataset.pan}`;
          slowDrag(host, dx);
          const at = `${view} swipe ${k}`;
          expect(`${host.dataset.cameraX} ${host.dataset.pan}`, `${at} moved the picture`).not.toBe(before);
          const camera = cameraOf(host);
          const panPx = Number(host.dataset.cullPan);
          expect(Number(host.dataset.cullX), at).toBeCloseTo(camera.x, 3);
          expect(Math.round(panPx), at).toBe(Number(host.dataset.pan));
          const drawn = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
          expect(drawn.sort((a, b) => a - b), at).toEqual(nearestCabinets({ camera, panPx }, wall, [], Number(host.dataset.drawnCap)));
        }
        cleanup();
      }
    }, 60_000);
  }

  for (const swipe of ['camera', 'pan'] as const) {
    it(`while a ${swipe} swipe moves, the cull holds until the picture has moved a quarter frame, and a cabinet drawn keeps its place against a near one`, () => {
      const wall = klingsbos(60);
      let kept = 0;
      // the wall view frames five fronts, every one drawn whatever was drawn before; the shelf view a cabinet or two,
      // the rest of the five chosen among those beside them, where one drawn before keeps its place
      for (const view of ['wall', 'shelf'] as const) {
        const { host } = scene(getFixtureFigures(170), { view, swipe }, { frameFallback: COVER });
        const drawnNow = () => Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)).sort((a, b) => a - b);
        let held = 0;
        let lastCull = host.dataset.cullX!;
        let before = drawnNow();
        fireEvent.pointerDown(host, { pointerId: 1, clientX: 420, clientY: 200, button: 0 });
        for (let k = 1; k <= 120; k++) {
          fireEvent.pointerMove(host, { pointerId: 1, clientX: 420 - 13 * k, clientY: 200 });
          const camera = cameraOf(host);
          const live = { camera, panPx: Number(host.dataset.pan) };
          const cull = { camera: { ...camera, x: Number(host.dataset.cullX) }, panPx: Number(host.dataset.cullPan) };
          // the culled picture is never more than a quarter frame behind the live one
          const lag = Math.abs(camera.x - cull.camera.x) * (camera.focalPx / (camera.z - 0)) + Math.abs(live.panPx - cull.panPx);
          expect(lag, `${view} move ${k}`).toBeLessThan(0.25 * COVER.width + 1);
          if (host.dataset.cullX === lastCull && `${camera.x}` !== lastCull) held++;
          lastCull = host.dataset.cullX!;
          // the drawn five are chosen for the culled picture, the ones drawn before counting nearer
          const now = drawnNow();
          const cap = Number(host.dataset.drawnCap);
          expect(now, `${view} move ${k}`).toEqual(nearestCabinets(cull, wall, before, cap));
          if (JSON.stringify(nearestCabinets(cull, wall, before, cap)) !== JSON.stringify(nearestCabinets(cull, wall, [], cap))) kept++;
          before = now;
        }
        fireEvent.pointerUp(host, { pointerId: 1, clientX: 420 - 13 * 120, clientY: 200 });
        // the cull held across small moves
        expect(held, view).toBeGreaterThan(60);
        cleanup();
      }
      // and somewhere a drawn cabinet kept its place against a nearer one (CF1 a: the cover's whole panel draws its cap of
      // eight; walking, in the wall view, and sliding, in the shelf view, at 13 px a move)
      expect(kept).toBeGreaterThan(0);
    }, 60_000);
  }

  /**
   * G1: per drawn cabinet, by the middle of each figure button's tap box, how many figures it draws; and those whose
   * front stands wholly inside the frame (side to side, at its feet and its top).
   */
  const perCabinet = (host: HTMLElement) => {
    const camera = cameraOf(host);
    const pan = Number(host.dataset.pan);
    const wall = JSON.parse(host.dataset.wall!) as number[][];
    const mids = figureButtons(host).map((b) => {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
      return (w.x0 + w.x1) / 2;
    });
    const drawn = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    const counts = new Map(drawn.map((i) => [i, mids.filter((m) => m > wall[i][0] && m < wall[i][1]).length]));
    const xAt = (x: number, y: number) => project(camera, [x, y, 0]).x + pan;
    const whole = drawn.filter((i) => {
      const [x0, x1, y1] = wall[i];
      return Math.min(xAt(x0, 0), xAt(x0, y1)) >= 0 && Math.max(xAt(x1, 0), xAt(x1, y1)) <= camera.frame.width;
    });
    return { drawn, counts, whole };
  };

  it('a dense wall (some 1,500 small figures) draws at most its figure cap, what its drawn cabinets hold (G1), in every view, walked or panned', () => {
    const small = FIXTURE_FIGURES.filter((f) => f._id === 'fx-spike' || f._id === 'fx-miku-nendo');
    expect(small).toHaveLength(2);
    const dense = Array.from({ length: 1500 }, (_, i) => ({ ...small[i % 2], _id: `dense-${i}` }));
    let most = 0;
    for (const frame of [COVER, OPEN]) {
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        for (const swipe of ['camera', 'pan'] as const) {
          const { host } = scene(dense, { view, swipe }, { frameFallback: frame });
          for (const dx of [0, -400, -400, 300]) {
            if (dx !== 0) drag(host, dx);
            const n = figureButtons(host).length;
            const cap = Number(host.dataset.figureCap);
            expect(n, `${frame.width} ${view} ${swipe} ${dx}`).toBeLessThanOrEqual(cap);
            expect(cap, `${frame.width} ${view} ${swipe} ${dx}`).toBeLessThanOrEqual(DRAWN_FIGURES_LIMIT);
            expect(host.dataset.drawnFigures).toBe(String(n));
            most = Math.max(most, n);
          }
          cleanup();
        }
      }
    }
    // the wall is dense: the case draws far more of it than of an ordinary one
    expect(most).toBeGreaterThan(100);
  }, 60_000);

  // the challenger's frames: the cover's, the open panel's and the sideways cover's scene frames
  const DENSE_FRAMES = [
    { width: 443, height: 454 },
    { width: 870, height: 400 },
    { width: 616, height: 245 },
  ];
  /** One small figure in every slot: 1,500 x fx-spike. */
  const spikeWall = () => {
    const spike = FIXTURE_FIGURES.find((f) => f._id === 'fx-spike')!;
    return Array.from({ length: 1500 }, (_, i) => ({ ...spike, _id: `spike-${i}` }));
  };

  it(`a homogeneous dense wall (1,500 x fx-spike): the figure cap is the drawn cabinets times what one holds, past Ross's ${MAX_DRAWN_FIGURES} at five; no cabinet wholly in the frame drawn empty, or short but for what a board hides (G1)`, () => {
    const dense = spikeWall();
    let most = 0;
    for (const frame of [...DENSE_FRAMES, { width: 870, height: 335 }, { width: 616, height: 217 }]) {
      let holds = 0;
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        for (const swipe of ['camera', 'pan'] as const) {
          const { host } = scene(dense, { view, swipe }, { frameFallback: frame });
          for (const dx of [0, -400, -400, 300]) {
            if (dx !== 0) drag(host, dx);
            const at = `${frame.width}x${frame.height} ${view} ${swipe} ${dx}`;
            const n = figureButtons(host).length;
            const cap = Number(host.dataset.figureCap);
            const { drawn, counts, whole } = perCabinet(host);
            // one fx-spike in every slot: every cabinet but the wall's last holds the same, all drawn in the wall view
            if (view === 'wall') holds = Math.max(holds, ...counts.values());
            expect(cap, at).toBe(drawn.length * holds);
            expect(n, at).toBeLessThanOrEqual(cap);
            expect(host.dataset.drawnFigures).toBe(String(n));
            // short of what it holds only by those a board hides from the camera (data-hidden-figures), never empty
            for (const i of whole) expect(counts.get(i), `${at} cabinet ${i}`).toBeGreaterThan(0);
            const last = JSON.parse(host.dataset.wall!).length - 1;
            if (view === 'wall') for (const i of whole.filter((k) => k < last)) expect(counts.get(i)! + Number(host.dataset.hiddenFigures), `${at} cabinet ${i}`).toBeGreaterThanOrEqual(holds);
            most = Math.max(most, n);
          }
          cleanup();
        }
      }
    }
    expect(most).toBeGreaterThan(MAX_DRAWN_FIGURES);
  }, 240_000);

  it('G1: on the mixed wall each drawn cabinet counts its own kind\'s capacity: the figure cap is their sum, not the drawn cabinets times the fullest kind', () => {
    const dense = spikeWall();
    for (const frame of [{ width: 616, height: 217 }, { width: 870, height: 335 }, { width: 443, height: 418 }]) {
      const { host } = scene(dense, { view: 'wall', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' }, { frameFallback: frame });
      const { drawn, counts } = perCabinet(host);
      const last = JSON.parse(host.dataset.wall!).length - 1;
      // what each kind holds (the pattern's three in turn): the most any drawn cabinet of it shows, the wall's last aside
      const holds = [0, 1, 2].map((k) => Math.max(0, ...drawn.filter((i) => i % 3 === k && i < last).map((i) => counts.get(i)!)));
      expect(new Set(holds).size, `${frame.width}: the three kinds hold different counts`).toBe(3);
      expect(Number(host.dataset.figureCap), `${frame.width}`).toBe(drawn.reduce((n, i) => n + holds[i % 3], 0));
      cleanup();
    }
  }, 60_000);

  it('the figures cost at most their budget of element px wherever the camera stands; the one nearest the frame centre drawn at the scene\'s px per mm, the coarser ones farther out', () => {
    const dense = spikeWall();
    let coarsened = 0;
    for (const frame of DENSE_FRAMES) {
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        const { host } = scene(dense, { view }, { frameFallback: frame });
        for (const dx of [0, -400]) {
          if (dx !== 0) drag(host, dx);
          const at = `${frame.width}x${frame.height} ${view} ${dx}`;
          const s = pxPerMm(host);
          let area = 0;
          let floor = 0;
          let atScene = 0;
          // SHOULD 28: each figure's px per mm against how far its layer's middle draws from the frame centre (byFrameCentre)
          const camera = cameraOf(host);
          const cull = { ...camera, x: Number(host.dataset.cullX) };
          const order: { d: number; k: number }[] = [];
          for (const b of figureButtons(host)) {
            // the figure's layer: its button and the picture hanging from it, in element px
            const art = b.querySelector<HTMLElement>('.cab-figure__box')!;
            const [w, h] = [parseFloat(b.style.width), parseFloat(b.style.height)];
            const [l0, t0, aw0, ah0] = ['left', 'top', 'width', 'height'].map((k) => parseFloat(art.style.getPropertyValue(k)));
            // the picture clipped to the figure in it (inset top right bottom left, % of the box)
            const [it, ir, ib, il] = (/^inset\((.*)\)$/.exec(art.style.clipPath)?.[1].split(' ') ?? ['0%', '0%', '0%', '0%']).map((x) => parseFloat(x) / 100);
            const [l, t, aw, ah] = [l0 + il * aw0, t0 + it * ah0, aw0 * (1 - il - ir), ah0 * (1 - it - ib)];
            // the layer in the world: the tap box and the clipped picture, side to side; the surface to the figure's height
            const tapBox = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; z: number };
            const artBox = JSON.parse(b.dataset.artBox!) as { x0: number; x1: number };
            const artW = artBox.x1 - artBox.x0;
            const mid = project(cull, [(Math.min(tapBox.x0, artBox.x0 + il * artW) + Math.max(tapBox.x1, artBox.x1 - ir * artW)) / 2, (tapBox.y0 + tapBox.y1) / 2, tapBox.z]);
            order.push({ d: Math.hypot(mid.x + Number(host.dataset.cullPan) - frame.width / 2, mid.y - frame.height / 2), k: Number(b.style.getPropertyValue('--s')) });
            const lw = Math.max(w, l + aw) - Math.min(0, l);
            const lh = Math.max(h, t + ah) - Math.min(0, t);
            area += lw * lh;
            // drawn at k px per mm (its own --s): its world size is what the scene's s draws
            const k = Number(b.style.getPropertyValue('--s'));
            expect(k, at).toBeGreaterThan(0);
            expect(k, at).toBeLessThanOrEqual(s);
            expect(Number.isInteger(Math.log2(s / k)), `${at} ${k}`).toBe(true);
            expect(sideMm(b, 'u'), at).toBeCloseTo((w / k) * s, 3);
            floor += (lw / k) * (lh / k) * (1 / 64) ** 2;
            if (k === s) atScene++;
          }
          expect(area, at).toBeLessThanOrEqual(FIGURE_BUDGET_VIEWPORTS * frame.width * frame.height + floor + 1);
          expect(atScene, at).toBeGreaterThan(0);
          // coarser only farther out: every figure drawn coarser than another lies no nearer the frame centre
          const scales = [...new Set(order.map((o) => o.k))].sort((x, y) => y - x);
          for (let j = 1; j < scales.length; j++) {
            const finer = Math.max(...order.filter((o) => o.k === scales[j - 1]).map((o) => o.d));
            const coarser = Math.min(...order.filter((o) => o.k === scales[j]).map((o) => o.d));
            expect(coarser, `${at}: ${scales[j]} px/mm against ${scales[j - 1]}`).toBeGreaterThanOrEqual(finer - 1e-3);
          }
          if (scales.length > 1) coarsened++;
        }
        cleanup();
      }
    }
    // the budget binds: some pictures mix scales
    expect(coarsened).toBeGreaterThan(0);
  }, 120_000);

  it('a nameplate is drawn at its figure\'s px per mm: coarser with it past the budget, the same size in the world', () => {
    let coarse = 0;
    for (const [frame, view] of DENSE_FRAMES.flatMap((f) => (['wall', 'cabinet', 'shelf'] as const).map((v) => [f, v] as const))) {
      const { host } = scene(spikeWall(), { view }, { frameFallback: frame, labels: true });
      // where the camera stands and walked on (CASE-FB2a's one-line plates cost less: at rest the budget may not bind)
      for (const dx of [0, -400]) {
        if (dx !== 0) drag(host, dx);
        const s = pxPerMm(host);
        // each figure's button by its id, read once (G1 draws some 800 plates here: a lookup per plate ran past a minute on CI)
        const byId = new Map(figureButtons(host).map((b) => [b.dataset.figureId, b]));
        for (const plate of Array.from(host.querySelectorAll<HTMLElement>('.cab-plate'))) {
          const b = byId.get(plate.dataset.figureId)!;
          const k = Number(b.style.getPropertyValue('--s'));
          expect(plate.style.getPropertyValue('--s')).toBe(String(k));
          expect(sideMm(plate, 'v')).toBeCloseTo(LABEL_HEIGHT_MM * s, 4);
          expect(parseFloat(plate.style.height)).toBeCloseTo(LABEL_HEIGHT_MM * k, 6);
          if (k < s) coarse++;
        }
      }
      cleanup();
    }
    expect(coarse).toBeGreaterThan(0);
  }, 60_000);

  it('SHOULD 29: with labels on, a name plate is drawn only where its own box draws into the frame and its margin, and the plates spend the figures\' budget with them', () => {
    let culled = 0;
    let plates = 0;
    for (const frame of DENSE_FRAMES) {
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        const { host } = scene(spikeWall(), { view }, { frameFallback: frame, labels: true });
        for (const dx of [0, -400]) {
          if (dx !== 0) drag(host, dx);
          const at = `${frame.width}x${frame.height} ${view} ${dx}`;
          const camera = cameraOf(host);
          const cull = { camera: { ...camera, x: Number(host.dataset.cullX) }, panPx: Number(host.dataset.cullPan) };
          const s = pxPerMm(host);
          let area = 0;
          let floor = 0;
          const layer = (w: number, h: number, k: number) => {
            area += w * h;
            floor += (w / k) * (h / k) * (1 / 64) ** 2;
          };
          for (const b of figureButtons(host)) {
            const art = b.querySelector<HTMLElement>('.cab-figure__box')!;
            const [w, h] = [parseFloat(b.style.width), parseFloat(b.style.height)];
            const [l0, t0, aw0, ah0] = ['left', 'top', 'width', 'height'].map((k) => parseFloat(art.style.getPropertyValue(k)));
            const [it, ir, ib, il] = (/^inset\((.*)\)$/.exec(art.style.clipPath)?.[1].split(' ') ?? ['0%', '0%', '0%', '0%']).map((x) => parseFloat(x) / 100);
            const [l, t, aw, ah] = [l0 + il * aw0, t0 + it * ah0, aw0 * (1 - il - ir), ah0 * (1 - it - ib)];
            layer(Math.max(w, l + aw) - Math.min(0, l), Math.max(h, t + ah) - Math.min(0, t), Number(b.style.getPropertyValue('--s')));
          }
          const drawnPlates = Array.from(host.querySelectorAll<HTMLElement>('.cab-plate'));
          // each figure's button by its id, read once (G1: some 800 plates; a lookup per plate is quadratic)
          const byId = new Map(figureButtons(host).map((b) => [b.dataset.figureId, b]));
          for (const plate of drawnPlates) {
            // its own box: drawn only where it draws into the frame and its margin, and only with its figure
            const w = JSON.parse(plate.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; z: number };
            expect(trimFace(cull, [w.x0, w.y0, w.z], [w.x1 - w.x0, 0, 0], [0, w.y1 - w.y0, 0], cullRect(camera.frame)), at).not.toBeNull();
            const figure = byId.get(plate.dataset.figureId)!;
            expect(figure, at).toBeDefined();
            const k = Number(plate.style.getPropertyValue('--s'));
            expect(k, at).toBe(Number(figure.style.getPropertyValue('--s')));
            layer(parseFloat(plate.style.width), parseFloat(plate.style.height), k);
          }
          plates += drawnPlates.length;
          culled += figureButtons(host).length - drawnPlates.length;
          expect(area, at).toBeLessThanOrEqual(FIGURE_BUDGET_VIEWPORTS * frame.width * frame.height + floor + 1);
          expect(s, at).toBeGreaterThan(0);
        }
        cleanup();
      }
    }
    // plates are drawn, and somewhere a figure is drawn whose plate lies past the frame and its margin
    expect(plates).toBeGreaterThan(0);
    expect(culled).toBeGreaterThan(0);
  }, 120_000);

  it('the px per mm is taken over the room up to the headroom over the tops, where their figures stand', () => {
    // a short frame on a few cabinets: the camera looks down on the tops; the framing aims at the middle of the room
    // up to the headroom, so the room's top is twice the look-at's height
    for (const frame of [
      { width: 300, height: 245 },
      { width: 300, height: 454 },
      { width: 360, height: 245 },
    ]) {
      const { host } = scene(getFixtureFigures(8), { view: 'wall' }, { frameFallback: frame });
      const camera = cameraOf(host);
      // the camera aims at the look-at on the cabinets' front (z = 0), stepped in or not
      const lookY = camera.y - camera.z * Math.tan(camera.pitch);
      expect(lookY * 2, `${frame.width}x${frame.height}: headroom over the 1,800 mm KLINGSBO`).toBeGreaterThan(IKEA_KLINGSBO.outer.heightMm + 100);
      const room = { y0: 0, y1: lookY * 2, z0: -IKEA_KLINGSBO.outer.depthMm, z1: IKEA_KLINGSBO.footprint!.frontOverhangMm };
      expect(pxPerMm(host), `${frame.width}x${frame.height}`).toBeGreaterThanOrEqual(texelScale(camera, room));
      cleanup();
    }
  });

  it('the faces are drawn at the px per mm the screen shows them, and the camera draws them there', () => {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      const { host } = scene(getFixtureFigures(20), { view }, { frameFallback: COVER });
      const camera = cameraOf(host);
      const s = pxPerMm(host);
      // at least what the cabinets' front shows straight ahead, at most 1 (the world's own mm), in quarter octaves
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(Math.min(1, camera.focalPx / project(camera, [camera.x, camera.y, 0]).depth) - 1e-9);
      expect(Math.log2(s) * 4).toBeCloseTo(Math.round(Math.log2(s) * 4), 9);
      const root = host.querySelector<HTMLElement>('.cabinet-scene__root')!;
      const numbers = (t: string) => t.replace(/translate3d|rotateX/g, '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
      const want = numbers(cssSceneTransform(camera, s));
      numbers(root.style.transform).forEach((v, i) => expect(v, `term ${i}`).toBeCloseTo(want[i], 2));
      expect(root.style.getPropertyValue('--s')).toBe(String(s));
      // a figure's element is its world box at its own px per mm (that scale, or whole octaves under it past the figures'
      // budget), its matrix stretching it to that scale
      for (const b of figureButtons(host)) {
        const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
        const k = Number(b.style.getPropertyValue('--s'));
        expect(Number.isInteger(Math.log2(s / k))).toBe(true);
        expect(parseFloat(b.style.width)).toBeCloseTo((w.x1 - w.x0) * k, 4);
        expect(sideMm(b, 'u')).toBeCloseTo((w.x1 - w.x0) * s, 4);
      }
      cleanup();
    }
  });

  for (const [view, swipe] of [
    ['wall', 'camera'],
    ['wall', 'pan'],
    ['shelf', 'camera'],
  ] as const) {
    it(`every face is cut to what the frame and half of it round it see, and no figure lies wholly past it, ${view} view, after ${swipe} swipes`, () => {
      const { host } = scene(getFixtureFigures(170), { view, swipe }, { frameFallback: COVER });
      for (const dx of [0, -300, -300, -900, 250]) {
        if (dx !== 0) drag(host, dx);
        const camera = cameraOf(host);
        const s = pxPerMm(host);
        // the picture the scene last culled for: the camera walked to its x, the photo slid by its pan
        const cull = { camera: { ...camera, x: Number(host.dataset.cullX) }, panPx: Number(host.dataset.cullPan) };
        const rect = cullRect(COVER);
        const world = (q: HTMLElement, x: number, y: number): [number, number, number] => {
          const [wx, wy, wz] = landsAt(q.style.transform, x, y);
          return [wx / s, -wy / s, wz / s];
        };
        let cut = 0;
        for (const q of quads(host)) {
          const [w, h] = [parseFloat(q.style.width), parseFloat(q.style.height)];
          const a = world(q, 0, 0);
          const [pu, pv] = [world(q, w, 0), world(q, 0, h)];
          const u: [number, number, number] = [pu[0] - a[0], pu[1] - a[1], pu[2] - a[2]];
          const v: [number, number, number] = [pv[0] - a[0], pv[1] - a[1], pv[2] - a[2]];
          const label = `${q.className} after ${dx}`;
          if (q.matches('.cab-figure')) {
            // a figure is drawn whole when what it stands in (its footprint or its picture, the wider) shows
            const tap = JSON.parse(q.dataset.world!) as WorldBox & { z: number };
            const art = JSON.parse(q.dataset.artBox!) as WorldBox;
            const wide = Math.max(tap.x1 - tap.x0, art.x1 - art.x0);
            const [x0, x1] = [Math.min(tap.x0, art.x0) - wide, Math.max(tap.x1, art.x1) + wide];
            const [y0, y1] = [Math.min(tap.y0, art.y0), Math.max(tap.y1, art.y1)];
            expect(trimFace(cull, [x0, y0, tap.z], [x1 - x0, 0, 0], [0, y1 - y0, 0], rect), label).not.toBeNull();
            continue;
          }
          if (q.matches('.cab-shadow, .cab-plate')) continue;
          // every other face is already cut to what shows: cutting it again leaves it as it is
          const t = trimFace(cull, a, u, v, rect);
          expect(t, label).not.toBeNull();
          for (const [got, want] of [
            [t!.s0, 0],
            [t!.s1, 1],
            [t!.t0, 0],
            [t!.t1, 1],
          ]) {
            expect(Math.abs(got - want), label).toBeLessThan(1e-4);
          }
          if (q.style.backgroundSize) cut++;
        }
        // and some faces were cut on the way
        if (dx === 0) expect(cut, 'faces cut').toBeGreaterThan(0);
      }
    });
  }

  it("a face cut at the margin keeps its picture where it was: the room's gradient is laid on the whole face", () => {
    const { host } = scene(getFixtureFigures(170), { view: 'wall' }, { frameFallback: COVER });
    const floor = host.querySelector<HTMLElement>('.q.room-floor')!;
    const [w, h] = [parseFloat(floor.style.width), parseFloat(floor.style.height)];
    const [bw, bh] = floor.style.backgroundSize.split(' ').map(parseFloat);
    const [bx, by] = floor.style.backgroundPosition.split(' ').map(parseFloat);
    // the element is a window onto the whole face: the background spans the face, the window inside it
    expect(bw).toBeGreaterThan(w);
    expect(bx).toBeLessThanOrEqual(0);
    expect(bx + bw).toBeGreaterThanOrEqual(w - 1e-6);
    expect(by).toBeLessThanOrEqual(0);
    expect(by + bh).toBeGreaterThanOrEqual(h - 1e-6);
    // a face the frame holds whole is not cut and carries no window
    const door = host.querySelectorAll<HTMLElement>('.q.cab-pane--door');
    expect(Array.from(door).some((d) => d.style.backgroundSize === '')).toBe(true);
  });

  it('publishes how many figures a board hid; none it draws is one the boards hide from its camera', () => {
    const { host } = scene(getFixtureFigures(6), { view: 'cabinet', pattern: 'open-steel-rack' }, { frameFallback: COVER });
    expect(host.dataset.hiddenFigures).toMatch(/^\d+$/);
    const camera = cameraOf(host);
    const boards = opaqueBoards(wallLayout([OPEN_STEEL_RACK]).cabinets[0]);
    expect(boards.length).toBeGreaterThan(0);
    for (const b of figureButtons(host)) {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; z: number };
      const corners: [number, number, number][] = [
        [w.x0, w.y0, w.z],
        [w.x1, w.y0, w.z],
        [w.x0, w.y1, w.z],
        [w.x1, w.y1, w.z],
      ];
      for (const board of boards) expect(hiddenUnder(camera, corners, board), b.getAttribute('aria-label')!).toBe(false);
    }
  });

  it('CC13 glass: each pane is its four edges, clear between them', () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { frameFallback: COVER });
    const s = pxPerMm(host);
    const door = Array.from(host.querySelectorAll<HTMLElement>('.q.cab-pane--door'));
    expect(door).toHaveLength(4);
    // two edges along the door's width, two up its height, each 1 mm across: flat colour, each on the flat texel grid
    const sides = door.map((q) => {
      expect([parseFloat(q.style.width), parseFloat(q.style.height)]).toEqual([FLAT_GRID.u, FLAT_GRID.v]);
      const a = landsAt(q.style.transform, 0, 0);
      const u = landsAt(q.style.transform, FLAT_GRID.u, 0).map((x, i) => (x - a[i]) / s);
      const v = landsAt(q.style.transform, 0, FLAT_GRID.v).map((x, i) => (x - a[i]) / s);
      return [Math.hypot(...u), Math.hypot(...v)].sort((x, y) => x - y);
    });
    for (const [thin] of sides) expect(thin).toBeCloseTo(1, 4);
    const slot = wallLayout([IKEA_KLINGSBO]).cabinets[0];
    expect(sides.filter(([, long]) => Math.abs(long - (slot.rightMm - slot.leftMm)) < 1e-3)).toHaveLength(2);
    expect(host.querySelectorAll('.q.cab-pane')).toHaveLength(16);
  });

  it('a face of one flat colour (steel, wood, rods, glass edges and fills) costs the flat texel grid; a gradient (shadows, rack boards) a small one', () => {
    const FLAT = '.m-steel, .m-wood, .m-rod, .m-glass-edge, .m-glass-plate, .m-glass-rim, .m-glass-top, .cab-pane';
    const GRADIENT = '.cab-shadow, .m-board';
    for (const pattern of ['ikea-klingsbo', 'ikea-detolf', 'open-steel-rack'] as const) {
      for (const view of ['wall', 'cabinet', 'shelf'] as const) {
        const { host } = scene(getFixtureFigures(30), { view, pattern }, { frameFallback: COVER });
        const flat = quads(host).filter((q) => q.matches(FLAT));
        const gradient = quads(host).filter((q) => q.matches(GRADIENT));
        expect(flat.length, `${pattern} ${view}`).toBeGreaterThan(10);
        for (const q of flat) expect([parseFloat(q.style.width), parseFloat(q.style.height)], `${pattern} ${view} ${q.className}`).toEqual([FLAT_GRID.u, FLAT_GRID.v]);
        for (const q of gradient) expect([parseFloat(q.style.width), parseFloat(q.style.height)], `${pattern} ${view} ${q.className}`).toEqual([GRADIENT_GRID.u, GRADIENT_GRID.v]);
        cleanup();
      }
    }
    expect(FLAT_GRID.u * FLAT_GRID.v).toBeLessThanOrEqual(16);
    expect(GRADIENT_GRID.u * GRADIENT_GRID.v).toBeLessThanOrEqual(256);
  });

  it('a glass shelf is its clear fill and a lit rim 2 mm wide, as its inset edge drew; the glass top a steel rim 3 mm wide', () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { frameFallback: COVER });
    const s = pxPerMm(host);
    const cab = host.querySelector('.cab')!;
    const widths = (sel: string) =>
      Array.from(cab.querySelectorAll<HTMLElement>(sel)).map((q) => {
        const a = landsAt(q.style.transform, 0, 0);
        const u = landsAt(q.style.transform, parseFloat(q.style.width), 0).map((x, i) => (x - a[i]) / s);
        const v = landsAt(q.style.transform, 0, parseFloat(q.style.height)).map((x, i) => (x - a[i]) / s);
        return Math.min(Math.hypot(...u), Math.hypot(...v));
      });
    // four glass shelves and the glass floor: a fill each and four rim edges
    expect(cab.querySelectorAll('.q.m-glass-plate')).toHaveLength(5);
    const rims = widths('.cab-shelf .q.m-glass-rim');
    expect(rims).toHaveLength(20);
    for (const w of rims) expect(w).toBeCloseTo(2, 4);
    const top = widths('.cab-top .q.m-steel.f-rim');
    expect(top).toHaveLength(4);
    for (const w of top) expect(w).toBeCloseTo(3, 4);
    // the rim lies 0.3 mm over the glass, off its plane; its four edges meet at the corners without overlapping
    const shelf = cab.querySelector('.cab-shelf--glass')!;
    const y = (q: Element) => -landsAt((q as HTMLElement).style.transform, 0, 0)[1] / s;
    const fill = shelf.querySelector('.q.m-glass-plate')!;
    const rim = Array.from(shelf.querySelectorAll<HTMLElement>('.q.m-glass-rim'));
    for (const q of rim) expect(y(q) - y(fill)).toBeCloseTo(0.3, 4);
    const area = rim.reduce((sum, q) => {
      const a = landsAt(q.style.transform, 0, 0);
      const u = landsAt(q.style.transform, parseFloat(q.style.width), 0).map((x, i) => (x - a[i]) / s);
      const v = landsAt(q.style.transform, 0, parseFloat(q.style.height)).map((x, i) => (x - a[i]) / s);
      return sum + Math.hypot(...u) * Math.hypot(...v);
    }, 0);
    const plate = IKEA_KLINGSBO.plate!;
    expect(area).toBeCloseTo(plate.widthMm * plate.depthMm - (plate.widthMm - 4) * (plate.depthMm - 4), 1);
  });

  it('the step buttons draw no box over the whole scene: their row is no box of its own', () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { frameFallback: COVER });
    const nav = host.querySelector<HTMLElement>('.cabinet-scene__nav')!;
    expect(getComputedStyle(nav).display).toBe('contents');
    // the buttons still stand at the scene's edges
    expect(getComputedStyle(host.querySelector('.cabinet-scene__step--prev')!).position).toBe('absolute');
  });
});

describe('CASE-FB1: the drawn frame, the room under its ceiling, and the up/down drag', () => {
  const cam = (host: HTMLElement) => JSON.parse(host.dataset.camera!) as { x: number; y: number; z: number; pitch: number; focalPx: number; width: number; height: number };

  /** A one-finger drag by (dx, dy), in steps, then lifted (or cancelled). */
  function drag2(el: HTMLElement, dx: number, dy: number, end: 'up' | 'cancel' = 'up') {
    fireEvent.pointerDown(el, { pointerId: 7, clientX: 200, clientY: 200, button: 0 });
    for (let k = 1; k <= 4; k++) fireEvent.pointerMove(el, { pointerId: 7, clientX: 200 + (dx * k) / 4, clientY: 200 + (dy * k) / 4 });
    if (end === 'up') fireEvent.pointerUp(el, { pointerId: 7, clientX: 200 + dx, clientY: 200 + dy });
    else fireEvent.pointerCancel(el, { pointerId: 7, clientX: 200 + dx, clientY: 200 + dy });
  }

  it('the picture is drawn in the camera\'s frame, centred: cropped on a panel past the cap\'s limit, the whole panel on a tall one', () => {
    const wide = scene(getFixtureFigures(170), { view: 'wall' }, { frameFallback: { width: 1536, height: 200 } });
    const c = cam(wide.host);
    const el = wide.host.querySelector('.cabinet-scene__frame') as HTMLElement;
    expect(wide.host.dataset.drawnCap).toBe(String(DRAWN_CABINETS_LIMIT));
    expect(c.width).toBeLessThan(1536);
    expect(c.height).toBe(200);
    expect(el.style.width).toBe(`${c.width}px`);
    expect(el.style.left).toBe(`${(1536 - c.width) / 2}px`);
    cleanup();
    const tall = scene(getFixtureFigures(60), { view: 'wall' }, { frameFallback: { width: 412, height: 701 } });
    expect(cam(tall.host).width).toBe(412);
    expect((tall.host.querySelector('.cabinet-scene__frame') as HTMLElement).style.left).toBe('0px');
  });

  it('publishes its room: the ceiling the View card sets, and the back wall', () => {
    const { host } = scene(FIXTURE_FIGURES, { ceilingMm: 3048 });
    expect(JSON.parse(host.dataset.room!)).toEqual({ ceilingMm: 3048, zBack: -IKEA_KLINGSBO.outer.depthMm - 450 });
  });

  it('camera mode: a drag down raises the camera and its aim, nothing else; it keeps that height through a walk', () => {
    const { host } = scene(getFixtureFigures(60), { swipe: 'camera', view: 'cabinet' }, { frameFallback: { width: 443, height: 418 } });
    const before = cam(host);
    drag2(host, 3, 60);
    const up = cam(host);
    expect(up.y).toBeGreaterThan(before.y + 10);
    expect({ ...up, y: before.y }).toEqual(before);
    expect(host.dataset.panY).toBe('0');
    // a sideways walk keeps the height
    drag2(host, -200, 5);
    const walked = cam(host);
    expect(walked.x).toBeGreaterThan(up.x);
    expect(walked.y).toBe(up.y);
    // never past the ceiling, however far it is dragged
    for (let k = 0; k < 10; k++) drag2(host, 0, 400);
    expect(cam(host).y).toBeLessThanOrEqual(DEFAULT_CASE_PREFS.ceilingMm + 1e-6);
    // and never below the floor
    for (let k = 0; k < 20; k++) drag2(host, 0, -400);
    expect(cam(host).y).toBeGreaterThanOrEqual(-1e-6);
  }, 30_000);

  it('camera mode: a cancelled drag puts the camera back; a short one (under the swipe start) is no drag', () => {
    const { host } = scene(FIXTURE_FIGURES, { swipe: 'camera', view: 'cabinet' });
    const before = cam(host);
    drag2(host, 0, 60, 'cancel');
    expect(cam(host)).toEqual(before);
    drag2(host, 0, SWIPE_START_PX - 1);
    expect(cam(host)).toEqual(before);
  });

  it('pan mode: a drag down slides the photo down to the ceiling, never past it, and back up no farther than it opened', () => {
    const { host } = scene(FIXTURE_FIGURES, { swipe: 'pan', view: 'cabinet' });
    const before = cam(host);
    drag2(host, 0, 30);
    expect(Number(host.dataset.panY)).toBe(30);
    expect(cam(host)).toEqual(before);
    expect(host.dataset.pan).toBe('0');
    const viewport = host.querySelector('.cabinet-scene__viewport') as HTMLElement;
    expect(viewport.style.transform).toBe('translate(0px, 30px)');
    for (let k = 0; k < 10; k++) drag2(host, 0, 400);
    const top = Number(host.dataset.panY);
    expect(top).toBeGreaterThan(30);
    const c = cam(host);
    const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
    expect(project(camera, [c.x, DEFAULT_CASE_PREFS.ceilingMm, 0]).y + top).toBeCloseTo(0, 0);
    for (let k = 0; k < 10; k++) drag2(host, 0, -400);
    expect(host.dataset.panY).toBe('0');
    expect(viewport.style.transform).toBe('');
  }, 30_000);

  it('camera mode, while the finger is still down: the camera rises live, the photo never slides', () => {
    // a ceiling far overhead: a photo could slide a long way, were it slid
    const { host } = scene(FIXTURE_FIGURES, { swipe: 'camera', view: 'cabinet', ceilingMm: 9000 });
    const before = cam(host);
    fireEvent.pointerDown(host, { pointerId: 9, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 9, clientX: 200, clientY: 260 });
    expect(cam(host).y).toBeGreaterThan(before.y);
    expect(host.dataset.panY).toBe('0');
    expect((host.querySelector('.cabinet-scene__viewport') as HTMLElement).style.transform).toBe('');
    fireEvent.pointerUp(host, { pointerId: 9, clientX: 200, clientY: 260 });
  });

  it('pan mode: what the photo slides out of the frame and its margin is no longer drawn', () => {
    // a ceiling far overhead: the photo slides down until the cabinets are far below the frame
    const { host } = scene(FIXTURE_FIGURES, { swipe: 'pan', view: 'cabinet', ceilingMm: 9000 });
    expect(Number(host.dataset.drawnFigures)).toBeGreaterThan(0);
    for (let k = 0; k < 20; k++) drag2(host, 0, 400);
    expect(Number(host.dataset.panY)).toBeGreaterThan(2 * cam(host).height);
    expect(Number(host.dataset.drawnFigures)).toBe(0);
  }, 30_000);

  it('a drag goes along the axis it first moves farther on: mostly sideways walks, mostly up or down lifts', () => {
    const { host } = scene(getFixtureFigures(60), { swipe: 'camera', view: 'cabinet' }, { frameFallback: { width: 443, height: 418 } });
    const before = cam(host);
    drag2(host, 40, 120);
    expect(cam(host).x).toBe(before.x);
    expect(cam(host).y).toBeGreaterThan(before.y);
    const raised = cam(host);
    drag2(host, -200, 60);
    expect(cam(host).x).toBeGreaterThan(raised.x);
    expect(cam(host).y).toBe(raised.y);
  });

  it('a new swipe mode, view or pattern starts from its own framing: the camera back down, the photo unslid', () => {
    const figures = getFixtureFigures(60);
    const utils = render(<CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs({ swipe: 'camera', view: 'cabinet' })} frameFallback={{ width: 443, height: 418 }} />);
    const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
    const opened = cam(host);
    drag2(host, 0, 120);
    expect(cam(host).y).toBeGreaterThan(opened.y);
    // a new view, the swipe still walking the camera: back down
    utils.rerender(<CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs({ swipe: 'camera', view: 'wall' })} frameFallback={{ width: 443, height: 418 }} />);
    expect(cam(host).y).toBe(opened.y);
    drag2(host, 0, 120);
    expect(cam(host).y).toBeGreaterThan(opened.y);
    utils.rerender(<CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs({ swipe: 'pan', view: 'cabinet' })} frameFallback={{ width: 443, height: 418 }} />);
    expect(cam(host).y).toBe(opened.y);
    drag2(host, 0, 40);
    expect(Number(host.dataset.panY)).toBeGreaterThan(0);
    utils.rerender(<CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs({ swipe: 'pan', view: 'wall' })} frameFallback={{ width: 443, height: 418 }} />);
    expect(host.dataset.panY).toBe('0');
  }, 30_000);
});

describe('CF1 (a): on a wide panel the scene draws more cabinets, so the full-height wall spans it', () => {
  const FOLD8 = [
    { width: 443, height: 418 },
    { width: 616, height: 217 },
    { width: 870, height: 335 },
    { width: 657, height: 547 },
  ];
  for (const frame of FOLD8) {
    it(`the KLINGSBO wall at ${frame.width}x${frame.height}: its cap published, as many cabinets drawn as the frame shows fronts, the frame the whole panel`, () => {
      const { host } = scene(getFixtureFigures(170), { view: 'wall' }, { frameFallback: frame });
      const cam = JSON.parse(host.dataset.camera!);
      const wall = wallLayout(JSON.parse(host.dataset.wall!).map(() => IKEA_KLINGSBO));
      const f = frameCase({ frame, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0 });
      const cap = Number(host.dataset.drawnCap);
      expect(cap).toBe(f.drawCap);
      expect(cap).toBeGreaterThan(MAX_DRAWN_CABINETS);
      // G2: never cropped on a Fold8 panel
      expect([cam.width, cam.height]).toEqual([frame.width, frame.height]);
      // every cabinet whose front the frame shows is drawn
      const camera: Camera = { x: cam.x, y: cam.y, z: cam.z, pitch: cam.pitch, focalPx: cam.focalPx, frame: { width: cam.width, height: cam.height } };
      const rect = { x0: 0, x1: cam.width, y0: 0, y1: cam.height };
      const fronts = wall.cabinets.flatMap((slot, i) => {
        const b = cabinetBox(slot, 0);
        return trimFace({ camera, panPx: 0 }, [b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0], rect) ? [i] : [];
      });
      const drawn = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
      // as the case opens the frame shows the fronts of up to the cap (raised, at most the cap): every one drawn, and the
      // cap's worth drawn on a wall this long
      expect(fronts.length).toBeGreaterThanOrEqual(MAX_DRAWN_CABINETS);
      expect(fronts.length).toBeLessThanOrEqual(cap);
      for (const i of fronts) expect(drawn).toContain(i);
      expect(drawn.length).toBe(cap);
    });
  }
});

describe('F3 and the drag notes: the scene owns every drag on a touch screen; a drag keeps to its axis', () => {
  /** A one-finger drag by (dx, dy), in steps, then lifted. */
  function drag2(el: HTMLElement, dx: number, dy: number) {
    fireEvent.pointerDown(el, { pointerId: 11, clientX: 200, clientY: 200, button: 0 });
    for (let k = 1; k <= 4; k++) fireEvent.pointerMove(el, { pointerId: 11, clientX: 200 + (dx * k) / 4, clientY: 200 + (dy * k) / 4 });
    fireEvent.pointerUp(el, { pointerId: 11, clientX: 200 + dx, clientY: 200 + dy });
  }

  it('the scene\'s touch-action is none: the browser pans or scrolls nothing under a finger, so an up/down drag reaches it', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const style = Array.from(document.querySelectorAll('style')).map((x) => x.textContent ?? '').join('\n');
    const rule = /\.cabinet-scene\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*none\s*;/);
    expect(getComputedStyle(host).getPropertyValue('touch-action')).toBe('none');
  });

  it('camera mode, while a finger raises or lowers the camera: a cabinet drawn keeps its place against a near one, as in a sideways swipe', () => {
    // the mixed wall in the cabinet view: walked to where a cabinet past one end of those drawn and one at the other
    // stand nearly as near the frame centre, so that raising or lowering the camera would swap them (found from the
    // scene's own camera, by the framing it walks and lifts with)
    const frame = { width: 443, height: 418 };
    const { host } = scene(getFixtureFigures(30), { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack', view: 'cabinet', swipe: 'camera' }, { frameFallback: frame });
    const n = (JSON.parse(host.dataset.wall!) as number[][]).length;
    const wall = wallLayout(Array.from({ length: n }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    const cap = Number(host.dataset.drawnCap);
    const camera0 = cameraOf(host);
    const opened: Framing = { camera: camera0, look: [camera0.x, unprojectToPlaneZ(camera0, frame.width / 2, frame.height / 2, 0)![1], 0], page: [0], drawCap: cap };
    const pick = (camera: Camera, before: readonly number[] = []) => nearestCabinets({ camera, panPx: 0 }, wall, before, cap);
    let found: { dx: number; dy: number; held: number[]; fresh: number[] } | null = null;
    for (let dx = -300; dx >= -1500 && !found; dx--) {
      const walked = swipeCamera(opened, wall, dx);
      const held = pick(walked.camera);
      for (const dy of [150, -150, 80, -80]) {
        const raised = lifted(walked, clampLift(walked, DEFAULT_CASE_PREFS.ceilingMm, liftForDragMm(walked, dy))).camera;
        const fresh = pick(raised);
        if (JSON.stringify(pick(raised, held)) === JSON.stringify(held) && JSON.stringify(fresh) !== JSON.stringify(held)) {
          found = { dx, dy, held, fresh };
          break;
        }
      }
    }
    expect(found, 'a walk where a lift would swap a drawn cabinet').not.toBeNull();
    const { dx, dy, held, fresh } = found!;
    const drawnNow = () => Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)).sort((a, b) => a - b);
    drag(host, dx);
    expect(drawnNow()).toEqual(held);
    const before = cameraOf(host);
    fireEvent.pointerDown(host, { pointerId: 12, clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 12, clientX: 300, clientY: 300 + dy / 2 });
    fireEvent.pointerMove(host, { pointerId: 12, clientX: 300, clientY: 300 + dy });
    expect(cameraOf(host).y).not.toBe(before.y);
    // the fresh pick for the raised camera differs; what is drawn holds
    expect(pick(cameraOf(host))).toEqual(fresh);
    expect(drawnNow()).toEqual(held);
    // once the drag settles the case culls for the settled picture
    fireEvent.pointerUp(host, { pointerId: 12, clientX: 300, clientY: 300 + dy });
    expect(drawnNow()).toEqual(fresh);
  }, 30_000);

  for (const drift of [-40, 40]) {
    it(`pan mode, the cabinet view: a mostly up/down drag drifting ${drift} px sideways slides the photo up or down, never sideways`, () => {
      const { host } = scene(getFixtureFigures(60), { swipe: 'pan', view: 'cabinet' }, { frameFallback: { width: 443, height: 418 } });
      // stand mid-wall first, so a sideways slide either way would show
      fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
      const x0 = host.dataset.cameraX;
      expect(host.dataset.pan).toBe('0');
      drag2(host, drift, 120);
      expect(host.dataset.pan).toBe('0');
      expect(host.dataset.cameraX).toBe(x0);
      expect(Number(host.dataset.panY)).toBeGreaterThan(0);
    });

    it(`camera mode, the cabinet view: a mostly up/down drag drifting ${drift} px sideways lifts the camera, never walks it`, () => {
      const { host } = scene(getFixtureFigures(60), { swipe: 'camera', view: 'cabinet' }, { frameFallback: { width: 443, height: 418 } });
      fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
      const before = JSON.parse(host.dataset.camera!);
      drag2(host, drift, 120);
      const after = JSON.parse(host.dataset.camera!);
      expect(after.x).toBe(before.x);
      expect(after.y).toBeGreaterThan(before.y);
    });
  }
});
