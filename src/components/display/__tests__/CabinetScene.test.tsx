import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, SWIPE_START_PX, quadStyle } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { FIXTURE_FIGURES, getFixtureFigures, getFixtureImageRef } from '../../../dev-fixtures/fixtures';

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

const figureButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));

function drag(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 200 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 });
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

  it('never scales figures to the screen: the same figure keeps its size on every frame width', () => {
    const narrow = scene(FIXTURE_FIGURES, {}, { frameFallback: { width: 300, height: 500 } });
    const a = narrow.host.querySelector<HTMLElement>('.cab-figure')!.style.width;
    cleanup();
    const wide = scene(FIXTURE_FIGURES, {}, { frameFallback: { width: 900, height: 480 } });
    expect(wide.host.querySelector<HTMLElement>('.cab-figure')!.style.width).toBe(a);
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

  it("a contact band from the image list places the shadow under the figure's real base", () => {
    const at = (centerXFrac: number) => (f: Figure) => ({ url: `/c/${f._id}.png`, maskUrl: `/m/${f._id}.png`, bottomMarginFrac: 0.1, contactBand: { centerXFrac, widthFrac: 0.4 } });
    const left = scene(FIXTURE_FIGURES, {}, { imageFor: at(0.2) }).host.querySelector<HTMLElement>('.cab-shadow')!.style.transform;
    cleanup();
    const right = scene(FIXTURE_FIGURES, {}, { imageFor: at(0.8) }).host.querySelector<HTMLElement>('.cab-shadow')!.style.transform;
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

  it('pan mode: a sideways drag slides the drawn wall like a photo; the camera stays', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, { swipe: 'pan', view: 'cabinet' });
    const x0 = host.dataset.cameraX;
    drag(host, -150);
    expect(host.dataset.cameraX).toBe(x0);
    expect(Number(host.dataset.pan)).toBeLessThan(0);
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Shelf below' }));
    expect(host.dataset.shelf).toBe('1');
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

  it('with nothing to show it still stands one empty cabinet', () => {
    const { host } = scene([]);
    expect(host.querySelectorAll('.cab')).toHaveLength(1);
    expect(figureButtons(host)).toHaveLength(0);
  });
});

describe('CabinetScene: will it fit (FIT-CHECK)', () => {
  const tall = { ...FIXTURE_FIGURES[0], _id: 'tall', name: 'Tall Statue', dimensions: { heightMm: 700 } } as Figure;
  const deep = { ...FIXTURE_FIGURES[1], _id: 'deep', name: 'Deep Diorama', dimensions: { heightMm: 200, depthMm: 420 } } as Figure;

  it('flags figures that fit nowhere in the active profile, never drawing them', () => {
    const { host } = scene([...FIXTURE_FIGURES, tall, deep]);
    const fit = host.querySelector('.cabinet-scene__fit') as HTMLElement;
    expect(fit.dataset.count).toBe('2');
    expect(fit.textContent).toContain('Tall Statue');
    expect(fit.textContent).toContain('too tall');
    expect(fit.textContent).toContain('Deep Diorama');
    expect(fit.textContent).toContain('too deep');
    expect(fit.textContent).toContain('IKEA KLINGSBO');
    expect(figureButtons(host).map((b) => b.getAttribute('aria-label'))).not.toContain('Tall Statue');
  });

  it('one misfit reads in the singular', () => {
    const fit = scene([...FIXTURE_FIGURES, tall]).host.querySelector('.cabinet-scene__fit') as HTMLElement;
    expect(fit.querySelector('summary')?.textContent).toBe('1 figure does not fit');
  });

  it('a figure deeper than the shelf it lands on is drawn overhanging and listed', () => {
    // deeper than the KLINGSBO's glass plates (314 mm), not its floor or open shelf (335 mm): the packer fills top first, so the plates' share overhangs
    const deepish = Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_FIGURES[2], _id: `deepish-${i}`, name: `Deepish ${i}`, dimensions: { heightMm: 150, depthMm: 330 } }) as Figure);
    const { host } = scene(deepish);
    const over = host.querySelectorAll('.cab-figure--overhang');
    expect(over.length).toBeGreaterThan(0);
    const fit = host.querySelector('.cabinet-scene__fit') as HTMLElement;
    expect(fit.dataset.count).toBe(String(over.length));
    expect(fit.textContent).toContain('too deep for its shelf, it overhangs');
  });

  it('no flag when everything fits', () => {
    expect(scene(FIXTURE_FIGURES).host.querySelector('.cabinet-scene__fit')).toBeNull();
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

  it("neighbours' tap boxes never overlap, even where their pictures' transparent margins do", () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: marginRef });
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

  it('the tap box is the figure standing on its surface, inside its picture; the picture never takes a tap', () => {
    const { host } = scene(FIXTURE_FIGURES, {}, { imageFor: marginRef });
    for (const row of bySurface(host)) {
      for (const r of row) {
        expect(r.tap.y0).toBe(r.tap.surface);
        expect(r.tap.y1).toBeCloseTo(r.art.y1, 6);
        expect(r.art.y0).toBeLessThan(r.tap.surface);
        expect(r.tap.x0).toBeGreaterThanOrEqual(r.art.x0 - 1e-6);
        expect(r.tap.x1).toBeLessThanOrEqual(r.art.x1 + 1e-6);
        const box = r.button.querySelector<HTMLElement>('.cab-figure__box')!;
        expect(box.style.pointerEvents).toBe('none');
        // the picture box sits in the button's own px (1 px per mm), centred on it, hanging below it by the margin
        expect(parseFloat(box.style.width)).toBeCloseTo(r.art.x1 - r.art.x0, 3);
        expect(parseFloat(box.style.height)).toBeCloseTo(r.art.y1 - r.art.y0, 3);
        expect(parseFloat(box.style.left)).toBeCloseTo(r.art.x0 - r.tap.x0, 3);
        expect(parseFloat(r.button.style.width)).toBeCloseTo(r.tap.x1 - r.tap.x0, 3);
        expect(parseFloat(r.button.style.height)).toBeCloseTo(r.tap.y1 - r.tap.y0, 3);
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
    // the seven fixtures stand on the KLINGSBO's top and four of its glass shelves
    expect([...surfaces].sort((a, b) => a - b)).toEqual([694, 969, 1243, 1519, 1800]);
  });
});
