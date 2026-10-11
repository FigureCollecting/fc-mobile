/**
 * Cabinet presets: DATA only. Ross 2026-10-11: THREE profiles, the IKEA
 * KLINGSBO the default, the IKEA DETOLF second, his own open steel rack at
 * low preference (the double-wide MILSBO was considered and rejected). Adding
 * a preset means adding one object to PRESET_DATA; the registry tests run
 * every preset through checkCabinetProfile (G19), so a data-only addition is
 * covered without a new test. Order in the file does not matter: the
 * registry is sorted by preferenceRank (1 = most preferred).
 *
 * Inch-native cabinets are entered in inches through inchesToMm and stored
 * exact (the rack is 1828.8 mm, never 1829). Every value carries provenance;
 * derived values show 'verify' on screen and placeholders are marked until
 * real sizes arrive (unverifiedFields).
 */
import {
  inchesToMm,
  type CabinetProfile,
  type CabinetSurface,
  type Provenance,
  type SurfaceMaterial,
} from './cabinetProfile';

function surface(
  name: string,
  topMm: number,
  thicknessMm: number,
  material: SurfaceMaterial,
  provenance: Provenance,
  maxLoadKg: number | null = null,
): CabinetSurface {
  return { name, topMm, thicknessMm, material, maxLoadKg, provenance };
}

/** A glass shelf that is the profile's plate (smaller than the interior, set back from the front). */
function plate(s: CabinetSurface): CabinetSurface {
  return { ...s, plate: true };
}

// --------------------------------------------------------------- IKEA KLINGSBO
// THE DEFAULT (Ross 2026-10-11): a glass-door case on a steel frame, one open
// shelf below it near the floor, an open top, splayed legs. IKEA no longer
// sells it (Ross 10-11), so the sizes come from Wayback snapshots of the
// product page and its measurement illustration, and the assembly
// instructions IKEA still hosts. IKEA publishes the outside (45 x 40 x
// 180 cm), the legs' footprint (54.5 x 45 cm), the open shelf's height
// (15.5 cm to its underside) and the 22 cm above it; everything else is read
// off the illustration, which is drawn to scale (6.41 px per cm; it matches
// all seven published lengths within 0.3 %), and marked 'verify'.
const KLINGSBO_PAGE_US =
  'https://web.archive.org/web/20250701003134/https://www.ikea.com/us/en/p/klingsbo-glass-door-cabinet-black-clear-glass-60128562/';
const KLINGSBO_PAGE_DE =
  'https://web.archive.org/web/20241220230446/https://www.ikea.com/de/de/p/klingsbo-vitrine-schwarz-klarglas-60128562/';
const KLINGSBO_DRAWING =
  'https://web.archive.org/web/20250531220838/https://www.ikea.com/us/en/images/products/klingsbo-glass-door-cabinet-black-clear-glass__0975801_pe812864_s5.jpg';
const KLINGSBO_ASSEMBLY =
  'https://www.ikea.com/us/en/assembly_instructions/klingsbo-glass-door-cabinet-black-clear-glass__AA-306187-11-2.pdf';
const KLINGSBO_FROM_DRAWING: Provenance = {
  kind: 'derived',
  source: 'read off the IKEA measurement illustration at its scale (6.41 px per cm); verify',
};
const KLINGSBO_SHELF_LOAD_KG = 7;

