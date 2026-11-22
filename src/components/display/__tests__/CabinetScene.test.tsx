import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act, waitFor } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, LABEL_HEIGHT_MM, SWIPE_START_PX, quadStyle } from '../CabinetScene';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, type CasePrefs } from '../casePrefs';
import { FIXTURE_FIGURES, getFixtureFigures, getFixtureImageRef } from '../../../dev-fixtures/fixtures';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { DRAWN_CABINETS_LIMIT, DRAWN_FIGURES_LIMIT, FIGURE_BUDGET_VIEWPORTS, FLAT_GRID, GRADIENT_GRID, MAX_DRAWN_CABINETS, MAX_DRAWN_FIGURES, cullRect, hiddenUnder, nearestCabinets, opaqueBoards, texelScale, trimFace } from '../caseCull';
import { wallLayout } from '../packCabinets';
import { cabinetBox, frameCase } from '../caseFraming';
import { boxCorners, cssSceneTransform, project, unprojectToPlaneZ, type Camera } from '../caseCamera';
import { ALPHA_READS_AT_ONCE, ALPHA_READ_TURN_MS, ALPHA_UNDECODED_RETRY_MS, __clearAlphaMarginCache } from '../alphaMargin';
import { imageKept } from '../../../media/keptImages';

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

/**
 * NAV-SCOPE: where the eye can stand without a gesture: the case's one view (the wall's opening), or the shelf framing Go to
 * stands it at (the camera the old one-shelf view stood at, a hand from a shelf), here for the figure in the middle of the list.
 */
const STANDS = ['wall', 'go to'] as const;
function standAt(figures: Figure[], at: (typeof STANDS)[number], patch: Partial<CasePrefs> = {}, extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const s = scene(figures, patch, extra);
  if (at === 'go to') {
    const goTo = { figureId: figures[Math.floor(figures.length / 2)]._id, seq: 1 };
    s.rerender(<CabinetScene figures={figures} onSelect={s.onSelect} prefs={prefs(patch)} {...extra} goTo={goTo} />);
  }
  return s;
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
    // in the case's arrangement (PACK1: series, then scale, then name): Dark Angel Olivia, too tall for a stock shelf, on
    // the top, read first; then the shelves, Cowboy Bebop to Vocaloid
    expect(figureButtons(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Dark Angel Olivia',
      'Spike Spiegel',
      'Ryuko Matoi',
      'Madoka Kaname',
      'Rem',
      'Nendoroid Hatsune Miku',
      'Hatsune Miku: Deep Sea Girl',
    ]);
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
    const { host } = scene(many, { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' });
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
    // (the case stands them in its arrangement, PACK1: the first drawn is the figure its button names)
    const first = figureButtons(host)[0];
    expect(first.querySelector('img')?.getAttribute('src')).toBe(FIXTURE_FIGURES.find((f) => f.name === first.getAttribute('aria-label'))!.imageUrl);
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
    // one plate per figure, in the order the case stands them (its arrangement, PACK1)
    expect(Array.from(host.querySelectorAll('.cab-plate')).map((p) => p.textContent)).toEqual(figureButtons(host).map((b) => b.getAttribute('aria-label')));
    expect(host.querySelectorAll('.cab-plate')).toHaveLength(FIXTURE_FIGURES.length);
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
      // (to 5e-6 mm: the styles are written to 1e-6 px, and read back over the scene's px per mm)
      expect((p.x0 + p.x1) / 2, p.name!).toBeCloseTo((t.x0 + t.x1) / 2, 5);
      expect(p.x1 - p.x0, p.name!).toBeCloseTo(p.name === 'Nendoroid 10' ? 150 : 60, 5);
    }
  });
});

