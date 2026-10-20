import { describe, it, expect } from 'vitest';
import {
  CUSTOM_DARK_LIGHTNESS, DEFAULT_WALL, DEFAULT_WALL_CUSTOM, WALL_PRESETS, WALL_PRESET_IDS, hexToHsl, isHexColour, isWallPreset, swatchStyle, wallColour, wallStyle,
} from '../wallColour';

// relative luminance 0..1 of a #rrggbb
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
// WCAG relative luminance (gamma-decoded) and contrast ratio, to judge the walls against the shelves
const linear = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => (Math.max(linear(a), linear(b)) + 0.05) / (Math.min(linear(a), linear(b)) + 0.05);
const preset = (id: string) => WALL_PRESETS.find((p) => p.id === id)!;

describe('WALL-COLOUR-1: the back wall choices', () => {
  it('Cream (the default), Off-white, White, Seafoam and a custom colour', () => {
    expect(WALL_PRESETS.map((p) => p.label)).toEqual(['Cream', 'Off-white', 'White', 'Seafoam']);
    expect(WALL_PRESET_IDS).toEqual(['cream', 'off-white', 'white', 'seafoam', 'custom']);
    expect(DEFAULT_WALL).toBe('cream');
    expect(isWallPreset('cream') && isWallPreset('custom') && !isWallPreset('slate') && !isWallPreset('teal') && !isWallPreset(3)).toBe(true);
  });

  it('the values: each preset\'s light colour and its dark-theme counterpart', () => {
    expect(WALL_PRESETS.map((p) => [p.id, p.light, p.dark])).toEqual([
      ['cream', '#efe6d6', '#3b342a'],
      ['off-white', '#f2f1ec', '#34332f'],
      ['white', '#ffffff', '#2e2e2e'],
      ['seafoam', '#a8d8cc', '#2c4a44'],
    ]);
  });

  it('contrast: a dark counterpart is darker than its light colour and reads against the dark steel shelves (#1d1e22) as the old slate wall did; a light one stands out from them', () => {
    const slate = contrast('#2d3037', '#1d1e22');
    for (const p of WALL_PRESETS) {
      expect(linear(p.dark), `${p.id}: darker than its light colour`).toBeLessThan(linear(p.light));
      expect(contrast(p.dark, '#1d1e22'), `${p.id}: dark wall against the shelves (the old wall: ${slate.toFixed(2)})`).toBeGreaterThanOrEqual(slate * 0.95);
      expect(contrast(p.light, '#1d1e22'), `${p.id}: light wall against the shelves`).toBeGreaterThan(8);
    }
    expect(lum(preset('white').light)).toBeGreaterThan(lum(preset('cream').light));
  });

  it('wallColour: the colour for a theme; a custom colour is its own in light and the same hue at about 25 % lightness in dark', () => {
    expect(wallColour('cream', '#112233', 'light')).toBe('#efe6d6');
    expect(wallColour('seafoam', '#112233', 'dark')).toBe('#2c4a44');
    expect(wallColour('custom', '#AABBCC', 'light')).toBe('#aabbcc');
    const [h, , l] = hexToHsl('#336699');
    const dark = wallColour('custom', '#336699', 'dark');
    const [dh, ds, dl] = hexToHsl(dark);
    expect(CUSTOM_DARK_LIGHTNESS).toBe(0.25);
    expect(Math.abs(dl - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(dh - h)).toBeLessThan(2);
    expect(ds).toBeGreaterThan(0.2);
    expect(l).toBeGreaterThan(dl);
    // a grey stays grey, a near-white goes to a dark grey
    expect(hexToHsl(wallColour('custom', '#f4f4f4', 'dark'))[1]).toBeLessThan(0.02);
    expect(wallColour('custom', '#ffffff', 'dark')).toBe('#404040');
    // an unreadable custom colour falls back to the starting colour
    expect(wallColour('custom', 'blue', 'light')).toBe(DEFAULT_WALL_CUSTOM);
    expect(wallColour('custom', '#12', 'dark')).toBe(wallColour('custom', DEFAULT_WALL_CUSTOM, 'dark'));
  });

  it('a preset that is not one of ours reads as Cream, never as nothing', () => {
    expect(wallColour('slate' as never, '#112233', 'light')).toBe('#efe6d6');
    expect(wallColour('slate' as never, '#112233', 'dark')).toBe('#3b342a');
  });

  it('every hue of a custom colour lands at 25 % lightness in the dark theme', () => {
    for (const c of ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#c07040', '#4080c0']) {
      const dark = wallColour('custom', c, 'dark');
      expect(Math.abs(hexToHsl(dark)[2] - 0.25), c).toBeLessThan(0.01);
      expect(Math.abs(hexToHsl(dark)[0] - hexToHsl(c)[0]), c).toBeLessThan(2);
    }
  });

  it('wallStyle: both themes\' colours as custom properties for the scene', () => {
    expect(wallStyle('seafoam', '#112233')).toEqual({ '--wall-light': '#a8d8cc', '--wall-dark': '#2c4a44' });
    const c = wallStyle('custom', '#336699');
    expect(c['--wall-light']).toBe('#336699');
    expect(c['--wall-dark']).toBe(wallColour('custom', '#336699', 'dark'));
  });

  it('swatchStyle: the same colours for a swatch in the View card', () => {
    expect(swatchStyle('white', '#112233')).toEqual({ '--swatch-light': '#ffffff', '--swatch-dark': '#2e2e2e' });
    expect(swatchStyle('custom', '#336699')['--swatch-light']).toBe('#336699');
  });

  it('hexToHsl reads #rrggbb as [hue deg, saturation, lightness]; isHexColour takes only #rrggbb', () => {
    expect(hexToHsl('#ff0000')).toEqual([0, 1, 0.5]);
    expect(hexToHsl('#000000')).toEqual([0, 0, 0]);
    const [h, s, l] = hexToHsl('#00ff80');
    expect([Math.round(h), s, l]).toEqual([150, 1, 0.5]);
    // every sextant of the hue circle, and a hue that wraps below red
    expect(Math.round(hexToHsl('#80ff00')[0])).toBe(90);
    expect(Math.round(hexToHsl('#0080ff')[0])).toBe(210);
    expect(Math.round(hexToHsl('#ff0080')[0])).toBe(330);
    expect(Math.round(hexToHsl('#8000ff')[0])).toBe(270);
    expect(Math.round(hexToHsl('#ff8000')[0])).toBe(30);
    expect(['#a1B2c3', '#000000'].every(isHexColour)).toBe(true);
    expect(['a1b2c3', '#abc', '#12345g', '', null, 5].some(isHexColour)).toBe(false);
  });
});
