import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { project, type Camera } from '../../caseCamera';
import { hitCard, type TapBox } from '../hitTest';

const camera: Camera = { x: 100, y: 1200, z: 1800, pitch: 0.2, focalPx: 500, frame: { width: 443, height: 558 } };
const screenOf = (p: readonly [number, number, number], panPx = 0) => {
  const s = project(camera, p);
  return { x: s.x + panPx, y: s.y };
};

describe('hitCard (the tap ray onto the figure cards)', () => {
  const a: TapBox = { id: 7, x0: 0, x1: 100, y0: 1000, y1: 1200, z: -200 };
  const b: TapBox = { id: 9, x0: 50, x1: 150, y0: 1000, y1: 1150, z: -100 };

  it('the card under the tap', () => {
    const p = screenOf([20, 1100, -200]);
    expect(hitCard(camera, 0, [a, b], p.x, p.y)).toBe(7);
  });

  it('where two overlap on screen, the nearer takes the tap', () => {
    const p = screenOf([75, 1050, -100]);
    expect(hitCard(camera, 0, [a, b], p.x, p.y)).toBe(9);
    expect(hitCard(camera, 0, [b, a], p.x, p.y)).toBe(9);
  });

  it('nothing under the tap: null', () => {
    const p = screenOf([400, 1100, -200]);
    expect(hitCard(camera, 0, [a, b], p.x, p.y)).toBeNull();
    expect(hitCard(camera, 0, [], 10, 10)).toBeNull();
  });

  it('the pan slides the picture: the same card under the same finger after a pan', () => {
    const p = screenOf([20, 1100, -200], 60);
    expect(hitCard(camera, 60, [a, b], p.x, p.y)).toBe(7);
    expect(hitCard(camera, 0, [a, b], p.x, p.y)).not.toBe(7);
  });

  it('edges: a tap on the box edge hits it, a hair outside misses', () => {
    const inside = screenOf([0.01, 1100, -200]);
    const outside = screenOf([-0.5, 1100, -200]);
    expect(hitCard(camera, 0, [a], inside.x, inside.y)).toBe(7);
    expect(hitCard(camera, 0, [a], outside.x, outside.y)).toBeNull();
    const top = screenOf([50, 1199.9, -200]);
    const over = screenOf([50, 1200.5, -200]);
    expect(hitCard(camera, 0, [a], top.x, top.y)).toBe(7);
    expect(hitCard(camera, 0, [a], over.x, over.y)).toBeNull();
  });

  it('a property: the point a card draws at hits that card when nothing nearer covers it', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.99, noNaN: true }), fc.double({ min: 0.01, max: 0.99, noNaN: true }), (s, t) => {
        const p = screenOf([a.x0 + s * (a.x1 - a.x0), a.y0 + t * (a.y1 - a.y0), a.z]);
        expect(hitCard(camera, 0, [a], p.x, p.y)).toBe(7);
      }),
    );
  });
});