export const IKEA_KLINGSBO: CabinetProfile = {
  id: 'ikea-klingsbo',
  name: 'IKEA KLINGSBO glass-door cabinet',
  maker: 'IKEA',
  preferenceRank: 1,
  frame: 'panels',
  outer: { widthMm: 450, depthMm: 400, heightMm: 1800 },
  interior: { widthMm: 382, depthMm: 335 },
  panels: { sideMm: 33, backMm: 33 },
  materials: { sides: 'glass', back: 'glass', front: 'glassDoor' },
  glassMm: 4,
  surfaces: [
    {
      ...surface('open shelf', 176, 21, 'metal', {
        kind: 'derived',
        source: 'IKEA: 15.5 cm to its underside; its 21 mm rail from the illustration; verify',
      }),
      outsideDoor: true,
    },
    surface('cabinet floor', 421, 25, 'glass', {
      kind: 'derived',
      source: 'IKEA: 22 cm clear above the open shelf; its 25 mm frame from the illustration; verify',
    }),
    plate(surface('glass shelf 2', 694, 17, 'glass', KLINGSBO_FROM_DRAWING, KLINGSBO_SHELF_LOAD_KG)),
    plate(surface('glass shelf 3', 969, 17, 'glass', KLINGSBO_FROM_DRAWING, KLINGSBO_SHELF_LOAD_KG)),
    plate(surface('glass shelf 4', 1243, 17, 'glass', KLINGSBO_FROM_DRAWING, KLINGSBO_SHELF_LOAD_KG)),
    plate(surface('glass shelf 5', 1519, 17, 'glass', KLINGSBO_FROM_DRAWING, KLINGSBO_SHELF_LOAD_KG)),
    surface('top', 1800, 28, 'glass', { kind: 'cited', source: 'IKEA: 180 cm tall' }),
  ],
  shelves: { mode: 'fixed' },
  plate: { widthMm: 359, depthMm: 314, frontInsetMm: 12 },
  top: { usable: true },
  base: { style: 'legs', heightMm: 155, leg: { sectionMm: 33, splay: true } },
  footprint: { widthMm: 545, depthMm: 450, frontOverhangMm: 50 },
  discontinued: true,
  sources: [
    { url: KLINGSBO_PAGE_US, date: '2025-07-01', facts: '17 3/4 x 15 3/4 x 70 7/8 in; 15 lb per shelf; tempered glass back, bottom, door and top; steel frame' },
    { url: KLINGSBO_PAGE_DE, date: '2024-12-20', facts: '45 x 40 x 180 cm; 7 kg per shelf' },
    { url: KLINGSBO_DRAWING, date: '2025-05-31', facts: '45 x 40.1 x 180 cm; legs 54.5 cm wide, 45 cm deep; open shelf 15.5 cm up; 22 cm above it' },
    { url: KLINGSBO_ASSEMBLY, date: '2026-10-11', facts: 'AA-306187-11: four glass shelves on clip supports, splayed legs, a mesh open shelf' },
  ],
  provenance: {
    outer: { kind: 'cited', source: 'IKEA listing: 45 x 40 x 180 cm (US: 17 3/4 x 15 3/4 x 70 7/8 in)' },
    interior: KLINGSBO_FROM_DRAWING,
    panels: { kind: 'derived', source: 'steel corner posts (and legs) about 33 mm, from the illustration; glass in between; verify' },
    boards: KLINGSBO_FROM_DRAWING,
    shelves: { kind: 'derived', source: 'fixed: each glass shelf rests on four clip supports (assembly step 11); heights from the illustration' },
    base: { kind: 'cited', source: 'IKEA: the open shelf sits 15.5 cm up on four legs, the front pair splayed' },
    footprint: { kind: 'cited', source: 'IKEA: the legs stand 54.5 cm wide and 45 cm deep (the body is 45 x 40 cm)' },
    glass: { kind: 'placeholder', source: 'pane thickness not published; assumed 4 mm like the Detolf' },
    plate: KLINGSBO_FROM_DRAWING,
    loads: { kind: 'cited', source: 'IKEA: 7 kg (15 lb) per shelf; open shelf, floor and top not published' },
  },
};

