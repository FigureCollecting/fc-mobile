/**
 * WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the case's back wall in a colour of the user's choosing, kept on the device with the
 * other case prefs. Four presets (Cream, the default, Off-white, White, Seafoam) and a custom colour; each has a light-theme
 * colour and a dark-theme counterpart, and the scene shows the one for the theme the app is in (tokens.css's data-theme).
 *
 * The scene is given both colours as CSS custom properties (wallStyle) and picks by theme in its stylesheet; its floor and
 * ceiling are mixed from the wall so a light wall does not stand over a black floor.
 */

export type WallPreset = 'cream' | 'off-white' | 'white' | 'seafoam' | 'custom';

export interface WallChoice {
  readonly id: Exclude<WallPreset, 'custom'>;
  readonly label: string;
  /** The wall in the light theme and its dark-theme counterpart (Ross's brief's values: contrast with the shelves checked in the tests). */
  readonly light: string;
  readonly dark: string;
}

export const WALL_PRESETS: readonly WallChoice[] = [
  { id: 'cream', label: 'Cream', light: '#efe6d6', dark: '#3b342a' },
  { id: 'off-white', label: 'Off-white', light: '#f2f1ec', dark: '#34332f' },
  { id: 'white', label: 'White', light: '#ffffff', dark: '#2e2e2e' },
  { id: 'seafoam', label: 'Seafoam', light: '#a8d8cc', dark: '#2c4a44' },
];
export const WALL_PRESET_IDS: readonly WallPreset[] = [...WALL_PRESETS.map((p) => p.id), 'custom'];

export const DEFAULT_WALL: WallPreset = 'cream';
/** The custom colour a user starts the picker from. */
export const DEFAULT_WALL_CUSTOM = '#d8d2c4';
/** A custom colour's dark-theme counterpart: its hue and saturation at this lightness (HSL). */
export const CUSTOM_DARK_LIGHTNESS = 0.25;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
export const isWallPreset = (v: unknown): v is WallPreset => WALL_PRESET_IDS.includes(v as WallPreset);

/** A #rrggbb as [hue in degrees, saturation 0..1, lightness 0..1]. */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The wall of a choice in a theme: a preset's, or a custom colour's own (light) and its darkened counterpart (dark). */
export function wallColour(preset: WallPreset, custom: string, theme: 'light' | 'dark'): string {
  if (preset === 'custom') {
    const c = isHexColour(custom) ? custom.toLowerCase() : DEFAULT_WALL_CUSTOM;
    if (theme === 'light') return c;
    const [h, s] = hexToHsl(c);
    return hslToHex(h, s, CUSTOM_DARK_LIGHTNESS);
  }
  const p = WALL_PRESETS.find((w) => w.id === preset) ?? WALL_PRESETS[0]!;
  return theme === 'light' ? p.light : p.dark;
}

/** The custom properties the scene carries for its wall: both themes' colours (the stylesheet picks by theme), so a theme change needs no render. */
export function wallStyle(preset: WallPreset, custom: string): Record<string, string> {
  return { '--wall-light': wallColour(preset, custom, 'light'), '--wall-dark': wallColour(preset, custom, 'dark') };
}

/** A swatch's colours in the View card, the same two. */
export function swatchStyle(preset: WallPreset, custom: string): Record<string, string> {
  return { '--swatch-light': wallColour(preset, custom, 'light'), '--swatch-dark': wallColour(preset, custom, 'dark') };
}
