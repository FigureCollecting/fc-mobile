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
import type { FigureImageRef } from '../components/display/figureArt';
import type { ItemSync, LocalMeta } from '../local/figures';

/**
 * Display-layer metadata for a DEV FIXTURE figure image (matted or not).
 * Named FixtureDisplayMeta (not FigureDisplayMeta) so it doesn't shadow
 * fc-shared's FigureDisplayMeta API contract (@figurecollecting/fc-shared)
 * — the two are different shapes serving different purposes: this one is
 * hand-authored per dev fixture, that one is produced by image-manager for
 * real synced figures. displayMeta.ts's getDisplayMeta() maps the latter
 * into the former's shape (the local render meta CabinetScene/packCabinets/
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

/** The masked branch's halves (CASE-ADAPT): an opaque clean copy and a separate mask, both synthetic. */
const CLEAN: Record<string, string> = import.meta.glob('./synthetic/clean/*.png', { eager: true, import: 'default', query: '?url' });
const MASK: Record<string, string> = import.meta.glob('./synthetic/mask/*.png', { eager: true, import: 'default', query: '?url' });
/** The same three for the figures drawn off-centre in their pictures (?fxasym=1). */
const ASYM: Record<string, string> = import.meta.glob('./synthetic/asym/*.png', { eager: true, import: 'default', query: '?url' });
const ASYM_CLEAN: Record<string, string> = import.meta.glob('./synthetic/asym/clean/*.png', { eager: true, import: 'default', query: '?url' });
const ASYM_MASK: Record<string, string> = import.meta.glob('./synthetic/asym/mask/*.png', { eager: true, import: 'default', query: '?url' });

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
  /** Labelled width, mm, the way a real synced figure's ProductCard gives
   *  one. Here it is how wide the SYNTHETIC stand-in's cut-out draws at
   *  heightMm over its clear margins (true scale), rounded up, so the
   *  default fixtures pack by their labels. A real cut-out can draw wider
   *  than its label (the sign-off Madoka's wings: 155 mm drawn, 86 mm
   *  labelled); the case packs cut-out and masked art by the wider of the
   *  two once it has read the picture's alpha (?fxwidth exercises that). */
  widthMm: number;
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
    widthMm: 121,
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
    widthMm: 245,
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
    widthMm: 85,
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
    widthMm: 86,
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
    widthMm: 35,
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
    widthMm: 286,
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
    widthMm: 339,
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
    dimensions: { heightMm: def.heightMm, widthMm: def.widthMm },
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

export type FixtureBranch = 'matted' | 'masked' | 'framed' | 'silhouette';

const FIXTURE_BRANCH_PARAM = 'fxbranch';

/**
 * Dev-only switch for the case's render branches: `?fxbranch=masked` draws
 * the fixtures as the image list will give a masked figure (a clean copy
 * plus its separate mask, getFixtureImageRef), `?fxbranch=framed` as a real
 * figure without a mask draws today (its clean copy, framed),
 * `?fxbranch=silhouette` as one without an image. Matted (the fixtures as
 * they are: cut-outs) for anything else.
 */
export function getFixtureBranch(): FixtureBranch {
  const raw = new URLSearchParams(location.search).get(FIXTURE_BRANCH_PARAM);
  return raw === 'masked' || raw === 'framed' || raw === 'silhouette' ? raw : 'matted';
}

export type FixtureWidths = 'labelled' | 'none' | 'narrow';

const FIXTURE_WIDTHS_PARAM = 'fxwidth';

/**
 * Dev-only switch for the fixtures' labelled widths, the shapes a real
 * collection brings to the case: `?fxwidth=none` drops them (a figure the
 * catalogue gives no width), `?fxwidth=narrow` halves them, under what each
 * cut-out draws at true scale, as the real sign-off cut-outs are. As
 * labelled for anything else.
 */
export function getFixtureWidths(): FixtureWidths {
  const raw = new URLSearchParams(location.search).get(FIXTURE_WIDTHS_PARAM);
  return raw === 'none' || raw === 'narrow' ? raw : 'labelled';
}