describe('CabinetScene: taps and the CC4 swipe', () => {
  it('a tap opens the figure (onSelect with its list index)', () => {
    const { host, onSelect } = scene(FIXTURE_FIGURES);
    // (the case stands it where its arrangement does, PACK1; the tap still gives its place in the list)
    fireEvent.click(figureButtons(host).find((b) => b.getAttribute('aria-label') === FIXTURE_FIGURES[3].name)!);
    expect(onSelect).toHaveBeenCalledWith(FIXTURE_FIGURES[3], 3);
  });

  it('a sideways drag walks the camera along the wall, and the click after it opens nothing', () => {
    const many = getFixtureFigures(8);
    const { host, onSelect } = scene(many);
    const x0 = Number(host.dataset.cameraX);
    drag(host, -150);
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    expect(host.hasAttribute('data-pan')).toBe(false);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    // the next tap, without a drag, opens
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('NAV-2A2 (Ross 11-04), NAV-GRAD: no pan mode and no old camera: with Pan the wall and Free camera off stored on this device, or handed it, a one-finger drag moves the Free camera (sideways and up and down); nothing pans', () => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: false, swipe: 'pan', view: 'cabinet' }));
    const stored = readCasePrefs();
    localStorage.clear();
    const handed = { ...DEFAULT_CASE_PREFS, view: 'cabinet', swipe: 'pan', freeCamera: false } as CasePrefs;
    const pans = (host: HTMLElement) => [host.hasAttribute('data-pan'), host.hasAttribute('data-pan-y'), (host.querySelector('.cabinet-scene__viewport') as HTMLElement).style.transform];
    for (const [how, p] of [['stored', stored], ['handed', handed]] as const) {
      const { container, unmount } = render(<CabinetScene figures={getFixtureFigures(8)} onSelect={vi.fn()} prefs={p} />);
      const host = container.querySelector('.cabinet-scene') as HTMLElement;
      expect(host.dataset.freeCamera, how).toBe('1');
      const before = cameraOf(host);
      drag(host, -150);
      expect(cameraOf(host).x, how).toBeGreaterThan(before.x);
      expect(pans(host), how).toEqual([false, false, '']);
      const walked = cameraOf(host);
      fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
      for (const y of [230, 260]) fireEvent.pointerMove(host, { pointerId: 1, clientX: 200, clientY: y });
      fireEvent.pointerUp(host, { pointerId: 1, clientX: 200, clientY: 260 });
      expect(cameraOf(host).y, how).not.toBe(walked.y);
      expect(pans(host), how).toEqual([false, false, '']);
      expect(host.dataset.swipe, how).toBeUndefined();
      unmount();
    }
  });

  it('a cancelled swipe moves nothing, where the same swipe let go moves the camera; another finger never steers this one', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many);
    const x0 = host.dataset.cameraX;
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 2, clientX: 40, clientY: 200 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 60, clientY: 200 });
    fireEvent.pointerCancel(host, { pointerId: 1, clientX: 60, clientY: 200 });
    expect(host.dataset.cameraX).toBe(x0);
    expect(host.dataset.focus).toBe('0');
    // a stray finger's move alone, between a press and its lift, steers nothing
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 2, clientX: 40, clientY: 200 });
    fireEvent.pointerUp(host, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(host.dataset.cameraX).toBe(x0);
    // let go instead of cancelled, the same swipe moves the camera
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 60, clientY: 200 });
    fireEvent.pointerUp(host, { pointerId: 1, clientX: 60, clientY: 200 });
    expect(host.dataset.cameraX).not.toBe(x0);
  });

  it(`a move under ${SWIPE_START_PX} px is still a tap`, () => {
    const { host, onSelect } = scene(FIXTURE_FIGURES);
    drag(host, SWIPE_START_PX - 1);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('CabinetScene: the one view and navigation (NAV-SCOPE)', () => {
  it('opens on the wall at its first cabinet; one finger walks it along (no step keys, no stored view)', () => {
    const many = getFixtureFigures(8);
    const { host } = scene(many, {}, { frameFallback: { width: 360, height: 480 } });
    expect(host.dataset.view).toBeUndefined();
    expect(host.dataset.focus).toBe('0');
    expect(screen.queryByRole('button', { name: 'Next cabinet' })).toBeNull();
    const opening = cameraOf(host).x;
    for (let i = 0; i < 6 && host.dataset.focus === '0'; i++) drag(host, -300);
    expect(Number(host.dataset.focus)).toBeGreaterThan(0);
    expect(cameraOf(host).x).toBeGreaterThan(opening);
  });

  it('a long wall draws only the cabinets the camera can see', () => {
    // about 1,200 figures: some hundred cabinets along the wall
    const lots = getFixtureFigures(170);
    const { host } = scene(lots);
    const drawn = host.querySelectorAll('.cab').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThanOrEqual(8);
    // only the figures of the cabinets drawn (PACK1: the arrangement packs a series' copies close, some 40 to a
    // cabinet, so a count per cabinet bounds nothing)
    const order = JSON.parse(host.dataset.order!) as string[][];
    const held = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).flatMap((c) => order[Number(c.dataset.index)]));
    expect(held.size).toBeLessThan(lots.length / 4);
    for (const b of figureButtons(host)) expect(held.has(b.dataset.figureId!), b.dataset.figureId).toBe(true);
  });

  it('however far the camera walks a long wall, a bounded handful of cabinets is drawn, and its far end comes into view', () => {
    // about 1,200 figures, the whole wall view (MOB-NAV-1); NAV-2A2: the pan half of this test went with the pan mode
    const lots = getFixtureFigures(170);
    const walker = scene(lots).host;
    const atRest = walker.querySelectorAll('.cab').length;
    drag(walker, -1_000_000);
    const shown = Array.from(walker.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    expect(shown.length).toBeLessThanOrEqual(atRest * 2);
    expect(Math.max(...shown)).toBeGreaterThan(50);
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
    const { host } = scene(getFixtureFigures(30));
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
    const { host } = scene(FIXTURE_FIGURES);
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
    // the 1351 mm tier less the 1 in the prefs keep above a figure (CLEAR-1)
    expect(lines).toContain('Tall Statue: too tall: 1500 mm, labeled; the most any place takes is 1325.6 mm, for the IKEA KLINGSBO glass-door cabinet');
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

describe('CabinetScene: where a walk and the wall ends leave the camera', () => {
  it('after a walk the focus is the cabinet nearest the camera', () => {
    // some thirty cabinets: the walk never reaches the end of the wall
    const { host } = scene(getFixtureFigures(120));
    const wall = klingsbos(60);
    for (const dx of [-400, -400, -250]) {
      drag(host, dx);
      const x = Number(host.dataset.cameraX);
      const nearest = wall.cabinets.reduce((best, c, i) => (Math.abs(c.centerMm - x) < Math.abs(wall.cabinets[best].centerMm - x) ? i : best), 0);
      expect(nearest).toBeGreaterThan(0);
      expect(host.dataset.focus, `camera at ${x}`).toBe(String(nearest));
    }
  });

  /** The mixed wall at a frame: its host, and the cabinets whose body stands whole side to side at the height the frame aims at. */
  const mixedWall = (frame: { width: number; height: number }, clearanceMm = 0) => {
    const { host } = scene(getFixtureFigures(30), { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack', clearanceMm }, { frameFallback: frame });
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

  it('a touch swipe, which no click follows, never eats the next tap', () => {
    const { host, onSelect } = scene(getFixtureFigures(8));
    drag(host, -150);
    tap(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it(`a move of exactly ${SWIPE_START_PX} px is a swipe: the click after it opens nothing`, () => {
    const { host, onSelect } = scene(getFixtureFigures(8));
    drag(host, -SWIPE_START_PX);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    drag(host, SWIPE_START_PX - 1);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // With the file's own heavy-test timeout: 15 drags' worth of scene renders cut to 5 (the wall view took 3.4-5.2 s on CI's
  // slower runners against the default 5 s, MISFIT-CHIP-1's CI failure). NAV-SCOPE: the wall's is the case's one view
  it('every cabinet that draws into the frame is drawn when no more than the cap do, and never more than the cap, however far the swipe goes', () => {
    const wall = klingsbos(60);
    let checked = 0;
    // some thirty cabinets: the first twenty are checked wherever the swipe goes
    const { host } = scene(getFixtureFigures(120));
    for (const dx of [0, -300, -300, -900, 250, -1200]) {
      if (dx !== 0) drag(host, dx);
      const camera = cameraOf(host);
      const drawn = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
      const cap = Number(host.dataset.drawnCap);
      expect(cap, `after ${dx}`).toBeGreaterThanOrEqual(MAX_DRAWN_CABINETS);
      expect(drawn.size, `after ${dx}`).toBeLessThanOrEqual(cap);
      const shows: number[] = [];
      for (let i = 0; i < 20; i++) {
        const b = cabinetBox(wall.cabinets[i], 0);
        const pts = boxCorners(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1).map((c) => project(camera, c));
        if (pts.some((p) => p.depth <= 0)) continue;
        const x0 = Math.min(...pts.map((p) => p.x));
        const x1 = Math.max(...pts.map((p) => p.x));
        if (x1 > 0 && x0 < camera.frame.width) shows.push(i);
      }
      if (shows.length > cap) continue;
      checked++;
      for (const i of shows) expect(drawn.has(i), `after ${dx}: cabinet ${i}`).toBe(true);
    }
    // the geometry gives 4-6 positions where the first twenty fit the cap and are checked: never none
    expect(checked).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('the frame never shows the fronts of more cabinets than the case draws, however far the swipe goes (Ross 12:1xC)', () => {
    const wall = klingsbos(60);
    let checked = 0;
    const { host } = scene(getFixtureFigures(120));
    for (const dx of [0, -300, -300, -900, 250, -1200]) {
      if (dx !== 0) drag(host, dx);
      const camera = cameraOf(host);
      const rect = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
      const drawn = new Set(Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)));
      // each cabinet's front, feet to top, splayed feet and all, on the front plane
      const fronts = wall.cabinets.slice(0, 20).flatMap((slot, i) => {
        const b = cabinetBox(slot, 0);
        return trimFace({ camera, panPx: 0 }, [b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0], rect) ? [i] : [];
      });
      expect(fronts.length, `after ${dx}: ${fronts.join(',')}`).toBeLessThanOrEqual(Number(host.dataset.drawnCap));
      for (const i of fronts) expect(drawn.has(i), `after ${dx}: cabinet ${i}`).toBe(true);
      checked++;
    }
    // six places (NAV-2A2: the pan mode's went with it; NAV-SCOPE: the other two views)
    expect(checked).toBe(6);
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
      // (to the hundredth of a mm a corner reads back to, as above)
      expect(wx).toBeGreaterThanOrEqual(x0 - 0.01);
      expect(wx).toBeLessThanOrEqual(x1 + 0.01);
      expect(wy).toBeGreaterThanOrEqual(-ceiling - 0.01);
      expect(wy).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('CabinetScene: the numbers the e2e checks the drawing against', () => {
  it('publishes its camera and, per figure, the world box it draws and the surface it stands on', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const cam = JSON.parse(host.dataset.camera!);
    expect(Object.keys(cam).sort()).toEqual(['focalPx', 'height', 'pitch', 'width', 'x', 'y', 'yaw', 'z']);
    expect([cam.yaw, cam.pitch]).toEqual([0, 0]);
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
    // the seven fixtures, packed by their labelled widths in the case's arrangement (PACK1: a series whole on a shelf), stand
    // on the KLINGSBO's top and four of its glass shelves
    expect([...surfaces].sort((a, b) => a - b)).toEqual([694, 969, 1243, 1519, 1800]);
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
    for (const view of STANDS) {
      // Go to's shelf framing stands its camera a hand from the shelf: its flat faces, tops and plates seen edge on, cost
      // their texel grid, not their width and depth (13 frames on the cover and 7 open before they did)
      const ceiling = 3;
      it(`some 1,190 figures, at the ${view} framing on the ${panel} panel: at most its cap of cabinets, every element at most ${ceiling} frames of px`, () => {
        const { host } = standAt(getFixtureFigures(170), view, {}, { frameFallback: frame });
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

  it(`once a swipe settles the case culls for the settled picture: the cap's cabinets nearest its centre`, () => {
    const wall = klingsbos(60);
    // the wall view, and Go to's shelf framing, whose five are a cabinet or two framed and the nearest beside them
    for (const view of STANDS) {
      const { host } = standAt(getFixtureFigures(170), view, {}, { frameFallback: COVER });
      for (const [k, dx] of [-400, -130, -257, -61, -400, -333].entries()) {
        const before = host.dataset.cameraX;
        slowDrag(host, dx);
        const at = `${view} swipe ${k}`;
        expect(host.dataset.cameraX, `${at} moved the picture`).not.toBe(before);
        const camera = cameraOf(host);
        const panPx = Number(host.dataset.cullPan);
        expect(Number(host.dataset.cullX), at).toBeCloseTo(camera.x, 3);
        // the picture never slides (NAV-GRAD)
        expect(panPx, at).toBe(0);
        const drawn = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
        expect(drawn.sort((a, b) => a - b), at).toEqual(nearestCabinets({ camera, panPx }, wall, [], Number(host.dataset.drawnCap)));
      }
      cleanup();
    }
  }, 60_000);

  /**
   * G1: per drawn cabinet, by the middle of each figure button's tap box, how many figures it draws; and those whose
   * front stands wholly inside the frame (side to side, at its feet and its top).
   */
  const perCabinet = (host: HTMLElement) => {
    const camera = cameraOf(host);
    const wall = JSON.parse(host.dataset.wall!) as number[][];
    const mids = figureButtons(host).map((b) => {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
      return (w.x0 + w.x1) / 2;
    });
    const drawn = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index));
    const counts = new Map(drawn.map((i) => [i, mids.filter((m) => m > wall[i][0] && m < wall[i][1]).length]));
    const xAt = (x: number, y: number) => project(camera, [x, y, 0]).x;
    const whole = drawn.filter((i) => {
      const [x0, x1, y1] = wall[i];
      return Math.min(xAt(x0, 0), xAt(x0, y1)) >= 0 && Math.max(xAt(x1, 0), xAt(x1, y1)) <= camera.frame.width;
    });
    return { drawn, counts, whole };
  };

  it('a dense wall (some 1,500 small figures) draws at most its figure cap, what its drawn cabinets hold (G1), at the wall and at Go to\'s shelf framing, walked or panned', () => {
    const small = FIXTURE_FIGURES.filter((f) => f._id === 'fx-spike' || f._id === 'fx-miku-nendo');
    expect(small).toHaveLength(2);
    const dense = Array.from({ length: 1500 }, (_, i) => ({ ...small[i % 2], _id: `dense-${i}` }));
    let most = 0;
    for (const frame of [COVER, OPEN]) {
      for (const view of STANDS) {
        const { host } = standAt(dense, view, {}, { frameFallback: frame });
        for (const dx of [0, -400, -400, 300]) {
          if (dx !== 0) drag(host, dx);
          const n = figureButtons(host).length;
          const cap = Number(host.dataset.figureCap);
          expect(n, `${frame.width} ${view} ${dx}`).toBeLessThanOrEqual(cap);
          expect(cap, `${frame.width} ${view} ${dx}`).toBeLessThanOrEqual(DRAWN_FIGURES_LIMIT);
          expect(host.dataset.drawnFigures).toBe(String(n));
          most = Math.max(most, n);
        }
        cleanup();
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
      for (const view of STANDS) {
        const { host } = standAt(dense, view, {}, { frameFallback: frame });
        for (const dx of [0, -400, -400, 300]) {
          if (dx !== 0) drag(host, dx);
          const at = `${frame.width}x${frame.height} ${view} ${dx}`;
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
    expect(most).toBeGreaterThan(MAX_DRAWN_FIGURES);
  }, 240_000);

  it('G1: on the mixed wall each drawn cabinet counts its own kind\'s capacity: the figure cap is their sum, not the drawn cabinets times the fullest kind', () => {
    const dense = spikeWall();
    for (const frame of [{ width: 616, height: 217 }, { width: 870, height: 335 }, { width: 443, height: 418 }]) {
      const { host } = scene(dense, { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' }, { frameFallback: frame });
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
      for (const view of STANDS) {
        const { host } = standAt(dense, view, {}, { frameFallback: frame });
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
    for (const [frame, view] of DENSE_FRAMES.flatMap((f) => STANDS.map((v) => [f, v] as const))) {
      const { host } = standAt(spikeWall(), view, {}, { frameFallback: frame, labels: true });
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
      for (const view of STANDS) {
        const { host } = standAt(spikeWall(), view, {}, { frameFallback: frame, labels: true });
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
      const { host } = scene(getFixtureFigures(8), {}, { frameFallback: frame });
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
    for (const view of STANDS) {
      const { host } = standAt(getFixtureFigures(20), view, {}, { frameFallback: COVER });
      const camera = cameraOf(host);
      const s = pxPerMm(host);
      // at least what the cabinets' front shows straight ahead, at most 1 (the world's own mm), in quarter octaves
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(Math.min(1, camera.focalPx / project(camera, [camera.x, camera.y, 0]).depth) - 1e-9);
      expect(Math.log2(s) * 4).toBeCloseTo(Math.round(Math.log2(s) * 4), 9);
      const root = host.querySelector<HTMLElement>('.cabinet-scene__root')!;
      const numbers = (t: string) => t.replace(/translate3d|rotateX|scale3d/g, '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
      // NAV-DEPTH-OCCL: the room's corners (unturned, a corner's depth does not hang on its x): the plane stands past them
      const room = JSON.parse(host.dataset.room!) as { ceilingMm: number; zBack: number };
      const reach = boxCorners(camera.x, camera.x, 0, room.ceilingMm, room.zBack, room.zBack + 6500);
      const want = numbers(cssSceneTransform(camera, s, reach));
      expect(root.style.transform).toMatch(/ scale3d\(/);
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

  for (const view of STANDS) {
    it(`every face is cut to what the frame and half of it round it see, and no figure lies wholly past it, from the ${view} framing, after swipes`, () => {
      const { host } = standAt(getFixtureFigures(170), view, {}, { frameFallback: COVER });
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
    const { host } = scene(getFixtureFigures(170), {}, { frameFallback: COVER });
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
    const { host } = scene(getFixtureFigures(6), { pattern: 'open-steel-rack' }, { frameFallback: COVER });
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
      for (const view of STANDS) {
        const { host } = standAt(getFixtureFigures(30), view, { pattern }, { frameFallback: COVER });
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
    const wide = scene(getFixtureFigures(170), {}, { frameFallback: { width: 1536, height: 200 } });
    const c = cam(wide.host);
    const el = wide.host.querySelector('.cabinet-scene__frame') as HTMLElement;
    expect(wide.host.dataset.drawnCap).toBe(String(DRAWN_CABINETS_LIMIT));
    expect(c.width).toBeLessThan(1536);
    expect(c.height).toBe(200);
    expect(el.style.width).toBe(`${c.width}px`);
    expect(el.style.left).toBe(`${(1536 - c.width) / 2}px`);
    cleanup();
    const tall = scene(getFixtureFigures(60), {}, { frameFallback: { width: 412, height: 701 } });
    expect(cam(tall.host).width).toBe(412);
    expect((tall.host.querySelector('.cabinet-scene__frame') as HTMLElement).style.left).toBe('0px');
  });

  it('publishes its room: the ceiling the View card sets, and the back wall', () => {
    const { host } = scene(FIXTURE_FIGURES, { ceilingMm: 3048 });
    expect(JSON.parse(host.dataset.room!)).toEqual({ ceilingMm: 3048, zBack: -IKEA_KLINGSBO.outer.depthMm - 450 });
  });

  it('a drag down raises the camera, nothing else; it keeps that height through a walk', () => {
    const { host } = scene(getFixtureFigures(60), {}, { frameFallback: { width: 443, height: 418 } });
    const before = cam(host);
    drag2(host, 3, 60);
    const up = cam(host);
    expect(up.y).toBeGreaterThan(before.y + 10);
    expect({ ...up, y: before.y }).toEqual(before);
    expect((host.querySelector('.cabinet-scene__viewport') as HTMLElement).style.transform, 'the picture never slides').toBe('');
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
    const { host } = scene(FIXTURE_FIGURES);
    const before = cam(host);
    drag2(host, 0, 60, 'cancel');
    expect(cam(host)).toEqual(before);
    drag2(host, 0, SWIPE_START_PX - 1);
    expect(cam(host)).toEqual(before);
  });

  it('a new pattern starts from its own framing: the camera back down (NAV-SCOPE: a stale view is no new framing)', () => {
    const figures = getFixtureFigures(60);
    const frame = { width: 443, height: 418 };
    const view = (patch: Partial<CasePrefs>) => <CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs(patch)} frameFallback={frame} />;
    // each pattern's own opening
    const detolfOpen = render(view({ pattern: 'ikea-detolf' }));
    const detolfAt = cam(detolfOpen.container.querySelector('.cabinet-scene') as HTMLElement);
    detolfOpen.unmount();
    const utils = render(view({}));
    const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
    const opened = cam(host);
    expect(opened.z).not.toBe(detolfAt.z);
    drag2(host, 0, 120);
    const raised = cam(host);
    expect(raised.y).toBeGreaterThan(opened.y);
    // a stale view handed in changes nothing
    utils.rerender(view({ view: 'cabinet' } as Partial<CasePrefs>));
    expect(cam(host)).toEqual(raised);
    // a new pattern: back down, to its own opening
    utils.rerender(view({ pattern: 'ikea-detolf' }));
    expect(cam(host)).toEqual(detolfAt);
    drag2(host, 0, 120);
    expect(cam(host).y).toBeGreaterThan(detolfAt.y);
    utils.rerender(view({}));
    expect(cam(host)).toEqual(opened);
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
      const { host } = scene(getFixtureFigures(170), {}, { frameFallback: frame });
      const cam = JSON.parse(host.dataset.camera!);
      const wall = wallLayout(JSON.parse(host.dataset.wall!).map(() => IKEA_KLINGSBO));
      const f = frameCase({ frame, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0, level: true });
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

describe('F3 and the drag notes: the scene owns every drag on a touch screen', () => {
  it('the scene\'s touch-action is none: the browser pans or scrolls nothing under a finger, so an up/down drag reaches it', () => {
    const { host } = scene(FIXTURE_FIGURES);
    const style = Array.from(document.querySelectorAll('style')).map((x) => x.textContent ?? '').join('\n');
    const rule = /\.cabinet-scene\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*none\s*;/);
    expect(getComputedStyle(host).getPropertyValue('touch-action')).toBe('none');
  });

  // the Free camera is level (NAV-1A rulings R0.3), so a lift moves only its height: raising or lowering it never brings a
  // cabinet nearer the middle than another, and the walk found for the tilted camera that swapped two drawn cabinets under
  // a lift no longer exists
  it('while a finger raises or lowers the camera: the cabinets drawn stay as they are, through the drag and after it', () => {
    const frame = { width: 443, height: 418 };
    const { host } = scene(getFixtureFigures(30), { pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' }, { frameFallback: frame });
    const drawnNow = () => Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => Number(c.dataset.index)).sort((a, b) => a - b);
    drag(host, -700);
    const held = drawnNow();
    expect(held.length).toBeGreaterThan(0);
    for (const dy of [150, -150]) {
      const before = cameraOf(host);
      fireEvent.pointerDown(host, { pointerId: 12, clientX: 300, clientY: 300, button: 0 });
      fireEvent.pointerMove(host, { pointerId: 12, clientX: 300, clientY: 300 + dy / 2 });
      fireEvent.pointerMove(host, { pointerId: 12, clientX: 300, clientY: 300 + dy });
      expect(drawnNow()).toEqual(held);
      fireEvent.pointerUp(host, { pointerId: 12, clientX: 300, clientY: 300 + dy });
      // (the pose is published once the finger lifts)
      expect(cameraOf(host).y).not.toBe(before.y);
      expect(cameraOf(host).x).toBe(before.x);
      expect(drawnNow()).toEqual(held);
    }
  }, 30_000);
});

describe('CLEAR-1: the clearance above a figure, from the case prefs, decides where figures stand', () => {
  // a Detolf compartment is 396 mm clear at most. Figures of 385 mm stand in the stock compartments with no clearance or a
  // quarter inch; with 1 in none fits one, and the cabinets take glass shelves out for tiers
  const figs = (h: number, n = 6) => Array.from({ length: n }, (_, i) => ({ ...FIXTURE_FIGURES[0], _id: `f${i}`, name: `F${i}`, dimensions: { heightMm: h, widthMm: 100, depthMm: 80 } }) as Figure);
  const removed = (host: HTMLElement) => (JSON.parse(host.dataset.held!) as [number, number, number[]][]).flatMap((h) => h[2]);

  it('0 and 0.25 in: nothing comes out; 1 in: shelves come out for tiers', () => {
    for (const clearanceMm of [0, 6.35]) {
      expect(removed(scene(figs(385), { pattern: 'ikea-detolf', clearanceMm }).host), `${clearanceMm}`).toEqual([]);
      cleanup();
    }
    expect(removed(scene(figs(385), { pattern: 'ikea-detolf', clearanceMm: 25.4 }).host).length).toBeGreaterThan(0);
  });

  it('the default prefs keep 1 in: the same figures, no pref set, take shelves out', () => {
    expect(removed(scene(figs(385), { pattern: 'ikea-detolf' }).host).length).toBeGreaterThan(0);
  });

  it('a figure 1 mm over the room a quarter inch leaves does not fit a stock compartment at 0.25 in', () => {
    expect(removed(scene(figs(396 - 6.35 + 1), { pattern: 'ikea-detolf', clearanceMm: 6.35 }).host).length).toBeGreaterThan(0);
    cleanup();
    expect(removed(scene(figs(396 - 6.35), { pattern: 'ikea-detolf', clearanceMm: 6.35 }).host)).toEqual([]);
  });
});

// PAN-KEEP-1 (Ross 10-20): Reset view is the way back to the default angle. NAV-2A2 (Ross 11-04): the swipe mode it kept the
// camera across is gone, and the tests of the switch with it.
describe('CabinetScene: Reset view (PAN-KEEP-1)', () => {
  const cam = (host: HTMLElement) => JSON.parse(host.dataset.camera!) as { x: number; y: number; z: number; pitch: number; focalPx: number };
  function drag2(el: HTMLElement, dx: number, dy: number) {
    fireEvent.pointerDown(el, { pointerId: 9, clientX: 200, clientY: 200, button: 0 });
    for (let k = 1; k <= 4; k++) fireEvent.pointerMove(el, { pointerId: 9, clientX: 200 + (dx * k) / 4, clientY: 200 + (dy * k) / 4 });
    fireEvent.pointerUp(el, { pointerId: 9, clientX: 200 + dx, clientY: 200 + dy });
  }
  const resetChip = () => screen.queryByRole('button', { name: 'Reset view' });
  const zoomOf = (host: HTMLElement) => (JSON.parse(host.dataset.zoom!) as { k: number }).k;
  /** Two fingers spread apart: a pinch out, the scene zoomed in. */
  function pinch(host: HTMLElement) {
    fireEvent.pointerDown(host, { pointerId: 11, clientX: 180, clientY: 260, button: 0 });
    fireEvent.pointerDown(host, { pointerId: 12, clientX: 260, clientY: 260, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 11, clientX: 140, clientY: 260 });
    fireEvent.pointerMove(host, { pointerId: 12, clientX: 300, clientY: 260 });
    fireEvent.pointerUp(host, { pointerId: 11, clientX: 140, clientY: 260 });
    fireEvent.pointerUp(host, { pointerId: 12, clientX: 300, clientY: 260 });
  }

  // NAV-SCOPE (plan section 9): Reset view is zoom-only. It shows only while zoomed and clears only the zoom: the camera
  // stays where the walk, the lift or the look left it (the case's one view never moves the eye back on its own)
  it('a zoomed scene: Reset view clears the zoom and leaves the camera where it stands', () => {
    const { container } = render(<CabinetScene figures={getFixtureFigures(40)} onSelect={vi.fn()} prefs={prefs()} frameFallback={{ width: 443, height: 454 }} />);
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    expect(resetChip(), 'nothing to reset unzoomed').toBeNull();
    drag2(host, -300, 0);
    drag2(host, 0, -200);
    const moved = host.dataset.camera;
    expect(resetChip(), 'a walk and a lift are no zoom').toBeNull();
    pinch(host);
    expect(zoomOf(host)).toBeGreaterThan(1);
    // a press first: the click a gesture leaves is swallowed until the next press
    const chip = resetChip()!;
    fireEvent.pointerDown(chip, { pointerId: 3, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(chip, { pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.click(chip);
    expect(zoomOf(host)).toBe(1);
    expect(host.dataset.camera, 'the camera never moved').toBe(moved);
    expect((host.querySelector('.cabinet-scene__viewport') as HTMLElement).style.transform, 'the picture never slid').toBe('');
    expect(resetChip()).toBeNull();
  });

  // NAV-PTR-1 (Ross 10-25: "Reset view appears too easily (and/or too largely)"): small and low; NAV-SCOPE: only zoomed
  describe('NAV-PTR-1, NAV-SCOPE: Reset view shows only while zoomed, small and low', () => {
    const open = (patch: Partial<CasePrefs> = {}) =>
      render(<CabinetScene figures={getFixtureFigures(40)} onSelect={vi.fn()} prefs={prefs(patch)} frameFallback={{ width: 443, height: 454 }} />).container.querySelector(
        '.cabinet-scene',
      ) as HTMLElement;
    const styleText = () => Array.from(document.querySelectorAll('style')).map((x) => x.textContent ?? '').join('\n');

    it('a walk moves the camera and shows no Reset view', () => {
      const host = open();
      const x = host.dataset.cameraX;
      drag2(host, -300, 0);
      expect(host.dataset.cameraX, 'the camera walked').not.toBe(x);
      expect(resetChip()).toBeNull();
    });

    it('a lift, small or far, shows none (the camera is off its opening, not zoomed)', () => {
      const host = open();
      const y = cam(host).y;
      drag2(host, 0, 10);
      expect(cam(host).y, 'the 10 px did raise the camera').not.toBe(y);
      expect(resetChip()).toBeNull();
      drag2(host, 0, 200);
      expect(cam(host).y).toBeGreaterThan(y);
      expect(resetChip()).toBeNull();
    });

    it('zoomed: Reset view shows', () => {
      const host = open();
      pinch(host);
      expect(zoomOf(host)).toBeGreaterThan(1);
      expect(resetChip()).not.toBeNull();
    });

    it("is a small button low at the scene's right, outside the camera's frame: a ⟲ glyph over \"Reset\", named Reset view", () => {
      const host = open();
      pinch(host);
      const reset = resetChip()!;
      expect(reset.parentElement, "in the scene, not the camera's frame").toBe(host);
      expect(reset.getAttribute('title')).toBe('Reset view');
      expect(reset.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(reset.textContent).toBe('Reset');
      expect(reset.getAttribute('style'), 'no offset of its own').toBeNull();
      const rule = /\.cabinet-scene__reset\s*\{([^}]*)\}/.exec(styleText())?.[1] ?? '';
      expect(rule).toMatch(/right:\s*24px/);
      expect(rule).toMatch(/bottom:\s*16px/);
      expect(rule).toMatch(/width:\s*40px/);
      expect(rule).toMatch(/height:\s*40px/);
      expect(rule).toMatch(/var\(--font-2xs/);
      expect(rule).not.toMatch(/\btop:/);
    });

    it('a drag that starts on it is no gesture of the scene, and its tap clears only the zoom', () => {
      const host = open();
      // raised part of the way, so a drag up or down from there would move the camera again
      drag2(host, 0, 60);
      pinch(host);
      const before = host.dataset.camera;
      const reset = resetChip()!;
      fireEvent.pointerDown(reset, { pointerId: 4, clientX: 400, clientY: 400, button: 0 });
      fireEvent.pointerMove(reset, { pointerId: 4, clientX: 400, clientY: 300 });
      fireEvent.pointerUp(reset, { pointerId: 4, clientX: 400, clientY: 300 });
      expect(host.dataset.camera, 'the camera did not move').toBe(before);
      fireEvent.click(reset);
      expect(resetChip()).toBeNull();
      expect(zoomOf(host)).toBe(1);
      expect(host.dataset.camera, 'still where the lift left it').toBe(before);
    });
  });

  it('a new wall still starts from its own framing, the zoom and its chip gone', () => {
    const figs = getFixtureFigures(40);
    const at = (patch: Partial<CasePrefs>) => <CabinetScene figures={figs} onSelect={vi.fn()} prefs={prefs(patch)} frameFallback={{ width: 443, height: 454 }} />;
    const { container, rerender } = render(at({}));
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    drag2(host, -300, 0);
    pinch(host);
    expect(resetChip()).not.toBeNull();
    rerender(at({ pattern: 'ikea-detolf' }));
    expect(resetChip()).toBeNull();
    expect(zoomOf(host)).toBe(1);
    // where a case opened on that wall stands, at the cabinet the walk left the focus on (as before NAV-SCOPE)
    const walked = cam(host);
    cleanup();
    const fresh = render(at({ pattern: 'ikea-detolf' })).container.querySelector('.cabinet-scene') as HTMLElement;
    expect({ ...walked, x: 0 }).toEqual({ ...cam(fresh), x: 0 });
  });
});


describe('CabinetScene: a mask that cannot be shown stands its picture framed (GKSHOW)', () => {
  /** jsdom decodes every picture; the masks named fail (a 404, a failed fetch) or, `blank`, decode but draw nothing. */
  function masksThat(fail: (src: string) => boolean, blank: (src: string) => boolean = () => false) {
    (HTMLImageElement.prototype as { decode?: (this: HTMLImageElement) => Promise<void> }).decode = function (this: HTMLImageElement) {
      return fail(this.src) ? Promise.reject(new DOMException('network error', 'EncodingError')) : Promise.resolve();
    };
    const [w, h] = [4, 4];
    let drawn = '';
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(w);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(h);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: (img: HTMLImageElement) => {
        drawn = img.src;
      },
      getImageData: () => {
        const data = new Uint8ClampedArray(w * h * 4);
        if (!blank(drawn)) data.fill(255);
        return { width: w, height: h, data };
      },
    } as unknown as CanvasRenderingContext2D);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  const maskedFigures = () => {
    window.history.pushState({}, '', '/?fxbranch=masked');
    return getFixtureFigures(1, 'masked');
  };
  const artOf = (host: HTMLElement) => Object.fromEntries(figureButtons(host).map((b) => [b.dataset.figureId, b.dataset.art]));

  it('a figure whose mask never loads is drawn framed, its picture shown, never an empty sized gap; the others stay masked', async () => {
    const figures = maskedFigures();
    const failing = getFixtureImageRef(figures[0])!.maskUrl!;
    masksThat((src) => src.endsWith(failing));
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    const b = host.querySelector<HTMLElement>(`button.cab-figure[data-figure-id="${figures[0]._id}"]`)!;
    expect(b.querySelector('.cab-figure__art--masked')).toBeNull();
    expect(b.querySelector('.cab-figure__frame img')?.getAttribute('src')).toBe(getFixtureImageRef(figures[0])!.url);
    for (const f of figures.slice(1)) expect(artOf(host)[f._id]).toBe('masked');
  });

  it('a figure whose mask decodes but draws nothing (a blank mask) is drawn framed too', async () => {
    const figures = maskedFigures();
    const blank = getFixtureImageRef(figures[1])!.maskUrl!;
    masksThat(() => false, (src) => src.endsWith(blank));
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[1]._id]).toBe('framed'));
    expect(artOf(host)[figures[0]._id]).toBe('masked');
  });

  /** The masks named fail until `served` (a 404, offline, a weak link), then load; `reads` counts the reads of `late`. */
  function lateMask(late: string) {
    const state = { served: false, reads: 0 };
    masksThat((src) => {
      if (!src.endsWith(late)) return false;
      state.reads++;
      return !state.served;
    });
    return state;
  }

  it('GKSHOW-2: a mask that failed once and then arrives draws masked again when the case is left and opened again, with no reload', async () => {
    const figures = maskedFigures();
    const late = getFixtureImageRef(figures[0])!.maskUrl!;
    let online = false;
    masksThat((src) => !online && src.endsWith(late));
    const first = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(first.host);
    await waitFor(() => expect(artOf(first.host)[figures[0]._id]).toBe('framed'));
    // the mask is now on the device / the network is back
    online = true;
    // the case is left and opened again (a new mount, as navigating away and back does)
    first.unmount();
    const again = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(again.host);
    await new Promise((r) => setTimeout(r, 1500));
    expect(artOf(again.host)[figures[0]._id]).toBe('masked');
  });

  it('GKSHOW-2: the link coming back (online) reads a failed mask again, the case left open: one read each time, still framed while it fails, masked once it loads', async () => {
    const figures = maskedFigures();
    const mask = lateMask(getFixtureImageRef(figures[0])!.maskUrl!);
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    expect(mask.reads).toBe(1);
    // back online, the mask still missing: read once, framed still, and never read again of itself
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(mask.reads).toBe(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(mask.reads).toBe(2);
    expect(artOf(host)[figures[0]._id]).toBe('framed');
    mask.served = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('masked'));
    expect(mask.reads).toBe(3);
  });

  it('a figure whose mask failed once is drawn as a cut-out once the mask loads, with no reopen or event', async () => {
    const figures = maskedFigures();
    const mask = lateMask(getFixtureImageRef(figures[0])!.maskUrl!);
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    expect(mask.reads).toBe(1);
    // the mask can load now (the link is fine again); nothing tells the case so
    mask.served = true;
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('masked'), { timeout: ALPHA_UNDECODED_RETRY_MS + 2000 });
    expect(mask.reads, 'one read again, after its backoff').toBe(2);
    const b = host.querySelector<HTMLElement>(`button.cab-figure[data-figure-id="${figures[0]._id}"]`)!;
    expect(b.querySelector('.cab-figure__art--masked')).not.toBeNull();
  }, 15_000);

  it('the image sync storing a failed mask\'s bytes reads it again at once, before its backoff; an address that is no mask of the case reads nothing', async () => {
    const figures = maskedFigures();
    const late = getFixtureImageRef(figures[0])!.maskUrl!;
    const mask = lateMask(late);
    const { host, unmount } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    const failedAt = Date.now();
    act(() => {
      imageKept(getFixtureImageRef(figures[0])!.url);
      imageKept('https://images.example/d/not-in-this-case');
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(mask.reads, 'its photo kept, not its mask: no read').toBe(1);
    mask.served = true;
    act(() => {
      imageKept(late);
    });
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('masked'));
    expect(mask.reads).toBe(2);
    expect(Date.now() - failedAt, 'at once, not at the backoff').toBeLessThan(ALPHA_UNDECODED_RETRY_MS);
    // the case closed: a mask kept later reads nothing
    unmount();
    imageKept(late);
    await new Promise((r) => setTimeout(r, 200));
    expect(mask.reads).toBe(2);
  });

  it('a mask that stays missing is read again on its own only at its backoff, and none once the case closes', async () => {
    const figures = maskedFigures();
    const mask = lateMask(getFixtureImageRef(figures[0])!.maskUrl!);
    const { host, unmount } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    await new Promise((r) => setTimeout(r, ALPHA_UNDECODED_RETRY_MS / 2));
    expect(mask.reads, 'no tight loop').toBe(1);
    await waitFor(() => expect(mask.reads).toBe(2), { timeout: ALPHA_UNDECODED_RETRY_MS });
    expect(artOf(host)[figures[0]._id]).toBe('framed');
    unmount();
    await new Promise((r) => setTimeout(r, 2 * ALPHA_UNDECODED_RETRY_MS + 500));
    expect(mask.reads, 'the case closed: its waiting retry never reads').toBe(2);
  }, 15_000);

  it('GKSHOW-2: the app shown again (visibilitychange to visible) reads a failed mask again; hidden, it reads nothing', async () => {
    const figures = maskedFigures();
    const mask = lateMask(getFixtureImageRef(figures[0])!.maskUrl!);
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    mask.served = true;
    const shown = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(mask.reads).toBe(1);
    expect(artOf(host)[figures[0]._id]).toBe('framed');
    shown.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('masked'));
    expect(mask.reads).toBe(2);
  });

  it('GKSHOW-2: the image sync completing (imagesComplete) or the case\'s masks changing reads a failed mask again', async () => {
    const figures = maskedFigures();
    const mask = lateMask(getFixtureImageRef(figures[0])!.maskUrl!);
    const at = (shown: Figure[], imagesComplete: boolean) => (
      <CabinetScene figures={shown} onSelect={vi.fn()} prefs={prefs()} imageFor={getFixtureImageRef} imagesComplete={imagesComplete} />
    );
    const { host, rerender } = scene(figures, {}, { imageFor: getFixtureImageRef, imagesComplete: false });
    await grounded(host);
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('framed'));
    // the sync completes, the mask still missing: read once more
    rerender(at(figures, true));
    await waitFor(() => expect(mask.reads).toBe(2));
    expect(artOf(host)[figures[0]._id]).toBe('framed');
    // a figure leaves the case (a filter, a sync): its masks change, and the mask, here now, is read again
    mask.served = true;
    rerender(at(figures.slice(0, -1), true));
    await waitFor(() => expect(artOf(host)[figures[0]._id]).toBe('masked'));
    expect(mask.reads).toBe(3);
  });

  it('GKSHOW-2: only the masks are read again: a cut-out whose read never decoded is left to its own picture load, never read on online', async () => {
    window.history.pushState({}, '', '/?fxbranch=masked');
    const figures = [...getFixtureFigures(1, 'masked'), ...getFixtureFigures(1, 'matted')];
    const masks = figures.flatMap((f) => getFixtureImageRef(f)?.maskUrl ?? []);
    let photoReads = 0;
    // every mask reads; every cut-out's photo never decodes
    masksThat((src) => {
      const photo = !masks.some((m) => src.endsWith(m));
      if (photo) photoReads++;
      return photo;
    });
    const { host } = scene(figures, {}, { imageFor: getFixtureImageRef });
    await grounded(host);
    const cutout = figures.find((f) => !f._id.endsWith('-masked'))!;
    expect(artOf(host)[cutout._id]).toBe('cutout');
    expect(artOf(host)[figures[0]._id]).toBe('masked');
    const read = photoReads;
    expect(read).toBeGreaterThan(0);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(photoReads, 'no photo read again').toBe(read);
  });

  it('a picture that fails to load stands as its plate, and its read still waiting in line never runs', async () => {
    const figures = getFixtureFigures(1, 'matted');
    const started: string[] = [];
    // every read stalls: the first ALPHA_READS_AT_ONCE hold their turns, the rest wait in line
    (HTMLImageElement.prototype as { decode?: (this: HTMLImageElement) => Promise<void> }).decode = function (this: HTMLImageElement) {
      started.push(this.src);
      return new Promise<void>(() => {});
    };
    const { host } = scene(figures);
    await waitFor(() => expect(started).toHaveLength(ALPHA_READS_AT_ONCE));
    const waiting = Array.from(host.querySelectorAll<HTMLImageElement>('img.cab-figure__art--cutout')).filter((img) => !started.includes(img.src));
    expect(waiting.length, 'pictures waiting in line').toBeGreaterThan(1);
    const broken = waiting[0].src;
    fireEvent.error(waiting[0]);
    // the stalled reads give up their turns: the next in line start, never the broken picture's
    await new Promise((r) => setTimeout(r, ALPHA_READ_TURN_MS + 300));
    expect(started.length).toBeGreaterThan(ALPHA_READS_AT_ONCE);
    expect(started).not.toContain(broken);
  });

  it('GKSHOW-2: the scene holds one online and one visibilitychange listener, however often its masks or imagesComplete change, and none once it unmounts', async () => {
    const onWindow = { add: vi.spyOn(window, 'addEventListener'), remove: vi.spyOn(window, 'removeEventListener') };
    const onDocument = { add: vi.spyOn(document, 'addEventListener'), remove: vi.spyOn(document, 'removeEventListener') };
    /** How many `type` listeners stand on `on`'s target now: its adds and removes replayed in the order they came. */
    const standing = (on: typeof onWindow, type: string) => {
      const calls = [
        ...on.add.mock.calls.map((c, i) => ({ add: true, c, at: on.add.mock.invocationCallOrder[i] })),
        ...on.remove.mock.calls.map((c, i) => ({ add: false, c, at: on.remove.mock.invocationCallOrder[i] })),
      ].sort((a, b) => a.at - b.at);
      const live = new Set<unknown>();
      for (const { add, c } of calls) if (c[0] === type) (add ? live.add(c[1]) : live.delete(c[1]));
      return live.size;
    };
    const figures = maskedFigures();
    masksThat(() => false);
    const at = (shown: Figure[], imagesComplete: boolean) => (
      <CabinetScene figures={shown} onSelect={vi.fn()} prefs={prefs()} imageFor={getFixtureImageRef} imagesComplete={imagesComplete} />
    );
    const { host, rerender, unmount } = scene(figures, {}, { imageFor: getFixtureImageRef, imagesComplete: false });
    await grounded(host);
    const online = standing(onWindow, 'online');
    const shown = standing(onDocument, 'visibilitychange');
    expect(online).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(0);
    rerender(at(figures, true));
    rerender(at(figures, false));
    rerender(at(figures.slice(0, -1), false));
    expect(standing(onWindow, 'online')).toBe(online);
    expect(standing(onDocument, 'visibilitychange')).toBe(shown);
    unmount();
    expect(standing(onWindow, 'online')).toBe(0);
    expect(standing(onDocument, 'visibilitychange')).toBe(0);
  });
});
