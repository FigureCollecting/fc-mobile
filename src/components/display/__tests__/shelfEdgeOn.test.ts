import { describe, it, expect } from 'vitest';
import { project } from '../caseCamera';
import { cullRect, trimFace } from '../caseCull';
import { frameCase } from '../caseFraming';
import { CABINET_PRESETS } from '../cabinetPresets';
import { wallLayout } from '../packCabinets';

// CASE-FB3a item 2 (Ross 10-17: "the 2nd to lowest shelf vanished at exactly horizontal but reappears otherwise"). A
// shelf's top is edge-on when the camera stands at its height: it draws on the horizon, whatever its material. What
// stays is its front edge, the profile's own thickness (CabinetScene's Surfaces and Rack draw it from
// CabinetSurface.thicknessMm), which must stay in the cull and keep an area on screen. Measured on desktop Chromium
// (e2e/case-shelf-edge): no profile has a zero-thickness shelf, and no edge is culled at any height.

const FRAMES = [
  { width: 443, height: 558 },
  { width: 870, height: 475 },
  { width: 657, height: 687 },
];

describe('a shelf seen edge-on keeps its front edge', () => {
  for (const profile of CABINET_PRESETS) {
    it(`${profile.id}: every surface has a thickness, and its front edge is drawn with the camera at its top, a hair above and below`, () => {
      const wall = wallLayout([profile, profile, profile]);
      for (const frame of FRAMES) {
        const f = frameCase({ frame, wall, headroomMm: [300, 300, 300], view: 'wall', focus: 0, shelf: 0 });
        const slot = wall.cabinets[0];
        const rect = cullRect(frame);
        for (const s of profile.surfaces) {
          expect(s.thicknessMm, `${profile.id} ${s.name}: a thickness`).toBeGreaterThan(0);
          for (const dy of [0, 1e-6, -1e-6, 0.5, -0.5]) {
            const camera = { ...f.camera, y: s.topMm + dy };
            const at = `${profile.id} ${s.name} ${frame.width}x${frame.height} camera ${dy >= 0 ? '+' : ''}${dy} mm`;
            // the front edge: the cabinet's front plane, from the surface's top down by its thickness
            const edge = trimFace({ camera, panPx: 0 }, [slot.leftMm, s.topMm, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -s.thicknessMm, 0], rect);
            expect(edge, `${at}: the front edge is in the cull`).not.toBeNull();
            // and it has an area on screen: its two long sides apart by the thickness at the scene's scale
            const top = project(camera, [slot.centerMm, s.topMm, 0]);
            const bottom = project(camera, [slot.centerMm, s.topMm - s.thicknessMm, 0]);
            expect(bottom.y - top.y, `${at}: the edge's height on screen`).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});
