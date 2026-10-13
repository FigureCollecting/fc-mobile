import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act, waitFor } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, SWIPE_START_PX, quadStyle } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { FIXTURE_FIGURES, getFixtureFigures, getFixtureImageRef } from '../../../dev-fixtures/fixtures';
import { IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { CULL_MARGIN, MAX_DRAWN_CABINETS, RECULL_SHARE, hiddenUnder } from '../caseCull';
import { wallLayout } from '../packCabinets';
import { cabinetBox, wallReachMm } from '../caseFraming';
import { CEILING_DEFAULT_MM } from '../cabinetProfile';
import { boxCorners, cssSceneTransform, project, type Camera } from '../caseCamera';
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

const figureButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));

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
      return { name: p.textContent, x0: m[12], x1: m[12] + parseFloat(p.style.width), y: m[13], z: m[14] };
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
    // each plate centred under its figure: as wide as the figure, at most the full 110 mm
    for (const p of plates) {
      const t = tap.get(p.name)!;
      expect((p.x0 + p.x1) / 2, p.name!).toBeCloseTo((t.x0 + t.x1) / 2, 6);
      expect(p.x1 - p.x0, p.name!).toBeCloseTo(p.name === 'Nendoroid 10' ? 110 : 60, 6);
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
    // the root's transform is that camera at 1 px per mm (the scene's scale)
    const numbers = (t: string) => t.replace(/translate3d|rotateX/g, '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
    const drawn = numbers(host.querySelector<HTMLElement>('.cabinet-scene__root')!.style.transform);
    const want = numbers(cssSceneTransform(camera, 1));
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
    it(`every cabinet that draws into the frame is drawn, however far the ${swipe} swipe goes`, () => {
      const wall = klingsbos(60);
      for (const v of ['wall', 'cabinet', 'shelf'] as const) {
        // some thirty cabinets: the first twenty are checked wherever the swipe goes
        const { host } = scene(getFixtureFigures(120), { swipe, view: v });
        for (const dx of [0, -300, -300, -900, 250, -1200]) {
          if (dx !== 0) drag(host, dx);
          const camera = cameraOf(host);
          const pan = Number(host.dataset.pan);
          const drawn = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
          for (let i = 0; i < 20; i++) {
            const b = cabinetBox(wall.cabinets[i], 0);
            const pts = boxCorners(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1).map((c) => project(camera, c));
            if (pts.some((p) => p.depth <= 0)) continue;
            const x0 = Math.min(...pts.map((p) => p.x)) + pan;
            const x1 = Math.max(...pts.map((p) => p.x)) + pan;
            if (x1 > 0 && x0 < camera.frame.width) expect(drawn.has(i), `${v} after ${dx}: cabinet ${i} at ${x0.toFixed(0)}..${x1.toFixed(0)}`).toBe(true);
          }
          // and 600 mm past the frame's reach either side (what hangs past a cabinet's box never pops in), no farther
          const [lo, hi] = wallReachMm(camera, pan, { y0: 0, y1: CEILING_DEFAULT_MM, z0: -IKEA_KLINGSBO.outer.depthMm, z1: IKEA_KLINGSBO.footprint!.frontOverhangMm }, 600);
          for (let i = 0; i < 20; i++) {
            const b = cabinetBox(wall.cabinets[i], 0);
            expect(drawn.has(i), `${v} after ${dx}: cabinet ${i} at ${b.x0}..${b.x1}, reach ${lo.toFixed(0)}..${hi.toFixed(0)}`).toBe(b.x1 >= lo && b.x0 <= hi);
          }
        }
        cleanup();
      }
    });
  }
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
    expect(host.querySelector<HTMLElement>('.cab-shadow')!.style.width).toBe('20px');
    cleanup();
    // deeper than the KLINGSBO's glass plates (314 mm): it overhangs, its shadow stays on the plate
    const deepish = Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_FIGURES[2], _id: `deepish-${i}`, name: `Deepish ${i}`, dimensions: { heightMm: 150, depthMm: 330 } }) as Figure);
    const over = Array.from(scene(deepish).host.querySelectorAll<HTMLElement>('.cab-figure--overhang'));
    expect(over.length).toBeGreaterThan(0);
    for (const b of over) expect((b.previousElementSibling as HTMLElement).style.height).toBe('314px');
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

  it('they still stand where they stood: 6 m past each end of the wall, the floor 6.5 m deep, the wall 3.2 m tall', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const wall = wallLayout([IKEA_KLINGSBO]);
    const zBack = -IKEA_KLINGSBO.outer.depthMm - 450;
    const [x0, x1] = [wall.leftMm - 6000, wall.rightMm + 6000];
    const floor = host.querySelector('.q.room-floor') as HTMLElement;
    const [fw, fh] = [parseFloat(floor.style.width), parseFloat(floor.style.height)];
    near(landsAt(floor.style.transform, 0, 0), [x0, -0, zBack]);
    near(landsAt(floor.style.transform, fw, fh), [x1, -0, zBack + 6500]);
    const back = host.querySelector('.q.room-wall') as HTMLElement;
    const [ww, wh] = [parseFloat(back.style.width), parseFloat(back.style.height)];
    near(landsAt(back.style.transform, 0, 0), [x0, -3200, zBack]);
    near(landsAt(back.style.transform, ww, wh), [x1, -0, zBack]);
  });

  it('the cabinets keep their 1 px per mm: a door pane is its own size in px', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const door = host.querySelector('.q.cab-pane--door') as HTMLElement;
    expect(parseFloat(door.style.width)).toBeGreaterThan(300);
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
});

