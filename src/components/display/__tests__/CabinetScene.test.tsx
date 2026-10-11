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

  it('no flag when everything fits', () => {
    expect(scene(FIXTURE_FIGURES).host.querySelector('.cabinet-scene__fit')).toBeNull();
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
