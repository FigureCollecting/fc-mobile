/**
 * Dev fixture manifest — 7 transparent matted figures for fully-offline
 * development of the display layer (virtual cases, justified rows, viewer).
 *
 * The PNGs themselves are GITIGNORED (product-photo derivatives never enter
 * the repo). This manifest is code and IS committed: it carries the metadata
 * the display layer needs — native pixel dims, shelf sizing, and the two
 * per-figure footprint scalars that drive the CSS contact shadow (translated
 * from the shelf2.py compositor recipe). When the PNGs are absent (CI), the
 * glob resolves to nothing and imageUrl stays undefined — components fall
 * back to placeholders, so builds/tests never depend on the images.
 */
import type { Figure } from '@figurecollecting/fc-shared';

/** Display-layer metadata for a figure image (matted or not). */
export interface FigureDisplayMeta {
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

// Lazy-safe image resolution: glob is empty when the gitignored PNGs are absent.
const IMAGE_URLS = import.meta.glob('./*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

function img(name: string): string | undefined {
  return IMAGE_URLS[`./${name}.png`];
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
  meta: FigureDisplayMeta;
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
export const FIXTURE_META: Record<string, FigureDisplayMeta> = Object.fromEntries(
  DEFS.map((d) => [d.id, d.meta]),
);

const FIXTURE_MODE_KEY = 'fc-fixture-mode';

/**
 * Fixture mode default: ON in dev, OFF in tests and production builds.
 * Overridable via localStorage ('on' | 'off') for demoing against real data.
 */
export function isFixtureMode(): boolean {
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
