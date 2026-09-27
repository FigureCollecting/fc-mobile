/**
 * Dev fixture manifest — 7 transparent matted figures for fully-offline
 * development of the display layer (virtual cases, justified rows, viewer).
 *
 * The real cut-out PNGs are GITIGNORED (product-photo derivatives never
 * enter the repo; copy them in from fc-design-assets for local sign-off).
 * This manifest is code and IS committed: it carries the metadata the
 * display layer needs — native pixel dims, shelf sizing, and the two
 * per-figure footprint scalars that drive the CSS contact shadow (translated
 * from the shelf2.py compositor recipe). Where a real cut-out is absent (CI,
 * clean checkouts) the fixture draws its committed synthetic stand-in,
 * ./synthetic/<name>.png (our own flat shapes, RGBA, same native size;
 * scripts/synthetic-fixtures.mjs), so the case's matted branch renders
 * everywhere. Tests use only the synthetic art (VITE_FIXTURE_ART in
 * .env.test), never the git-ignored files.
 */
import type { Figure } from '@figurecollecting/fc-shared';

/**
 * Display-layer metadata for a DEV FIXTURE figure image (matted or not).
 * Named FixtureDisplayMeta (not FigureDisplayMeta) so it doesn't shadow
 * fc-shared's FigureDisplayMeta API contract (@figurecollecting/fc-shared)
 * — the two are different shapes serving different purposes: this one is
 * hand-authored per dev fixture, that one is produced by image-manager for
 * real synced figures. displayMeta.ts's getDisplayMeta() maps the latter
 * into the former's shape (the local render meta CaseShelf/packShelves/
 * packJustified/sizeResolution/FigureViewer all consume) when a real
 * figure's displayMeta is present.
 */
export interface FixtureDisplayMeta {
  /** Native image width in px. */
  width: number;
  /** Native image height in px. */
  height: number;
  /** width / height. */
  aspect: number;
  /**
   * Visual height relative to the shelf's shared height band (0..1).
   * Standing 1/7-1/8 scale figures ≈ 0.94-1.0; chibi/sitting ≈ 0.66-0.73.
   * (Mirrors HDISP in shelf2.py, normalized to its 360px band.)
   */
  relHeight: number;
  /** Horizontal center of the ground-contact footprint, as a fraction of image width (0..1). */
  footprintCenterX: number;
  /** Width of the ground-contact footprint, as a fraction of image width (0..1). */
  footprintWidth: number;
  /** True when the figure image has a transparent (matted) background. */
  matted: boolean;
  /**
   * False when the matting pipeline could not recover the base (e.g. flat
   * glossy or clear acrylic discs). The shelf renders a slightly stronger,
   * wider contact shadow as a synthetic grounding base for these.
   */
  baseRecovered: boolean;
}

/** Fixture art by glob key: the git-ignored real cut-outs and the committed synthetic stand-ins. */
export interface FixtureArt {
  real: Record<string, string>;
  synthetic: Record<string, string>;
  /** Ignore the real cut-outs (tests), so results never depend on git-ignored files. */
  syntheticOnly: boolean;
}

/** The real cut-out when present (local sign-off), else the synthetic stand-in. */
export function resolveFixtureArt(name: string, art: FixtureArt): string | undefined {
  const real = art.syntheticOnly ? undefined : art.real[`./${name}.png`];
  return real ?? art.synthetic[`./synthetic/${name}.png`];
}

// A build that cannot switch fixture mode on resolves these to undefined
// (vite.config.ts, fixtureArtOnlyWhereFixturesRun), so none of it ships.
const ART: FixtureArt = {
  real: import.meta.glob('./*.png', { eager: true, import: 'default', query: '?url' }),
  synthetic: import.meta.glob('./synthetic/*.png', { eager: true, import: 'default', query: '?url' }),
  syntheticOnly: import.meta.env.VITE_FIXTURE_ART === 'synthetic',
};

function img(name: string): string | undefined {
  return resolveFixtureArt(name, ART);
}

const NOW = '2026-07-01T00:00:00.000Z';

interface FixtureDef {
  id: string;
  name: string;
  manufacturer: string;
  distributor: string;
  scale: string;
  origin: string;
  status: 'owned' | 'ordered' | 'wished';
  tags: string[];
  /** Approximate real physical height in mm (whole object incl. base) for
   *  these actual commercial figure lines — drives proportional sizing the
   *  same way a real synced figure's scraped dimensions would. */
  heightMm: number;
  meta: FixtureDisplayMeta;
}

