import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, LABEL_HEIGHT_MM, LABEL_LIFT_MM, LABEL_LINE_MM, LABEL_PAD_MM } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { FIGURE_GAP_MM, surfaceSlots } from '../packCabinets';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { __clearAlphaMarginCache } from '../alphaMargin';

// CASE-FB2a (Ross 10-16, after his real collection on the Fold8): brass labels one line high that never hide behind
// a shelf's or cabinet's front, a filter that starts the view again at the wall's start (its figures packed alone),
// and figures centred in their shelf's depth. jsdom has no layout: the faces' places are read off their matrices.

beforeEach(() => {
  __clearAlphaMarginCache();
});

afterEach(() => {
  cleanup();
});

/** The Fold8's panels as the case frames them (CSS px). */
const COVER = { width: 443, height: 558 };
const OPEN = { width: 870, height: 475 };

const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...LEGACY_PREFS, ...patch });

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const onSelect = vi.fn();
  const props = { figures, onSelect, prefs: prefs(patch), frameFallback: COVER, ...extra };
  const utils = render(<CabinetScene {...props} />);
  const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
  const again = (next: Partial<Parameters<typeof CabinetScene>[0]>) => utils.rerender(<CabinetScene {...props} {...next} />);
  return { ...utils, onSelect, host, again };
}

/** A figure of a labelled size (mm), no picture: it stands as its plate. */
const sized = (i: number, heightMm: number, widthMm: number, name = `Figure ${i}`): Figure => ({ _id: `s${i}`, name, dimensions: { heightMm, widthMm } }) as Figure;

type V3 = [number, number, number];

/** A face's corner and sides in the world (mm), off its matrix3d at the scene's px per mm. */
function worldQuad(q: HTMLElement, s: number): { a: V3; u: V3; v: V3 } {
  const m = q.style.transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
  const w = parseFloat(q.style.width);
  const h = parseFloat(q.style.height);
  return {
    a: [m[12] / s, -m[13] / s, m[14] / s],
    u: [(m[0] * w) / s, (-m[1] * w) / s, (m[2] * w) / s],
    v: [(m[4] * h) / s, (-m[5] * h) / s, (m[6] * h) / s],
  };
}

const pxPerMm = (host: HTMLElement) => Number(host.dataset.pxPerMm);
/** The name plate's face rule as the scene's stylesheet gives it (jsdom: a style element, no constructed sheets). */
const faceRule = (): string => {
  const css = Array.from(document.querySelectorAll('style')).map((st) => st.textContent ?? '').join('\n');
  return /\.cab-plate__face \{([^}]*)\}/.exec(css)?.[1] ?? '';
};
const figureButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));
const camera = (host: HTMLElement) => host.dataset.camera;

/** One finger's drag by (dx, dy) on the scene. */
function drag(el: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 200 + dy / 2 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
}