describe('CabinetScene: the Fold8 tile budget (MOB-NAV-2)', () => {
  // Chrome rasters every face under the scene's perspective at no less than the device pixel ratio per element
  // px, so each face costs its element's width x height (at 2.8125) whatever it shows; the case held some hundred
  // frames of them and the Fold8 ghosted its whole chrome.
  const COVER = { width: 443, height: 344 };
  const OPEN = { width: 870, height: 261 };
  const quads = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.cabinet-scene__root .q'));
  const area = (q: HTMLElement) => parseFloat(q.style.width) * parseFloat(q.style.height);
  const pxPerMm = (host: HTMLElement) => Number(host.dataset.pxPerMm);

  for (const [panel, frame] of [
    ['cover', COVER],
    ['open', OPEN],
  ] as const) {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      it(`some 1,190 figures, the ${view} view on the ${panel} panel: at most five cabinets, every element at most 3 frames of px`, () => {
        const { host } = scene(getFixtureFigures(170), { view }, { frameFallback: frame });
        const cabs = host.querySelectorAll('.cab').length;
        expect(cabs).toBeGreaterThan(0);
        expect(cabs).toBeLessThanOrEqual(MAX_DRAWN_CABINETS);
        expect(host.dataset.drawnCabinets).toBe(String(cabs));
        expect(host.dataset.drawnFigures).toBe(String(figureButtons(host).length));
        expect(figureButtons(host).length).toBeGreaterThan(0);
        const total = quads(host).reduce((a, q) => a + area(q), 0);
        expect(total / (frame.width * frame.height)).toBeLessThanOrEqual(3);
      });
    }
  }

  it('the faces are drawn at the px per mm the screen shows them, and the camera draws them there', () => {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      const { host } = scene(getFixtureFigures(20), { view }, { frameFallback: COVER });
      const camera = cameraOf(host);
      const s = pxPerMm(host);
      // at least what the cabinets' front shows straight ahead, at most 1 (the world's own mm), in half octaves
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(Math.min(1, camera.focalPx / project(camera, [camera.x, camera.y, 0]).depth) - 1e-9);
      expect(Math.log2(s) * 2).toBeCloseTo(Math.round(Math.log2(s) * 2), 9);
      const root = host.querySelector<HTMLElement>('.cabinet-scene__root')!;
      expect(root.style.transform).toBe(cssSceneTransform(camera, s));
      expect(root.style.getPropertyValue('--s')).toBe(String(s));
      // a figure's element is its world box at that scale
      for (const b of figureButtons(host)) {
        const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
        expect(parseFloat(b.style.width)).toBeCloseTo((w.x1 - w.x0) * s, 4);
      }
      cleanup();
    }
  });

  for (const swipe of ['camera', 'pan'] as const) {
    it(`every face is cut to the frame and half of it round it, and no figure lies wholly past it, after ${swipe} swipes`, () => {
      const { host } = scene(getFixtureFigures(170), { view: 'wall', swipe }, { frameFallback: COVER });
      for (const dx of [0, -300, -300, -900, 250]) {
        if (dx !== 0) drag(host, dx);
        const camera = cameraOf(host);
        const pan = Number(host.dataset.pan);
        const s = pxPerMm(host);
        const toScreen = (q: HTMLElement, x: number, y: number) => {
          const [wx, wy, wz] = landsAt(q.style.transform, x, y);
          const p = project(camera, [wx / s, -wy / s, wz / s]);
          return { x: p.x + pan, y: p.y, depth: p.depth };
        };
        // the cull follows the camera a quarter frame behind at most: the frame and a quarter round it, at least, is cut to
        const [mx, my] = [COVER.width, COVER.height].map((d) => d * (CULL_MARGIN + RECULL_SHARE) + 1);
        for (const q of quads(host)) {
          const [w, h] = [parseFloat(q.style.width), parseFloat(q.style.height)];
          const corners = [toScreen(q, 0, 0), toScreen(q, w, 0), toScreen(q, 0, h), toScreen(q, w, h)];
          const label = `${q.className} after ${dx}`;
          if (q.matches('.cab-figure, .cab-shadow, .cab-plate')) {
            const xs = corners.map((c) => c.x);
            expect(Math.max(...xs), label).toBeGreaterThan(-COVER.width * CULL_MARGIN - 1);
            expect(Math.min(...xs), label).toBeLessThan(COVER.width * (1 + CULL_MARGIN) + 1);
            continue;
          }
          for (const c of corners) {
            expect(c.depth, label).toBeGreaterThan(0);
            expect(c.x, label).toBeGreaterThanOrEqual(-mx);
            expect(c.x, label).toBeLessThanOrEqual(COVER.width + mx);
            expect(c.y, label).toBeGreaterThanOrEqual(-my);
            expect(c.y, label).toBeLessThanOrEqual(COVER.height + my);
          }
        }
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

  it('a figure wholly under a board, from where the camera looks down on the rack, is not drawn', () => {
    const { host } = scene(getFixtureFigures(6), { view: 'cabinet', pattern: 'open-steel-rack' }, { frameFallback: { width: 200, height: 1200 } });
    expect(Number(host.dataset.hiddenFigures)).toBeGreaterThan(0);
    const camera = cameraOf(host);
    const boards = OPEN_STEEL_RACK.surfaces.map((s) => ({ y0: s.topMm - s.thicknessMm, y1: s.topMm }));
    // no figure drawn is one the boards hide
    for (const b of figureButtons(host)) {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; z: number };
      const corners: [number, number, number][] = [
        [w.x0, w.y0, w.z],
        [w.x1, w.y0, w.z],
        [w.x0, w.y1, w.z],
        [w.x1, w.y1, w.z],
      ];
      const slot = wallLayout([OPEN_STEEL_RACK]).cabinets[0];
      const post = OPEN_STEEL_RACK.rack!.postMm;
      const D = OPEN_STEEL_RACK.outer.depthMm;
      for (const board of boards) {
        const hidden = hiddenUnder(camera, corners, { x0: slot.leftMm + post / 2, x1: slot.rightMm - post / 2, z0: -D + post / 2, z1: -post / 2, ...board });
        expect(hidden, b.getAttribute('aria-label')!).toBe(false);
      }
    }
  });
});