// ---------------------------------------------------------------- IKEA DETOLF
// Second (Ross 2026-10-11; the default from CC3 until then). Values from the
// DETOLF-VERIFY check (2026-09-30): IKEA publishes the outside size, the max
// load per shelf, the materials and, on its measurement illustration, rounded
// clear heights (40 / 39 / 39 / 40 cm) and a 38 cm inside width, which with
// the boards overrun the 163 cm; the inside here comes from owners' tape
// measurements (three independent posts agree within 7 mm) and exact-fit
// glass shops. IKEA withdrew it in 2024: the product page redirects to the
// catalogue (fetched 2026-10-11; Wayback has the redirect from 2024-08-15),
// so the sizes cite the last snapshot. Owners butt Detolfs together: no
// footprint beyond the body, adjacency gap 0. Not modelled yet (render units): the four ~6 mm
// corner rods of the shelf-support ladders.
const DETOLF_INTERIOR_STACK: Provenance = {
  kind: 'derived',
  source: 'from measured clear heights 396 / 387 / 387 / 378 mm (owners), 4 mm glass and a ~35 mm base board; verify',
};
const DETOLF_PANEL_GLASS: Provenance = {
  kind: 'placeholder',
  source: 'side, back and door glass not published; assumed 4 mm like the shelves',
};
const DETOLF_SHELF_LOAD_KG = 3.5;

export const IKEA_DETOLF: CabinetProfile = {
  id: 'ikea-detolf',
  name: 'IKEA DETOLF glass-door cabinet',
  maker: 'IKEA',
  preferenceRank: 2,
  frame: 'panels',
  outer: { widthMm: 430, depthMm: 370, heightMm: 1630 },
  interior: { widthMm: 389, depthMm: 330 },
  panels: { sideMm: 4, backMm: 4 },
  materials: { sides: 'glass', back: 'glass', front: 'glassDoor' },
  glassMm: 4,
  surfaces: [
    surface('base floor', 35, 35, 'wood', DETOLF_INTERIOR_STACK),
    plate(surface('glass shelf 2', 435, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG)),
    plate(surface('glass shelf 3', 826, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG)),
    plate(surface('glass shelf 4', 1217, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG)),
    surface('top', 1630, 35, 'wood', { kind: 'cited', source: 'IKEA: 163 cm tall' }),
  ],
  shelves: { mode: 'fixed' },
  plate: { widthMm: 383, depthMm: 290, frontInsetMm: 20 },
  top: { usable: true },
  base: { style: 'none', heightMm: 0 },
  discontinued: true,
  sources: [
    {
      url: 'https://web.archive.org/web/20231111035309/https://www.ikea.com/us/en/p/detolf-glass-door-cabinet-black-brown-10119206/',
      date: '2023-11-11',
      facts: '16 3/4 x 14 3/8 x 64 1/8 in; 8 lb per shelf; marked last chance',
    },
    {
      url: 'https://web.archive.org/web/20231111004525/https://www.ikea.com/us/en/images/products/detolf-glass-door-cabinet-black-brown__0548121_pe656977_s5.jpg',
      date: '2023-11-11',
      facts: '43 x 37 x 163 cm; inside 38 cm wide; clear heights labelled 40 / 39 / 39 / 40 cm (rounded)',
    },
  ],
  provenance: {
    outer: { kind: 'cited', source: 'IKEA listing: 43 x 37 x 163 cm (US: 16 3/4 x 14 3/8 x 64 1/8 in)' },
    interior: { kind: 'measured', source: 'owners: inside about 387-391 W x 330-343 D mm' },
    panels: DETOLF_PANEL_GLASS,
    boards: {
      kind: 'derived',
      source: 'glass shelves 4 mm (glass shops); top and base boards ~35 mm each from the 68-71 mm the outside leaves over the inside; verify',
    },
    shelves: { kind: 'measured', source: 'fixed: the glass rests on two steel shelf-support ladders (owners)' },
    base: { kind: 'derived', source: 'the base board sits on the floor; no plinth or legs in any source' },
    glass: DETOLF_PANEL_GLASS,
    plate: {
      kind: 'derived',
      source: 'plate about 383 x 290 mm (owners, glass shops); centred front to back, about 20 mm clear; verify',
    },
    loads: { kind: 'cited', source: 'IKEA: 3.50 kg (8 lb) per shelf; base floor and top not published' },
  },
};

