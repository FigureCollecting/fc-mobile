import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { CabinetScene } from '../../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../../casePrefs';
import { CABINET_PRESETS, IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../../cabinetPresets';
import { wallLayout } from '../../packCabinets';
import { cabinetBox } from '../../caseFraming';
import { cabinetQuads, roomQuads, type ColoredQuad } from '../cabinetQuads';

afterEach(cleanup);

type Q = { cls: string; a: number[]; u: number[]; v: number[] };

/** Each face the classic view draws in its cabinets, back in world mm from its matrix3d (quadStyle's inverse). */
function domQuads(profileId: string): Q[] {
  const { container } = render(
    h(CabinetScene, { figures: [], onSelect: vi.fn(), prefs: { ...DEFAULT_CASE_PREFS, pattern: profileId, view: 'cabinet' }, frameFallback: { width: 870, height: 1200 } }),
  );
  const s = Number(container.querySelector<HTMLElement>('.cabinet-scene')!.dataset.pxPerMm);
  return Array.from(container.querySelectorAll<HTMLElement>('.cab .q')).map((el) => {
    const m = el.style.transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
    const pu = parseFloat(el.style.width);
    const pv = parseFloat(el.style.height);
    return {
      cls: el.className.replace(/^q /, ''),
      a: [m[12] / s, -m[13] / s, m[14] / s],
      u: [(m[0] * pu) / s, (-m[1] * pu) / s, (m[2] * pu) / s],
      v: [(m[4] * pv) / s, (-m[5] * pv) / s, (m[6] * pv) / s],
    };
  });
}

const key = (q: Q | ColoredQuad) => [q.cls, ...[...q.a, ...q.u, ...q.v].map((n) => (Math.round(n * 10) / 10).toFixed(1))].join('|').replace(/-0\.0/g, '0.0');

describe('cabinetQuads: the canvas draws the cabinet the classic view draws, face for face', () => {
  for (const profile of [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]) {
    it(`${profile.name}: every face, its material and its corner and sides in the world`, () => {
      const slot = wallLayout([profile]).cabinets[0];
      const dom = domQuads(profile.id).map(key).sort();
      const gl = cabinetQuads(slot).map(key).sort();
      expect(dom.length).toBeGreaterThan(10);
      expect(gl).toEqual(dom);
    });
  }

  it('every preset gets faces, each a colour, and none reaches past the cabinet and its feet', () => {
    for (const profile of CABINET_PRESETS) {
      const slot = wallLayout([profile]).cabinets[0];
      const box = cabinetBox(slot, 0);
      const quads = cabinetQuads(slot);
      expect(quads.length).toBeGreaterThan(0);
      for (const q of quads) {
        expect(q.colors.length).toBeGreaterThan(0);
        for (const [t, c] of q.colors) {
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
          expect(c).toHaveLength(4);
        }
        for (const s of [0, 1])
          for (const t of [0, 1]) {
            const x = q.a[0] + s * q.u[0] + t * q.v[0];
            expect(x).toBeGreaterThanOrEqual(box.x0 - 13);
            expect(x).toBeLessThanOrEqual(box.x1 + 13);
          }
      }
    }
  });

  it('glass is clear, edges only (CC13): the panes and rims are see-through, the steel opaque', () => {
    const quads = cabinetQuads(wallLayout([IKEA_KLINGSBO]).cabinets[0]);
    const panes = quads.filter((q) => q.cls.startsWith('cab-pane'));
    expect(panes.length).toBe(16);
    for (const q of panes) expect(q.colors[0][1][3]).toBeLessThan(1);
    for (const q of quads.filter((x) => x.cls.startsWith('m-steel'))) expect(q.colors[0][1][3]).toBe(1);
  });
});

describe('roomQuads: the wall and floor, their gradients as the classic view paints them', () => {
  it('a wall and a floor 6 m past the wall each side, the wall graded top to bottom', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO]);
    const room = roomQuads(wall);
    const back = room.find((q) => q.cls === 'room-wall')!;
    const floor = room.find((q) => q.cls === 'room-floor')!;
    expect(back.a[0]).toBe(wall.leftMm - 6000);
    expect(back.u[0]).toBe(wall.rightMm - wall.leftMm + 12000);
    expect(back.a[1]).toBe(3200);
    expect(back.v).toEqual([0, -3200, 0]);
    expect(floor.v).toEqual([0, 0, 6500]);
    expect(back.a[2]).toBe(-IKEA_KLINGSBO.outer.depthMm - 450);
    // linear-gradient(180deg, #2d3037 0%, #23262c 55%, #1a1c21 100%)
    expect(back.colors.map(([t]) => t)).toEqual([0, 0.55, 1]);
    expect(back.colors[0][1]).toEqual([0x2d / 255, 0x30 / 255, 0x37 / 255, 1]);
    expect(floor.colors.map(([t]) => t)).toEqual([0, 0.45, 1]);
  });
});
