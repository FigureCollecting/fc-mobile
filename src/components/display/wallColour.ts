/**
 * WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the case's back wall in a colour of the user's choosing, kept on the device with the
 * other case prefs. Four presets (Cream, Off-white, White, Seafoam) and a custom colour; each has a light-theme colour and a
 * dark-theme counterpart, and the scene shows the one for the theme the app is in (tokens.css's data-theme). The old look,
 * the dark slate wall, stays the default ("Slate") and is drawn by the scene's own rules, not from here.
 *
 * The scene is given the colours as CSS custom properties (wallStyle); the floor and ceiling are mixed from the wall so a
 * light wall does not stand over a black floor.
 */

export type WallPreset = 'slate' | 'cream' | 'off-white' | 'white' | 'seafoam' | 'custom';

export interface WallChoice {
  readonly id: WallPreset;
  readonly label: string;
  /** The wall in the light theme and its dark-theme counterpart. Slate's are the scene's own wall (a swatch's colour; the scene draws it by its own rules). */
  readonly light: string;
  readonly dark: string;
}

/** The slate wall's colour, for its swatch. */
export const SLATE_WALL = '#2d3037';

export const WALL_PRESETS: readonly WallChoice[] = [
  { id: 'slate', label: 'Slate', light: SLATE_WALL, dark: SLATE_WALL },
  { id: 'cream', label: 'Cream', light: '#f1e8d2', dark: '#4a4333' },
  { id: 'off-white', label: 'Off-white', light: '#efede6', dark: '#45453f' },
  { id: 'white', label: 'White', light: '#fbfbfa', dark: '#4d4e50' },
  { id: 'seafoam', label: 'Seafoam', light: '#cde7dd', dark: '#304840' },
];
export const WALL_PRESET_IDS: readonly WallPreset[] = [...WALL_PRESETS.map((p) => p.id), 'custom'];

export const DEFAULT_WALL: WallPreset = 'slate';
/** The custom colour a user starts the picker from. */
export const DEFAULT_WALL_CUSTOM = '#d8d2c4';

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
export const isWallPreset = (v: unknown): v is WallPreset => WALL_PRESET_IDS.includes(v as WallPreset);

/** How much of a custom colour its dark-theme counterpart keeps (the rest is the dark room's own tone). */
export const CUSTOM_DARK_SHARE = 0.4;
const DARK_ROOM = '#17181b';

/** A #rrggbb mixed with another by `share` of the first, as #rrggbb (the dark counterpart of a custom colour, a swatch's tint). */
export function mixHex(a: string, b: string, share: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) * share + ch(b, i) * (1 - share)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The wall of a choice in a theme, or null for the slate wall (the scene's own colours). */
export function wallColour(preset: WallPreset, custom: string, theme: 'light' | 'dark'): string | null {
  if (preset === 'slate') return null;
  if (preset === 'custom') {
    const c = isHexColour(custom) ? custom.toLowerCase() : DEFAULT_WALL_CUSTOM;
    return theme === 'light' ? c : mixHex(c, DARK_ROOM, CUSTOM_DARK_SHARE);
  }
  const p = WALL_PRESETS.find((w) => w.id === preset)!;
  return theme === 'light' ? p.light : p.dark;
}

/**
 * The custom properties the scene carries for its wall: both themes' colours (the stylesheet picks the one for the theme), so a
 * theme change needs no render. Empty for the slate wall.
 */
export function wallStyle(preset: WallPreset, custom: string): Record<string, string> {
  const light = wallColour(preset, custom, 'light');
  const dark = wallColour(preset, custom, 'dark');
  return light === null || dark === null ? {} : { '--wall-light': light, '--wall-dark': dark };
}

/** A swatch's colours in the View card (both themes', as custom properties; the stylesheet picks by theme); slate shows its own wall. */
export function swatchStyle(preset: WallPreset, custom: string): Record<string, string> {
  return { '--swatch-light': wallColour(preset, custom, 'light') ?? SLATE_WALL, '--swatch-dark': wallColour(preset, custom, 'dark') ?? SLATE_WALL };
}