function withWidths(figure: Figure, widths: FixtureWidths): Figure {
  if (widths === 'labelled') return figure;
  const { heightMm, widthMm } = figure.dimensions!;
  return { ...figure, dimensions: widths === 'none' ? { heightMm } : { heightMm, widthMm: Math.round(widthMm! / 2) } };
}

const FIXTURE_ASYM_PARAM = 'fxasym';

/**
 * Dev-only switch for art whose figure stands off-centre in its picture, as
 * a real cut-out can (a staff held out, a base off to one side):
 * `?fxasym=1` draws Rem 18 % of her picture's width right of its centre
 * and Spike 30 % (synthetic/asym), in every branch. Off for anything else.
 */
export function getFixtureAsym(): boolean {
  return new URLSearchParams(location.search).get(FIXTURE_ASYM_PARAM) === '1';
}

const FIXTURE_UNIQUE_PARAM = 'fxuniq';

/**
 * Dev-only switch for a long list of distinct pictures, as a real
 * collection has: `?fxuniq=1` draws each repeated copy (`?fx=N`, copy 2 and
 * on) at its own picture URL, the same picture. Off (the copies share their
 * pictures) for anything else.
 */
export function getFixtureUnique(): boolean {
  return new URLSearchParams(location.search).get(FIXTURE_UNIQUE_PARAM) === '1';
}

const FIXTURE_SYNC_PARAM = 'fxsync';

/**
 * Dev-only switch for the local store's state on each tile, as a signed-in
 * collection draws it: `?fxsync=1` gives every fixture a sync badge and a
 * count from SYNC_STATES in turn (`?fx=2` shows them all): Pending, Offline,
 * an as-of of today and of another day, each with no count, x2 and x12, and
 * a quiet synced one. Off for anything else.
 */
