/**
 * Local mirror of fc-shared's `FigureDisplayMeta` API contract (fc-shared
 * PR #13, "Add display+grounding metadata contract to Figure type", merged
 * to fc-shared/develop as v1.5.0 — upstream commit 88e6aa3).
 *
 * FLAGGED, NOT FAKED: fc-mobile pins fc-shared through a private registry
 * (`@figurecollecting/fc-shared": "^1.4.0"` in package.json, registry
 * `https://npm.pkg.github.com` per .npmrc) — not a `file:`/workspace link.
 * This sandbox has no NODE_AUTH_TOKEN to authenticate against GitHub
 * Packages (`npm view @figurecollecting/fc-shared` 401s: "unauthenticated:
 * User cannot be authenticated with the token provided"), so 1.5.0 cannot
 * actually be installed here to prove out via a real `npm install`. The
 * shape below is copied field-for-field from fc-shared's own
 * src/types/index.ts on upstream/develop (verified identical to the local
 * fc-shared checkout's feat/display-grounding-contract branch, commit
 * fd79760 == upstream 88e6aa3 by `git diff --stat`), not guessed.
 *
 * Declaration-merges `displayMeta` onto fc-shared's `Figure` interface so
 * every existing `import type { Figure } from '@figurecollecting/fc-shared'`
 * call site in this repo sees the field without changes. DELETE this file
 * (and switch displayMeta.ts's import) once fc-mobile's dependency is
 * genuinely bumped to `^1.5.0` with real registry access.
 */

/** Fractional horizontal center/width (0..1) of the opaque pixels in a
 *  matted figure image's own bottom contact band — mirrors fc-mobile's
 *  local `ContactBand` (src/components/display/alphaMargin.ts) field for
 *  field. */
export interface FigureContactBand {
  centerXFrac: number;
  widthFrac: number;
}

/**
 * Display + grounding metadata the Python image-manager service PRODUCES
 * (as derivatives of a figure's source image) and fc-mobile CONSUMES to
 * render the figure matted, correctly grounded, and with a lightweight
 * placeholder while the real image loads.
 */
export interface FigureDisplayMeta {
  /** True when a matted (transparent-background) derivative exists. */
  matted?: boolean;
  /** image-manager Image id of the matted derivative. */
  matteImageId?: string;
  /** Version id for the /serve/{id}@{v} URL. */
  matteVersionId?: string;
  /** Fraction (0..1) of the matte image's own height that is transparent
   *  padding below the figure's visible content — the grounding correction. */
  bottomMarginFrac?: number;
  /** Horizontal ground-contact footprint, measured from the matte's alpha
   *  channel. */
  contactBand?: FigureContactBand;
  /** Compact placeholder hash (ThumbHash) for low-cost blur-up rendering. */
  thumbhash?: string;
  /** Dominant color of the source image, as `#RRGGBB`. */
  dominantColor?: string;
}

declare module '@figurecollecting/fc-shared' {
  interface Figure {
    // Display + grounding metadata (image-manager -> fc-mobile contract).
    displayMeta?: FigureDisplayMeta;
  }
}
