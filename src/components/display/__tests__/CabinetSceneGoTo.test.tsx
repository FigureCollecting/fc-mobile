import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';

// CARD-VIEW-1 part 3 (Ross 10-25): a card's Go to takes the case to its figure: the one-shelf view (TOP1) of its shelf, in
// its cabinet, the figure in the frame; the scene reports where its figures stand, so a card can say Go to has nowhere to go

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => cleanup());

const COVER = { width: 443, height: 418 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...LEGACY_PREFS, clearanceMm: 0, pattern: 'ikea-detolf', view: 'shelf', ...patch });
const sized = (i: number, heightMm: number, widthMm: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm, widthMm } }) as Figure;
const FORTY = Array.from({ length: 40 }, (_, i) => sized(i, 200, 100));

const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
/** The cabinet whose body spans the figure's middle along the wall (the scene's own boxes, data-wall). */
function cabinetOf(name: string): number {
  const world = JSON.parse(screen.getByRole('button', { name }).dataset.world!) as { x0: number; x1: number };
  const cx = (world.x0 + world.x1) / 2;
  const boxes = JSON.parse(host().dataset.wall!) as number[][];
  return boxes.findIndex((b) => cx >= b[0] && cx <= b[1]);
}

type P = { x: number; y: number };
const down = (el: Element, id: number, p: P) => fireEvent.pointerDown(el, { pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const move = (el: Element, id: number, p: P) => fireEvent.pointerMove(el, { pointerId: id, clientX: p.x, clientY: p.y });
const up = (el: Element, id: number, p: P) => fireEvent.pointerUp(el, { pointerId: id, clientX: p.x, clientY: p.y });

describe('CabinetScene: Go to (CARD-VIEW-1)', () => {
  it('a request frames the figure\'s shelf in the one-shelf view, in its cabinet, and says it went there, once per request', () => {
    const onWentTo = vi.fn();
    const props = { figures: FORTY, onSelect: vi.fn(), prefs: prefs(), frameFallback: COVER, onWentTo };
    const { rerender } = render(<CabinetScene {...props} />);
    expect(host().dataset.focus).toBe('0');
    expect(host().dataset.shelf).toBe('0');
    rerender(<CabinetScene {...props} goTo={{ figureId: 's39', seq: 1 }} />);
    expect(onWentTo).toHaveBeenCalledTimes(1);
    expect(onWentTo).toHaveBeenCalledWith('s39', true);
    // drawn: in its cabinet's focus, on the shelf the view shows
    expect(screen.getByRole('button', { name: 'Figure 39' })).toBeInTheDocument();
    expect(Number(host().dataset.focus)).toBe(cabinetOf('Figure 39'));
    expect(Number(host().dataset.focus)).toBeGreaterThan(0);
    const surface = (JSON.parse(screen.getByRole('button', { name: 'Figure 39' }).dataset.world!) as { surface: number }).surface;
    const camera = JSON.parse(host().dataset.camera!) as { y: number; pitch: number };
    expect(camera.pitch).toBe(0);
    // level with its shelf's band: above the board it stands on, below the next
    expect(camera.y).toBeGreaterThan(surface);
    expect(camera.y - surface).toBeLessThan(500);
    // the same request again (a render) goes nowhere new
    rerender(<CabinetScene {...props} goTo={{ figureId: 's39', seq: 1 }} />);
    expect(onWentTo).toHaveBeenCalledTimes(1);
    // another request for the first figure
    rerender(<CabinetScene {...props} goTo={{ figureId: 's0', seq: 2 }} />);
    expect(onWentTo).toHaveBeenLastCalledWith('s0', true);
    expect(host().dataset.focus).toBe('0');
  });

  it('a figure on no shelf: it says it could not go, and the view stays where it was', () => {
    const onWentTo = vi.fn();
    const props = { figures: FORTY, onSelect: vi.fn(), prefs: prefs(), frameFallback: COVER, onWentTo };
    const { rerender } = render(<CabinetScene {...props} />);
    const before = host().dataset.camera;
    rerender(<CabinetScene {...props} goTo={{ figureId: 'nobody', seq: 1 }} />);
    expect(onWentTo).toHaveBeenCalledWith('nobody', false);
    expect(host().dataset.camera).toBe(before);
  });

  it('a go-to snaps away a zoom: the straight-on view of that shelf, at 1x', () => {
    const props = { figures: FORTY, onSelect: vi.fn(), prefs: prefs(), frameFallback: COVER };
    const { rerender } = render(<CabinetScene {...props} />);
    const el = host();
    down(el, 11, { x: 180, y: 260 });
    down(el, 12, { x: 260, y: 260 });
    move(el, 11, { x: 120, y: 260 });
    move(el, 12, { x: 320, y: 260 });
    up(el, 11, { x: 120, y: 260 });
    up(el, 12, { x: 320, y: 260 });
    expect((JSON.parse(el.dataset.zoom!) as { k: number }).k).toBeGreaterThan(1);
    rerender(<CabinetScene {...props} goTo={{ figureId: 's20', seq: 1 }} />);
    expect((JSON.parse(el.dataset.zoom!) as { k: number }).k).toBe(1);
  });

  it('a request made before the wall is laid out waits for it', () => {
    const onWentTo = vi.fn();
    const base = { onSelect: vi.fn(), prefs: prefs(), frameFallback: COVER, onWentTo, goTo: { figureId: 's39', seq: 1 } };
    const { rerender } = render(<CabinetScene figures={[]} {...base} />);
    expect(onWentTo).not.toHaveBeenCalled();
    rerender(<CabinetScene figures={FORTY} {...base} />);
    expect(onWentTo).toHaveBeenCalledWith('s39', true);
    expect(Number(host().dataset.focus)).toBe(cabinetOf('Figure 39'));
  });

  it('reports the figures it stands on no shelf (they do not fit), none when all fit; once laid out, not before', () => {
    const onUnplaced = vi.fn();
    const props = { onSelect: vi.fn(), prefs: prefs(), frameFallback: COVER, onUnplaced };
    const { rerender, unmount } = render(<CabinetScene figures={[]} {...props} />);
    expect(onUnplaced).not.toHaveBeenCalled();
    rerender(<CabinetScene figures={FORTY} {...props} />);
    expect([...(onUnplaced.mock.lastCall![0] as ReadonlySet<string>)]).toEqual([]);
    rerender(<CabinetScene figures={[...FORTY.slice(0, 4), sized(77, 4000, 100)]} {...props} />);
    expect([...(onUnplaced.mock.lastCall![0] as ReadonlySet<string>)]).toEqual(['s77']);
    // what it found stays its host's to keep: going says nothing more
    const calls = onUnplaced.mock.calls.length;
    unmount();
    expect(onUnplaced.mock.calls.length).toBe(calls);
  });
});
