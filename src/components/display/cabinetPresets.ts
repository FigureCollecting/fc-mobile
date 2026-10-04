/**
 * Cabinet presets: DATA only (case-cabinet-design-v3 preset_library). Adding
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

// ---------------------------------------------------------------- IKEA DETOLF
// The DEFAULT (Ross CC3, 2026-09-29). Values from the DETOLF-VERIFY check
// (2026-09-30): IKEA publishes only the outside size, the max load per shelf
// and the materials; everything inside comes from owners' tape measurements
// (three independent posts agree within 7 mm) and exact-fit glass shops.
// IKEA seems to have stopped selling it around 2024; it stays the most
// common collector cabinet. Not modelled yet (render units): the four ~6 mm
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
  preferenceRank: 1,
  frame: 'panels',
  outer: { widthMm: 430, depthMm: 370, heightMm: 1630 },
  interior: { widthMm: 389, depthMm: 330 },
  panels: { sideMm: 4, backMm: 4 },
  materials: { sides: 'glass', back: 'glass', front: 'glassDoor' },
  glassMm: 4,
  surfaces: [
    surface('base floor', 35, 35, 'wood', DETOLF_INTERIOR_STACK),
    surface('glass shelf 2', 435, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG),
    surface('glass shelf 3', 826, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG),
    surface('glass shelf 4', 1217, 4, 'glass', DETOLF_INTERIOR_STACK, DETOLF_SHELF_LOAD_KG),
    surface('top', 1630, 35, 'wood', { kind: 'cited', source: 'IKEA: 163 cm tall' }),
  ],
  shelves: { mode: 'fixed' },
  plate: { widthMm: 383, depthMm: 290, frontInsetMm: 20 },
  top: { usable: true },
  base: { style: 'none', heightMm: 0 },
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

// ---------------------------------------------------------- v1 placeholders
// Ross will send the sizes he wants for these; v1's numbers stand in until
// then, so every value is a placeholder (case-cabinet-design-v3 order 2-6).
const V1_PLACEHOLDER: Provenance = {
  kind: 'placeholder',
  source: "case-cabinet-design v1 preset; stands in until Ross sends the sizes he wants",
};
const V1_PROVENANCE = {
  outer: V1_PLACEHOLDER,
  interior: V1_PLACEHOLDER,
  panels: V1_PLACEHOLDER,
  boards: V1_PLACEHOLDER,
  shelves: V1_PLACEHOLDER,
  base: V1_PLACEHOLDER,
} as const;

export const OPEN_BOOKCASE: CabinetProfile = {
  id: 'open-bookcase',
  name: 'Open-front bookcase',
  preferenceRank: 2,
  frame: 'panels',
  outer: { widthMm: 800, depthMm: 300, heightMm: 1800 },
  interior: { widthMm: 764, depthMm: 294 },
  panels: { sideMm: 18, backMm: 6 },
  materials: { sides: 'wood', back: 'solid', front: 'open' },
  glassMm: null,
  surfaces: [
    surface('base floor', 78, 18, 'wood', V1_PLACEHOLDER),
    surface('shelf 2', 422.4, 18, 'wood', V1_PLACEHOLDER),
    surface('shelf 3', 766.8, 18, 'wood', V1_PLACEHOLDER),
    surface('shelf 4', 1111.2, 18, 'wood', V1_PLACEHOLDER),
    surface('shelf 5', 1455.6, 18, 'wood', V1_PLACEHOLDER),
    surface('top', 1800, 18, 'wood', V1_PLACEHOLDER),
  ],
  shelves: { mode: 'adjustable', pinPitchMm: 32 },
  top: { usable: true },
  base: { style: 'plinth', heightMm: 60 },
  provenance: V1_PROVENANCE,
};

export const GLASS_CABINET_ON_LEGS: CabinetProfile = {
  id: 'glass-cabinet-legs',
  name: 'Glass cabinet on legs',
  preferenceRank: 3,
  frame: 'panels',
  outer: { widthMm: 610, depthMm: 400, heightMm: 1830 },
  interior: { widthMm: 600, depthMm: 390 },
  panels: { sideMm: 5, backMm: 5 },
  materials: { sides: 'glass', back: 'glass', front: 'glassDoor' },
  glassMm: 5,
  surfaces: [
    surface('base floor', 168, 18, 'wood', V1_PLACEHOLDER),
    surface('glass shelf 2', 580.5, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 3', 993, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 4', 1405.5, 6, 'glass', V1_PLACEHOLDER),
    surface('top', 1830, 18, 'wood', V1_PLACEHOLDER),
  ],
  shelves: { mode: 'adjustable', pinPitchMm: 32 },
  top: { usable: true },
  base: { style: 'legs', heightMm: 150, leg: { taper: true } },
  provenance: { ...V1_PROVENANCE, glass: V1_PLACEHOLDER },
};

// ------------------------------------------------------------------- Unit-A
// The commissioned perspective model's 6 ft custom wood unit: 36 x 72 x 18 in,
// 3/4 in stock, shelf tops at 3.75 in and then evenly to 72 in. Inch-native.
const UNIT_A_SPEC: Provenance = {
  kind: 'cited',
  source: 'commissioned perspective model: 36 x 72 x 18 in, 3/4 in stock, tops at 3.75 in then evenly to 72 in',
};
const UNIT_A_BOARD_MM = inchesToMm(0.75);

export const UNIT_A: CabinetProfile = {
  id: 'unit-a',
  name: 'Unit-A custom wood (6 ft)',
  preferenceRank: 4,
  frame: 'panels',
  outer: { widthMm: inchesToMm(36), depthMm: inchesToMm(18), heightMm: inchesToMm(72) },
  interior: { widthMm: inchesToMm(34.5), depthMm: inchesToMm(17.75) },
  panels: { sideMm: UNIT_A_BOARD_MM, backMm: inchesToMm(0.25) },
  materials: { sides: 'wood', back: 'solid', front: 'open' },
  glassMm: null,
  surfaces: [
    surface('shelf 1', inchesToMm(3.75), UNIT_A_BOARD_MM, 'wood', UNIT_A_SPEC),
    surface('shelf 2', inchesToMm(20.8125), UNIT_A_BOARD_MM, 'wood', UNIT_A_SPEC),
    surface('shelf 3', inchesToMm(37.875), UNIT_A_BOARD_MM, 'wood', UNIT_A_SPEC),
    surface('shelf 4', inchesToMm(54.9375), UNIT_A_BOARD_MM, 'wood', UNIT_A_SPEC),
    surface('top', inchesToMm(72), UNIT_A_BOARD_MM, 'wood', UNIT_A_SPEC),
  ],
  shelves: { mode: 'fixed' },
  top: { usable: true },
  base: { style: 'plinth', heightMm: inchesToMm(3) },
  provenance: {
    outer: UNIT_A_SPEC,
    interior: { kind: 'derived', source: '36 in less two 3/4 in sides; 18 in less the 1/4 in back' },
    panels: { kind: 'placeholder', source: '3/4 in sides; the 1/4 in back is assumed by the model' },
    boards: UNIT_A_SPEC,
    shelves: UNIT_A_SPEC,
    base: { kind: 'derived', source: 'a 3 in plinth under the 3/4 in bottom shelf (top at 3.75 in)' },
  },
};

export const WIDE_CUSTOM: CabinetProfile = {
  id: 'wide-custom',
  name: 'Wide custom cabinet',
  preferenceRank: 5,
  frame: 'panels',
  outer: { widthMm: 900, depthMm: 450, heightMm: 1950 },
  interior: { widthMm: 864, depthMm: 439 },
  panels: { sideMm: 18, backMm: 6 },
  materials: { sides: 'wood', back: 'solid', front: 'glassDoor' },
  glassMm: 5,
  surfaces: [
    surface('base floor', 118, 18, 'wood', V1_PLACEHOLDER),
    surface('glass shelf 2', 421, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 3', 724, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 4', 1027, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 5', 1330, 6, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 6', 1633, 6, 'glass', V1_PLACEHOLDER),
    surface('top', 1950, 18, 'wood', V1_PLACEHOLDER),
  ],
  shelves: { mode: 'adjustable', pinPitchMm: 32 },
  top: { usable: true },
  base: { style: 'legs', heightMm: 100 },
  provenance: { ...V1_PROVENANCE, glass: V1_PLACEHOLDER },
};

export const SHORT_PITCH: CabinetProfile = {
  id: 'short-pitch',
  name: 'Short-pitch unit (nendoroids, prize figures)',
  preferenceRank: 6,
  frame: 'panels',
  outer: { widthMm: 600, depthMm: 300, heightMm: 1800 },
  interior: { widthMm: 564, depthMm: 289 },
  panels: { sideMm: 18, backMm: 6 },
  materials: { sides: 'wood', back: 'solid', front: 'glassDoor' },
  glassMm: 5,
  surfaces: [
    surface('base floor', 78, 18, 'wood', V1_PLACEHOLDER),
    surface('glass shelf 2', 293, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 3', 508, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 4', 723, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 5', 938, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 6', 1153, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 7', 1368, 5, 'glass', V1_PLACEHOLDER),
    surface('glass shelf 8', 1583, 5, 'glass', V1_PLACEHOLDER),
    surface('top', 1800, 18, 'wood', V1_PLACEHOLDER),
  ],
  shelves: { mode: 'adjustable', pinPitchMm: 32 },
  top: { usable: true },
  base: { style: 'plinth', heightMm: 60 },
  provenance: { ...V1_PROVENANCE, glass: V1_PLACEHOLDER },
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
  preferenceRank: 7,
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

const PRESET_DATA: readonly CabinetProfile[] = [
  IKEA_DETOLF,
  OPEN_BOOKCASE,
  GLASS_CABINET_ON_LEGS,
  UNIT_A,
  WIDE_CUSTOM,
  SHORT_PITCH,
  OPEN_STEEL_RACK,
];

/** A copy sorted most preferred first (rank 1 first); the list given is left as it is. */
export function byPreferenceRank(presets: readonly CabinetProfile[]): CabinetProfile[] {
  return [...presets].sort((a, b) => a.preferenceRank - b.preferenceRank);
}

/** Every preset, most preferred first. */
export const CABINET_PRESETS: readonly CabinetProfile[] = byPreferenceRank(PRESET_DATA);

/** The IKEA Detolf (Ross CC3). A user's own default choice is stored per device later (SC-5). */
export const DEFAULT_CABINET_PROFILE_ID = IKEA_DETOLF.id;
export const DEFAULT_CABINET_PROFILE: CabinetProfile = IKEA_DETOLF;

export function getCabinetPreset(id: string): CabinetProfile | undefined {
  return CABINET_PRESETS.find((p) => p.id === id);
}