const DEFS: FixtureDef[] = [
  {
    id: 'fx-rem',
    name: 'Rem',
    manufacturer: 'Good Smile Company',
    distributor: 'Good Smile Company',
    scale: '1/7',
    origin: 'Re:Zero',
    status: 'owned',
    tags: ['maid', 'blue hair'],
    heightMm: 230,
    meta: { width: 550, height: 800, aspect: 0.688, relHeight: 1.0, footprintCenterX: 0.48, footprintWidth: 0.58, matted: true, baseRecovered: true },
  },
  {
    id: 'fx-dark-angel',
    name: 'Dark Angel Olivia',
    manufacturer: 'Max Factory',
    distributor: 'Good Smile Company',
    scale: '1/8',
    origin: 'Original Character',
    status: 'owned',
    tags: ['wings', 'dark'],
    heightMm: 260,
    meta: { width: 600, height: 738, aspect: 0.813, relHeight: 0.98, footprintCenterX: 0.52, footprintWidth: 0.66, matted: true, baseRecovered: true },
  },
  {
    id: 'fx-miku-nendo',
    name: 'Nendoroid Hatsune Miku',
    manufacturer: 'Good Smile Company',
    distributor: 'Good Smile Company',
    scale: 'Unspecified',
    origin: 'Vocaloid',
    status: 'owned',
    tags: ['chibi', 'twin tails'],
    heightMm: 100,
    meta: { width: 523, height: 550, aspect: 0.951, relHeight: 0.69, footprintCenterX: 0.5, footprintWidth: 0.55, matted: true, baseRecovered: true },
  },
  {
    id: 'fx-madoka',
    name: 'Madoka Kaname',
    manufacturer: 'Aniplex',
    distributor: 'Aniplex of America',
    scale: '1/8',
    origin: 'Puella Magi Madoka Magica',
    status: 'owned',
    tags: ['magical girl'],
    heightMm: 180,
    meta: { width: 600, height: 712, aspect: 0.843, relHeight: 0.94, footprintCenterX: 0.5, footprintWidth: 0.7, matted: true, baseRecovered: false },
  },
  {
    id: 'fx-spike',
    name: 'Spike Spiegel',
    manufacturer: 'MegaHouse',
    distributor: 'Crunchyroll',
    scale: '1/8',
    origin: 'Cowboy Bebop',
    status: 'owned',
    tags: ['suit'],
    heightMm: 220,
    meta: { width: 550, height: 800, aspect: 0.688, relHeight: 1.0, footprintCenterX: 0.5, footprintWidth: 0.4, matted: true, baseRecovered: false },
  },
  {
    id: 'fx-miku-deepsea',
    name: 'Hatsune Miku: Deep Sea Girl',
    manufacturer: 'Good Smile Company',
    distributor: 'Good Smile Company',
    scale: '1/8',
    origin: 'Vocaloid',
    status: 'ordered',
    tags: ['diorama', 'blue hair'],
    // Low reclining diorama pose — much shorter off the base than a
    // standing 1/8 figure despite the same nominal scale.
    heightMm: 150,
    meta: { width: 600, height: 400, aspect: 1.5, relHeight: 0.72, footprintCenterX: 0.5, footprintWidth: 0.8, matted: true, baseRecovered: true },
  },
  {
    id: 'fx-ryuuko',
    name: 'Ryuko Matoi',
    manufacturer: 'FREEing',
    distributor: 'Good Smile Company',
    scale: '1/7',
    origin: 'Kill la Kill',
    status: 'wished',
    tags: ['school uniform'],
    heightMm: 230,
    meta: { width: 600, height: 412, aspect: 1.456, relHeight: 0.7, footprintCenterX: 0.5, footprintWidth: 0.72, matted: true, baseRecovered: true },
  },
];

function toFigure(def: FixtureDef): Figure {
  return {
    _id: def.id,
    name: def.name,
    manufacturer: def.manufacturer,
    scale: def.scale,
    origin: def.origin,
    category: 'Prepainted',
    classification: 'Figures',
    tags: def.tags,
    collectionStatus: def.status,
    imageUrl: img(def.id.replace(/^fx-/, '')),
    dimensions: { heightMm: def.heightMm },
    companyRoles: [
      { companyId: `c-${def.id}`, companyName: def.distributor, roleId: 'r-dist', roleName: 'Distributor' },
    ],
    userId: 'fixture-user',
    createdAt: NOW,
    updatedAt: NOW,
  } as Figure;
}

