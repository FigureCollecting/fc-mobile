import { describe, it, expect } from 'vitest';
import { project, type Camera } from '../../caseCamera';
import type { Board } from '../../caseCull';
import { COVER_CELL_PX, cullCards, type CabinetBounds, type CardBox } from '../visibility';

const camera: Camera = { x: 0, y: 1000, z: 2000, pitch: 0, focalPx: 400, frame: { width: 400, height: 300 } };

const cab = (x0: number, x1: number, opaqueFront = false): CabinetBounds => ({ x0, x1, y0: 0, y1: 1800, z0: -400, z1: 0, opaqueFront });
let id = 0;
const card = (c: number, x0: number, x1: number, y0: number, y1: number, z: number, opaque = false, surface = 0): CardBox => ({ id: id++, cab: c, surface, x0, x1, y0, y1, z, opaque });

const noBoards = () => [] as Board[];

describe('cullCards', () => {
  it('draws everything the frame shows, front to back, and says so stage by stage', () => {
    const cards = [card(0, -100, 0, 900, 1100, -300), card(0, 0, 100, 900, 1100, -100)];
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-300, 300)], boards: noBoards, cards });
    expect(r.visible).toEqual([cards[1].id, cards[0].id]);
    expect(r.stages).toEqual({ total: 2, frustum: 0, cabinets: 0, boards: 0, figures: 0 });
    expect(r.cabinets).toEqual([0]);
  });

  it('frustum: a cabinet wholly outside the frame takes its cards with it; a card off the frame goes alone', () => {
    // the frame spans x in [-2000 * 200 / 400, ...] = [-1000, 1000] mm at z 0 (2000 mm away)
    const far = cab(5000, 5500);
    const cards = [card(1, 5100, 5200, 900, 1100, -100), card(0, 1200, 1300, 900, 1100, -100), card(0, -50, 50, 900, 1100, -100)];
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500), far], boards: noBoards, cards });
    expect(r.cabinets).toEqual([0]);
    expect(r.visible).toEqual([cards[2].id]);
    expect(r.stages.frustum).toBe(2);
  });

  it('frustum: a card just inside an edge stays; the pan slides the frame', () => {
    // x = 990 mm draws at 200 + 400 * 990 / 2100 = 388.6 px: inside 400
    const edge = card(0, 990, 1000, 900, 1100, -100);
    expect(cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [edge] }).visible).toEqual([edge.id]);
    // panned 20 px right it draws past 400
    expect(cullCards({ camera, panPx: 20, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [edge] }).visible).toEqual([]);
    // panned 20 px left a card past the left edge comes in
    const left = card(0, -1100, -1060, 900, 1100, -100);
    const x = project(camera, [-1060, 1000, -100]).x;
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThan(-20);
    expect(cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [left] }).visible).toEqual([]);
    expect(cullCards({ camera, panPx: 20, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [left] }).visible).toEqual([left.id]);
  });

  it('frustum: above and below the frame, and behind the camera', () => {
    const above = card(0, -50, 50, 1900, 2000, -100);
    const below = card(0, -50, 50, -10, 0, -100);
    const behind = card(0, -50, 50, 900, 1100, 2500);
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [above, below, behind] });
    expect(r.visible).toEqual([]);
    expect(r.stages.frustum).toBe(3);
  });

  it('cabinets: one whose screen box lies behind a nearer opaque front is not drawn; glass and open fronts hide nothing', () => {
    // a deep cabinet's front at z 0 hides one set back behind it
    const front: CabinetBounds = { x0: -600, x1: 600, y0: 0, y1: 2000, z0: -400, z1: 0, opaqueFront: true };
    const back: CabinetBounds = { x0: -200, x1: 200, y0: 800, y1: 1200, z0: -1200, z1: -900, opaqueFront: false };
    const cards = [card(1, -50, 50, 900, 1100, -1000)];
    const hidden = cullCards({ camera, panPx: 0, cabinets: [front, back], boards: noBoards, cards });
    expect(hidden.cabinets).toEqual([0]);
    expect(hidden.visible).toEqual([]);
    expect(hidden.stages).toMatchObject({ frustum: 0, cabinets: 1 });
    const glass = cullCards({ camera, panPx: 0, cabinets: [{ ...front, opaqueFront: false }, back], boards: noBoards, cards });
    expect(glass.cabinets).toEqual([0, 1]);
    expect(glass.visible).toEqual([cards[0].id]);
    // a front that covers only part of it hides nothing
    const narrow = cullCards({ camera, panPx: 0, cabinets: [{ ...front, x0: -100, x1: 600 }, back], boards: noBoards, cards });
    expect(narrow.cabinets).toEqual([0, 1]);
  });

  it('boards: a shelf whose figures all lie under an opaque board from the camera is dropped whole', () => {
    // the camera looks down on a wood board at 1200..1220 that covers the shelf below it
    const high: Camera = { ...camera, y: 2600, z: 900, pitch: Math.atan2(1500, 1200) };
    const board: Board = { x0: -1500, x1: 1500, y0: 1180, y1: 1200, z0: -400, z1: 0 };
    const under = [card(0, -100, 0, 900, 1100, -300, false, 1), card(0, 0, 100, 900, 1100, -300, false, 1)];
    const onTop = card(0, -50, 50, 1200, 1400, -200, false, 0);
    const r = cullCards({ camera: high, panPx: 0, cabinets: [cab(-1500, 1500)], boards: () => [board], cards: [...under, onTop] });
    expect(r.visible).toEqual([onTop.id]);
    expect(r.stages.boards).toBe(2);
    // seen from level with the board, nothing is hidden by it
    const level = cullCards({ camera: { ...camera, y: 1190, z: 900 }, panPx: 0, cabinets: [cab(-1500, 1500)], boards: () => [board], cards: [...under, onTop] });
    expect(level.stages.boards).toBe(0);
  });

  it('figures: one wholly behind a nearer opaque card is not drawn; behind a see-through cut-out it is', () => {
    const front = card(0, -200, 200, 800, 1200, -100, true);
    const behind = card(0, -100, 100, 900, 1100, -300, false);
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [behind, front] });
    expect(r.visible).toEqual([front.id]);
    expect(r.stages.figures).toBe(1);
    const cut = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [behind, { ...front, opaque: false }] });
    expect(cut.visible).toEqual([front.id, behind.id]);
    expect(cut.stages.figures).toBe(0);
  });

  it('figures: one only partly behind, or in front of, an opaque card is drawn', () => {
    const front = card(0, -200, 200, 800, 1200, -100, true);
    const partly = card(0, 100, 400, 900, 1100, -300, false);
    const nearer = card(0, -100, 100, 900, 1100, -50, false);
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [partly, front, nearer] });
    expect(r.visible).toEqual([nearer.id, front.id, partly.id]);
    expect(r.stages.figures).toBe(0);
  });

  it('figures: two opaque cards side by side cover one behind the seam between them', () => {
    const l = card(0, -400, 0, 800, 1200, -100, true);
    const rr = card(0, 0, 400, 800, 1200, -100, true);
    const behind = card(0, -150, 150, 900, 1100, -300, false);
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [behind, l, rr] });
    expect(r.visible).not.toContain(behind.id);
    expect(r.stages.figures).toBe(1);
  });

  it('the coverage grid is coarse and conservative: a card a cell or less from an occluder edge stays drawn', () => {
    expect(COVER_CELL_PX).toBe(8);
    // the card lies wholly behind the occluder, its right edge 2 px inside the occluder's: in the last cell, not covered whole
    const occ = card(0, -200, 200, 800, 1200, -100, true);
    const behind = card(0, -100, 207, 900, 1100, -300, false);
    expect(project(camera, [200, 1000, -100]).x).toBeCloseTo(238.1, 1);
    expect(project(camera, [207, 1000, -300]).x).toBeCloseTo(236, 1);
    const r = cullCards({ camera, panPx: 0, cabinets: [cab(-1500, 1500)], boards: noBoards, cards: [behind, occ] });
    expect(r.visible).toContain(behind.id);
  });
});
