import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from '../../types/figureDisplayMeta';

const RUNTIME_IMAGE_MANAGER_URL_KEY = 'fc.imageManagerUrl';
const PRODUCTION_IMAGE_MANAGER_URL = 'https://images.figurecollecting.com';

/**
 * image-manager base URL resolution precedence (mirrors src/api/client.ts's
 * resolveApiBaseUrl):
 *   1. Runtime override — localStorage.getItem('fc.imageManagerUrl')
 *      Same escape hatch as the API URL override, for flipping a deployed
 *      build to a staging image-manager without a rebuild.
 *   2. Build-time env — import.meta.env.VITE_IMAGE_MANAGER_URL
 *      Set in .env.development / .env.test / .env.production.
 *   3. Fallback — PRODUCTION_IMAGE_MANAGER_URL.
 */
export function resolveImageManagerBaseUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem(RUNTIME_IMAGE_MANAGER_URL_KEY);
      if (override && override.trim().length > 0) {
        return override.trim();
      }
    }
  } catch {
    // localStorage can throw in private mode / sandboxed frames — fall through.
  }

  const envUrl = import.meta.env.VITE_IMAGE_MANAGER_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim();
  }

  return PRODUCTION_IMAGE_MANAGER_URL;
}

/**
 * Builds the image-manager content-addressed serve URL for a matte
 * derivative: `GET /serve/{image_id}@{version_id}` (image-manager's
 * app/routes/serve_routes.py — `serve_version`, keyed on Image.id +
 * ImageVersion.id). Pure function — takes the base URL explicitly rather
 * than resolving it itself, so it's trivially unit-testable without
 * touching env/localStorage. Returns undefined (nothing to build) when
 * either matte id is absent, so callers can fall through to the figure's
 * plain imageUrl.
 */
export function buildMatteServeUrl(
  displayMeta: FigureDisplayMeta | undefined,
  baseUrl: string,
): string | undefined {
  const imageId = displayMeta?.matteImageId;
  const versionId = displayMeta?.matteVersionId;
  if (!imageId || !versionId) return undefined;

  const trimmedBase = baseUrl.replace(/\/+$/, '');
  return `${trimmedBase}/serve/${imageId}@${versionId}`;
}

/**
 * Resolves the image URL to actually render for a figure: the matted
 * derivative when the matting pipeline produced one (figure.displayMeta),
 * else the figure's plain (unmatted) source image. Standalone from
 * getDisplayMeta's render-metadata mapping (displayMeta.ts) — CaseShelf and
 * FigureViewer both read `figure.imageUrl` directly rather than through
 * getDisplayMeta, so this is the seam a future task wires the matted URL
 * into those `<img src>` reads.
 */
export function resolveFigureImageUrl(
  figure: Figure,
  baseUrl: string = resolveImageManagerBaseUrl(),
): string | undefined {
  return buildMatteServeUrl(figure.displayMeta, baseUrl) ?? figure.imageUrl;
}