/** The fixture figures, shaped exactly like API figures. */
export const FIXTURE_FIGURES: Figure[] = DEFS.map(toFigure);

/** Display metadata keyed by figure id. */
export const FIXTURE_META: Record<string, FixtureDisplayMeta> = Object.fromEntries(
  DEFS.map((d) => [d.id, d.meta]),
);

const FIXTURE_MODE_KEY = 'fc-fixture-mode';

/**
 * Fixture mode default: ON in dev, OFF in tests and production builds.
 * Overridable via localStorage ('on' | 'off') for demoing against real data —
 * but only in a dev build, or a build that opted in via
 * VITE_ALLOW_FIXTURE_OVERRIDE (set only in .env.test, for the e2e
 * overlay/smoke suites that exercise a real `vite preview` build offline).
 * A plain production build ignores the override entirely, so it can never be
 * flipped on from outside the app (e.g. pasted into devtools) to bypass
 * sign-in.
 */
export function isFixtureMode(): boolean {
  const overrideAllowed =
    import.meta.env.DEV || import.meta.env.VITE_ALLOW_FIXTURE_OVERRIDE === 'true';
  if (!overrideAllowed) return false;

  try {
    const stored = localStorage.getItem(FIXTURE_MODE_KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    /* localStorage unavailable */
  }
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

export function setFixtureMode(on: boolean): void {
  try {
    localStorage.setItem(FIXTURE_MODE_KEY, on ? 'on' : 'off');
  } catch {
    /* localStorage unavailable */
  }
}

const FIXTURE_MULTIPLIER_PARAM = 'fx';

/**
 * Dev-only stress-test multiplier: `?fx=N` repeats the 7-figure manifest N
 * times so the display layer can be exercised at real-collection scale
 * (virtualization) without committing hundreds of fixture images. 1 (off)
 * for anything absent, non-numeric, or <= 1.
 */
export function getFixtureMultiplier(): number {
  try {
    const raw = new URLSearchParams(location.search).get(FIXTURE_MULTIPLIER_PARAM);
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 1 ? n : 1;
  } catch {
    return 1;
  }
}

export type FixtureBranch = 'matted' | 'framed' | 'silhouette';

const FIXTURE_BRANCH_PARAM = 'fxbranch';

/**
 * Dev-only switch for the case's three render branches: `?fxbranch=framed`
 * draws the fixtures as a real figure without matting data draws today (a
 * framed photo), `?fxbranch=silhouette` as one without an image. Matted
 * (the fixtures as they are) for anything else.
 */
export function getFixtureBranch(): FixtureBranch {
  const raw = new URLSearchParams(location.search).get(FIXTURE_BRANCH_PARAM);
  return raw === 'framed' || raw === 'silhouette' ? raw : 'matted';
}

function toBranch(figure: Figure, branch: FixtureBranch): Figure {
  // An id outside the fixture manifest resolves UNMATTED_META, exactly like
  // a real figure without displayMeta.
  if (branch === 'framed') return { ...figure, _id: `${figure._id}-framed` };
  if (branch === 'silhouette') return { ...figure, imageUrl: undefined };
  return figure;
}

/**
 * The fixture figures, repeated per the `?fx=N` multiplier with unique ids
 * (`fx-rem-x1`, `fx-rem-x2`, ...). getDisplayMeta strips the `-xN` suffix to
 * resolve the original matte metadata, so every repeated copy still renders
 * matted (not a generic framed-photo fallback) — unless `?fxbranch` asks
 * for another branch (getFixtureBranch).
 */
export function getFixtureFigures(multiplier = getFixtureMultiplier(), branch = getFixtureBranch()): Figure[] {
  if (multiplier <= 1 && branch === 'matted') return FIXTURE_FIGURES;
  const out: Figure[] = [];
  for (let copy = 1; copy <= Math.max(1, multiplier); copy++) {
    for (const base of FIXTURE_FIGURES) {
      out.push(toBranch(copy === 1 ? base : { ...base, _id: `${base._id}-x${copy}` }, branch));
    }
  }
  return out;
}