describe('CASE-FB2a labels: one line, brass, on the lip', () => {
  it('a label is one line high: the line and about 2 px of padding at the Fold8 sizes, not the 30 mm plate on an 11 mm line it was', () => {
    expect(LABEL_HEIGHT_MM).toBeCloseTo(LABEL_LINE_MM + 2 * LABEL_PAD_MM, 9);
    expect(LABEL_HEIGHT_MM).toBeLessThan(1.5 * LABEL_LINE_MM);
    for (const frame of [COVER, OPEN]) {
      for (const view of ['wall', 'cabinet'] as const) {
        const { host } = scene(getFixtureFigures(3), { view }, { labels: true, frameFallback: frame });
        const s = pxPerMm(host);
        // "minimal space around the text": at most 3 px above and below the line on the screen
        expect(LABEL_PAD_MM * s, `${view} ${frame.width}`).toBeLessThanOrEqual(3);
        const plates = Array.from(host.querySelectorAll<HTMLElement>('.cab-plate'));
        expect(plates.length).toBeGreaterThan(0);
        for (const p of plates) expect(-worldQuad(p, s).v[1]).toBeCloseTo(LABEL_HEIGHT_MM, 3);
        cleanup();
      }
    }
  });

  it("a label's name is one line on a brass face that follows the text, cut with an ellipsis within its figure's width, never wrapped", () => {
    const { host } = scene([sized(0, 150, 60, 'Nendoroid Hatsune Miku Snow Miku Crane Priestess Ver.')], { view: 'cabinet' }, { labels: true });
    const plate = host.querySelector<HTMLElement>('.cab-plate')!;
    const face = plate.querySelector<HTMLElement>('.cab-plate__face')!;
    expect(face.textContent).toBe('Nendoroid Hatsune Miku Snow Miku Crane Priestess Ver.');
    const cs = getComputedStyle(face);
    expect(cs.whiteSpace).toBe('nowrap');
    expect(cs.overflow).toBe('hidden');
    expect(cs.textOverflow).toBe('ellipsis');
    expect(cs.maxWidth).toBe('100%');
    expect(getComputedStyle(plate).justifyContent).toBe('center');
    // antique brass: a warm gradient, a darker edge, dark engraved text (jsdom computes no layered background: the rule)
    const rule = faceRule();
    expect(rule).toMatch(/background:[^;]*linear-gradient\(180deg, #dcb978/);
    expect(rule).toMatch(/box-shadow:\s*inset/);
    expect(rule).toMatch(/color: #2e1f0a/);
  });

  it("neighbours' labels never overlap: each is at most its figure's width, centred under it, the packing's gap between them", () => {
    const widths = [60, 60, 60, 60, 60, 150, 60, 60, 60, 60];
    const { host } = scene(widths.map((w, i) => sized(i, 100, w)), { view: 'cabinet' }, { labels: true });
    const s = pxPerMm(host);
    const centre = new Map(figureButtons(host).map((b) => [b.dataset.figureId!, b]));
    const plates = Array.from(host.querySelectorAll<HTMLElement>('.cab-plate')).map((p) => {
      const q = worldQuad(p, s);
      return { id: p.dataset.figureId!, x0: q.a[0], x1: q.a[0] + q.u[0], y: q.a[1], z: q.a[2] };
    });
    expect(plates).toHaveLength(widths.length);
    for (const p of plates) {
      const i = Number(p.id.slice(1));
      const tap = JSON.parse(centre.get(p.id)!.dataset.world!) as { x0: number; x1: number };
      expect(p.x1 - p.x0, p.id).toBeCloseTo(widths[i], 3);
      expect((p.x0 + p.x1) / 2, p.id).toBeCloseTo((tap.x0 + tap.x1) / 2, 3);
    }
    const rows = new Map<string, typeof plates>();
    for (const p of plates) rows.set(`${p.y}:${p.z}`, [...(rows.get(`${p.y}:${p.z}`) ?? []), p]);
    let pairs = 0;
    for (const row of rows.values()) {
      row.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < row.length; i++, pairs++) expect(row[i].x0 - row[i - 1].x1).toBeGreaterThanOrEqual(FIGURE_GAP_MM - 1e-3);
    }
    expect(pairs).toBeGreaterThan(3);
  });

  // every surface of the first cabinet holds a figure: the top, each shelf, the KLINGSBO's floor and open shelf, the
  // Detolf's base board, the rack's beams
  // (the rack's lowest level has 95 mm above it: its figures are short)
  const WALLS = [
    { profile: IKEA_KLINGSBO, count: 26, heightMm: 150 },
    { profile: IKEA_DETOLF, count: 20, heightMm: 150 },
    { profile: OPEN_STEEL_RACK, count: 36, heightMm: 90 },
  ];
  for (const { profile, count, heightMm } of WALLS) {
    it(`${profile.id}: each label sits on its surface's lip, in front of it and of every face of the cabinet at its centre`, () => {
      const { host } = scene(Array.from({ length: count }, (_, i) => sized(i, heightMm, 100)), { view: 'cabinet', pattern: profile.id }, { labels: true, frameFallback: { width: 443, height: 900 } });
      const s = pxPerMm(host);
      const lips = new Map(surfaceSlots(profile).map((slot) => [slot.topMm, slot.lipZMm]));
      // the vertical faces of the cabinets, facing the camera (a box front, a shelf's lip, a pane's edge)
      const faces = Array.from(host.querySelectorAll<HTMLElement>('.cab .q'))
        .map((q) => ({ cls: q.className, ...worldQuad(q, s) }))
        .filter((f) => Math.abs(f.u[2]) < 1e-6 && Math.abs(f.v[2]) < 1e-6);
      const buttons = new Map(figureButtons(host).map((b) => [b.dataset.figureId!, JSON.parse(b.dataset.world!) as { surface: number }]));
      const surfaces = new Set<number>();
      for (const plate of Array.from(host.querySelectorAll<HTMLElement>('.cab-plate'))) {
        const { a, u, v } = worldQuad(plate, s);
        const surface = buttons.get(plate.dataset.figureId!)!.surface;
        surfaces.add(surface);
        // its top on the surface's top, LABEL_LIFT_MM in front of the lip
        expect.soft(a[1], plate.dataset.figureId).toBeCloseTo(surface, 3);
        expect.soft(a[2], plate.dataset.figureId).toBeCloseTo(lips.get(surface)! + LABEL_LIFT_MM, 3);
        const c = [a[0] + u[0] / 2, a[1] + v[1] / 2];
        for (const f of faces) {
          const xs = [f.a[0], f.a[0] + f.u[0] + f.v[0]];
          const ys = [f.a[1], f.a[1] + f.u[1] + f.v[1]];
          const over = c[0] > Math.min(...xs) && c[0] < Math.max(...xs) && c[1] > Math.min(...ys) && c[1] < Math.max(...ys);
          if (over) expect.soft(f.a[2], `${plate.dataset.figureId} on ${surface}: ${f.cls}`).toBeLessThan(a[2]);
        }
      }
      // a label on every surface the first cabinet has
      expect([...surfaces].sort((x, y) => x - y)).toEqual(surfaceSlots(profile).map((slot) => slot.topMm).sort((x, y) => x - y));
    });
  }
});

describe('CASE-FB2a depth: each figure centred in its surface\'s depth', () => {
  it("each figure's base is centred in its surface's usable depth and its picture stands at the base's front; the scene says so", () => {
    const { host } = scene(getFixtureFigures(2), { view: 'cabinet' });
    const buttons = figureButtons(host);
    expect(buttons.length).toBeGreaterThan(6);
    for (const b of buttons) {
      const d = JSON.parse(b.dataset.depth!) as { front: number; back: number; slotFront: number; slotBack: number };
      const w = JSON.parse(b.dataset.world!) as { z: number };
      expect((d.front + d.back) / 2, b.getAttribute('aria-label')!).toBeCloseTo((d.slotFront + d.slotBack) / 2, 6);
      expect(w.z).toBeCloseTo(d.front, 6);
      expect(d.front).toBeLessThanOrEqual(d.slotFront);
    }
  });

  it('the contact shadow lies on the surface under the base, inside the usable depth', () => {
    const { host } = scene(getFixtureFigures(2), { view: 'cabinet' });
    const s = pxPerMm(host);
    const buttons = figureButtons(host);
    const shadows = Array.from(host.querySelectorAll<HTMLElement>('.cab-shadow'));
    expect(shadows).toHaveLength(buttons.length);
    buttons.forEach((b, i) => {
      const d = JSON.parse(b.dataset.depth!) as { front: number; back: number; slotFront: number; slotBack: number };
      const w = JSON.parse(b.dataset.world!) as { surface: number };
      const q = worldQuad(shadows[i], s);
      const [z0, z1] = [q.a[2], q.a[2] + q.v[2]];
      expect(q.a[1], b.getAttribute('aria-label')!).toBeCloseTo(w.surface + 0.6, 3);
      expect((z0 + z1) / 2).toBeCloseTo((d.front + d.back) / 2, 3);
      expect(Math.min(z0, z1)).toBeGreaterThanOrEqual(d.slotBack - 1e-6);
      expect(Math.max(z0, z1)).toBeLessThanOrEqual(d.slotFront + 1e-6);
    });
  });

  it('a tap on a figure standing nearer the front still opens it', () => {
    const figures = getFixtureFigures(2);
    const { host, onSelect } = scene(figures, { view: 'cabinet' });
    const b = figureButtons(host)[4];
    fireEvent.click(b);
    const index = figures.findIndex((f) => f._id === b.dataset.figureId);
    expect(onSelect).toHaveBeenCalledWith(figures[index], index);
  });
});

describe('CASE-FB2a filter: a new filter starts the view at the wall\'s start (REPACK_ON_FILTER)', () => {
  const many = getFixtureFigures(8);
  const few = many.slice(0, 5);

  /** The view a scene of `figures` starts with, on its own. */
  function fresh(figures: Figure[], patch: Partial<CasePrefs>) {
    const { host, unmount } = scene(figures, patch);
    const out = { camera: camera(host), focus: host.dataset.focus, shelf: host.dataset.shelf, pan: host.dataset.pan, panY: host.dataset.panY };
    unmount();
    return out;
  }
  const view = (host: HTMLElement) => ({ camera: camera(host), focus: host.dataset.focus, shelf: host.dataset.shelf, pan: host.dataset.pan, panY: host.dataset.panY });

  it('camera mode: a walk along the wall and a lift, then a filter: the camera stands where a scene of the filtered figures starts', () => {
    const patch = { view: 'cabinet', swipe: 'camera' } as const;
    const start = fresh(few, patch);
    const { host, again } = scene(many, patch, { filterKey: 'all' });
    drag(host, -300);
    drag(host, 0, 80);
    expect(host.dataset.focus).not.toBe('0');
    again({ figures: few, filterKey: 'ordered' });
    expect(view(host)).toEqual(start);
  });

  it('the wall view after a walk to its far end: a filter starts at the wall\'s start, not in an empty room past it', () => {
    const patch = { view: 'wall', swipe: 'camera' } as const;
    const start = fresh(few, patch);
    const { host, again } = scene(many, patch, { filterKey: 'all' });
    for (let i = 0; i < 6; i++) drag(host, -400);
    expect(Number(JSON.parse(host.dataset.camera!).x)).toBeGreaterThan(Number(JSON.parse(start.camera!).x));
    again({ figures: few, filterKey: 'ordered' });
    expect(view(host)).toEqual(start);
    expect(figureButtons(host).length).toBe(few.length);
  });

  it('pan mode: the photo slid both ways, then a filter: unslid', () => {
    const patch = { view: 'cabinet', swipe: 'pan' } as const;
    const start = fresh(few, patch);
    const { host, again } = scene(many, patch, { filterKey: 'all' });
    drag(host, -200);
    drag(host, 0, 60);
    expect([host.dataset.pan, host.dataset.panY]).not.toEqual(['0', '0']);
    again({ figures: few, filterKey: 'ordered' });
    expect(view(host)).toEqual(start);
  });

  it('the shelf view, a few cabinets and shelves along: a filter starts at the first cabinet\'s first shelf', () => {
    const patch = { view: 'shelf' } as const;
    const { host, again, getByRole } = scene(many, patch, { filterKey: 'all' });
    fireEvent.click(getByRole('button', { name: 'Next cabinet' }));
    fireEvent.click(getByRole('button', { name: 'Shelf below' }));
    fireEvent.click(getByRole('button', { name: 'Shelf below' }));
    expect([host.dataset.focus, host.dataset.shelf]).toEqual(['1', '2']);
    again({ figures: many.slice(0, 40), filterKey: 'wished' });
    expect([host.dataset.focus, host.dataset.shelf]).toEqual(['0', '0']);
  });

  it('the same filter with new figure data (an image landing) keeps the view where it is', () => {
    const { host, again } = scene(many, { view: 'cabinet', swipe: 'camera' }, { filterKey: 'all' });
    drag(host, -300);
    const walked = view(host);
    again({ figures: many.map((f) => ({ ...f })), filterKey: 'all' });
    expect(view(host)).toEqual(walked);
  });

  it("each figure says its place in the list, the order it is packed in", () => {
    const { host } = scene(few, { view: 'cabinet' });
    expect(figureButtons(host).map((b) => [b.dataset.figureId, Number(b.dataset.index)])).toEqual(
      expect.arrayContaining(few.map((f, i) => [f._id, i])),
    );
  });
});