export function getFixtureSync(): boolean {
  return new URLSearchParams(location.search).get(FIXTURE_SYNC_PARAM) === '1';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each state's badge (sync, and how long ago its data was current; null for none) and count. */
const SYNC_STATES: { sync: ItemSync; agoMs: number | null; quantity: number }[] = [
  { sync: 'pending', agoMs: null, quantity: 1 },
  { sync: 'offline-stale', agoMs: 0, quantity: 2 },
  { sync: 'offline-stale', agoMs: 2 * DAY_MS, quantity: 12 },
  { sync: 'offline-stale', agoMs: null, quantity: 1 },
  { sync: 'pending', agoMs: null, quantity: 2 },
  { sync: 'offline-stale', agoMs: 0, quantity: 12 },
  { sync: 'offline-stale', agoMs: 2 * DAY_MS, quantity: 1 },
  { sync: 'offline-stale', agoMs: null, quantity: 2 },
  { sync: 'pending', agoMs: null, quantity: 12 },
  { sync: 'offline-stale', agoMs: 0, quantity: 1 },
  { sync: 'offline-stale', agoMs: 2 * DAY_MS, quantity: 2 },
  { sync: 'offline-stale', agoMs: null, quantity: 12 },
  { sync: 'known', agoMs: null, quantity: 3 },
];

/** A fixture as the local store gives it: its id is its head; no copies, card or facets. */
function withSync(figure: Figure, index: number, now: number): Figure {
  const state = SYNC_STATES[index % SYNC_STATES.length];
  const local: LocalMeta = {
    headId: figure._id,
    heads: [figure._id],
    kind: figure.collectionStatus as LocalMeta['kind'],
    copies: [],
    sync: state.sync,
    asOf: state.agoMs === null ? null : new Date(now - state.agoMs).toISOString(),
    factsAsOf: null,
    hasCard: false,
    character: null,
    series: null,
    gtin14s: [],
    uf: {},
    ufTarget: { score: figure._id, note: figure._id, wishability: figure._id },
  };
  return { ...figure, quantity: state.quantity, local } as Figure;
}

/** A repeated copy's picture at its own URL under ?fxuniq=1. */
function copyUrl<T extends string | undefined>(url: T, figureId: string, unique: boolean): T {
  const copy = /-x(\d+)(?:-masked|-framed)?$/.exec(figureId)?.[1];
  return (unique && url && copy ? `${url}?copy=${copy}` : url) as T;
}

const artName = (figureId: string) => figureId.replace(/^fx-/, '').replace(/(-x\d+)?(-masked|-framed)?$/, '');

/** A fixture's cut-out, clean copy and mask: the off-centre ones under ?fxasym=1 where it has them. */
function artFiles(name: string, asym: boolean) {
  const moved = asym ? ASYM[`./synthetic/asym/${name}.png`] : undefined;
  if (!moved) return { cutout: undefined, clean: CLEAN[`./synthetic/clean/${name}.png`], mask: MASK[`./synthetic/mask/${name}.png`] };
  return { cutout: moved, clean: ASYM_CLEAN[`./synthetic/asym/clean/${name}.png`], mask: ASYM_MASK[`./synthetic/asym/mask/${name}.png`] };
}

function toBranch(figure: Figure, branch: FixtureBranch, asym: boolean): Figure {
  // An id outside the fixture manifest resolves UNMATTED_META, exactly like
  // a real figure without displayMeta.
  const { cutout, clean } = artFiles(artName(figure._id), asym);
  if (branch === 'masked') return { ...figure, _id: `${figure._id}-masked`, imageUrl: clean };
  if (branch === 'framed') return { ...figure, _id: `${figure._id}-framed`, imageUrl: clean };
  if (branch === 'silhouette') return { ...figure, imageUrl: undefined };
  return cutout ? { ...figure, imageUrl: cutout } : figure;
}

/**
 * The image list's entry for a fixture of the masked branch (what
 * GetProductImages will give a figure with a mask): its clean copy, its
 * mask and their native size. Undefined for every other figure.
 */
export function getFixtureImageRef(figure: Figure): FigureImageRef | undefined {
  if (!figure._id.endsWith('-masked')) return undefined;
  const name = artName(figure._id);
  const { clean: url, mask: maskUrl } = artFiles(name, getFixtureAsym());
  const meta = FIXTURE_META[`fx-${name}`];
  if (!url || !maskUrl || !meta) return undefined;
  const unique = getFixtureUnique();
  return { url: copyUrl(url, figure._id, unique), maskUrl: copyUrl(maskUrl, figure._id, unique), width: meta.width, height: meta.height };
}

/**
 * The fixture figures, repeated per the `?fx=N` multiplier with unique ids
 * (`fx-rem-x1`, `fx-rem-x2`, ...). getDisplayMeta strips the `-xN` suffix to
 * resolve the original matte metadata, so every repeated copy still renders
 * matted (not a generic framed-photo fallback) — unless `?fxbranch` asks
 * for another branch (getFixtureBranch); `?fxwidth` changes their labelled
 * widths (getFixtureWidths), `?fxasym=1` draws two of them off-centre in
 * their pictures (getFixtureAsym), `?fxuniq=1` draws each copy at its own
 * picture URL (getFixtureUnique), `?fxsync=1` gives each a sync badge and a
 * count (getFixtureSync).
 */
export function getFixtureFigures(
  multiplier = getFixtureMultiplier(),
  branch = getFixtureBranch(),
  widths = getFixtureWidths(),
  asym = getFixtureAsym(),
  unique = getFixtureUnique(),
  sync = getFixtureSync(),
): Figure[] {
  if (multiplier <= 1 && branch === 'matted' && widths === 'labelled' && !asym && !sync) return FIXTURE_FIGURES;
  const out: Figure[] = [];
  for (let copy = 1; copy <= Math.max(1, multiplier); copy++) {
    for (const base of FIXTURE_FIGURES) {
      const figure = withWidths(toBranch(copy === 1 ? base : { ...base, _id: `${base._id}-x${copy}` }, branch, asym), widths);
      out.push(unique ? { ...figure, imageUrl: copyUrl(figure.imageUrl, figure._id, unique) } : figure);
    }
  }
  if (!sync) return out;
  const now = Date.now();
  return out.map((figure, index) => withSync(figure, index, now));
}
