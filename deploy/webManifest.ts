// The web app manifest vite-plugin-pwa emits. The icons' marks sit inside
// the maskable safe zone on a full-bleed background, so the same files serve
// both purposes as separate entries ("any maskable" in one entry is discouraged).
import type { ManifestOptions } from 'vite-plugin-pwa';

type Icon = NonNullable<ManifestOptions['icons']>[number];

const icon = (size: number, purpose: 'any' | 'maskable'): Icon => ({
  src: `/icons/icon-${size}.png`,
  sizes: `${size}x${size}`,
  type: 'image/png',
  purpose,
});

export const WEB_MANIFEST: Partial<ManifestOptions> = {
  id: '/',
  name: 'FigureCollecting',
  short_name: 'FC',
  description: 'Your collectibles, anywhere',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  // 'any': the Fold5 unfolded is a landscape tablet.
  orientation: 'any',
  theme_color: '#0967d2',
  background_color: '#0a0a0a',
  icons: [icon(192, 'any'), icon(512, 'any'), icon(192, 'maskable'), icon(512, 'maskable')],
};

/** Monochrome push badge; not a manifest field, but served alongside the icons. */
export const BADGE_ICON: Icon = { src: '/icons/badge-72.png', sizes: '72x72', type: 'image/png' };