// --------------------------------------------------------- open steel rack
// Ross's own open black steel boltless rack: a preset with LOW preference
// (Ross CC3). Inch-native: 36 x 18 x 72 in to the top surface. Shelf 3
// (24 in) and the top (72 in) are his; shelves 1, 2 and 4 stay placeholders
// until he measures them.
const RACK_ESTIMATE: Provenance = {
  kind: 'placeholder',
  source: 'estimated from photos (beam ~1.75 in, post ~1.5 in, keyhole pitch ~2 in); confirm',
};
const RACK_BEAM_MM = inchesToMm(1.75);
const RACK_POST_MM = inchesToMm(1.5);

export const OPEN_STEEL_RACK: CabinetProfile = {
  id: 'open-steel-rack',
  name: 'Open steel rack',
  preferenceRank: 3,
  frame: 'open-rack',
  outer: { widthMm: inchesToMm(36), depthMm: inchesToMm(18), heightMm: inchesToMm(72) },
  interior: { widthMm: inchesToMm(36 - 2 * 1.5), depthMm: inchesToMm(18 - 2 * 1.5) },
  panels: { sideMm: 0, backMm: 0 },
  materials: { sides: 'open', back: 'open', front: 'open' },
  glassMm: null,
  surfaces: [
    surface('shelf 1', inchesToMm(6.5), RACK_BEAM_MM, 'wood', {
      kind: 'placeholder',
      source: 'shelf 2 less 5.5 in (Ross); shelf 2 is itself a placeholder',
    }),
    surface('shelf 2', inchesToMm(12), RACK_BEAM_MM, 'wood', {
      kind: 'placeholder',
      source: '12 in until Ross measures it',
    }),
    surface('shelf 3', inchesToMm(24), RACK_BEAM_MM, 'wood', { kind: 'measured', source: 'Ross: 24 in' }),
    surface('shelf 4', inchesToMm(47), RACK_BEAM_MM, 'wood', {
      kind: 'placeholder',
      source: 'about 47 in from a photo (46-48 in) until Ross measures it',
    }),
    surface('top', inchesToMm(72), RACK_BEAM_MM, 'wood', { kind: 'measured', source: 'Ross: 72 in' }),
  ],
  shelves: { mode: 'adjustable', pinPitchMm: inchesToMm(2) },
  top: { usable: true },
  base: { style: 'posts', heightMm: inchesToMm(6.5 - 1.75) },
  rack: { postMm: RACK_POST_MM, beamMm: RACK_BEAM_MM },
  discontinued: false,
  sources: [],
  provenance: {
    outer: { kind: 'measured', source: 'Ross: 36 x 18 x 72 in to the top surface' },
    interior: { kind: 'derived', source: 'outer less two corner posts each way (the posts are an estimate)' },
    panels: { kind: 'measured', source: 'Ross: open sides and back, no doors' },
    boards: RACK_ESTIMATE,
    shelves: RACK_ESTIMATE,
    base: { kind: 'placeholder', source: "the corner posts are the legs, open below shelf 1's beam (shelf 1 is a placeholder)" },
    rack: RACK_ESTIMATE,
  },
};

const PRESET_DATA: readonly CabinetProfile[] = [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK];

/** A copy sorted most preferred first (rank 1 first); the list given is left as it is. */
export function byPreferenceRank(presets: readonly CabinetProfile[]): CabinetProfile[] {
  return [...presets].sort((a, b) => a.preferenceRank - b.preferenceRank);
}

/** Every preset, most preferred first. */
export const CABINET_PRESETS: readonly CabinetProfile[] = byPreferenceRank(PRESET_DATA);

/** The IKEA KLINGSBO (Ross 2026-10-11). A user's own choice is kept per device (casePrefs, CC14). */
export const DEFAULT_CABINET_PROFILE_ID = IKEA_KLINGSBO.id;
export const DEFAULT_CABINET_PROFILE: CabinetProfile = IKEA_KLINGSBO;

export function getCabinetPreset(id: string): CabinetProfile | undefined {
  return CABINET_PRESETS.find((p) => p.id === id);
}
