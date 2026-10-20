import { describe, it, expect } from 'vitest';
import {
  CUSTOM_DARK_SHARE, DEFAULT_WALL, DEFAULT_WALL_CUSTOM, SLATE_WALL, WALL_PRESETS, WALL_PRESET_IDS, isHexColour, isWallPreset, mixHex, swatchStyle, wallColour, wallStyle,
} from '../wallColour';

// relative luminance 0..1 of a #rrggbb
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

describe('WALL-COLOUR-1: the back wall choices', () => {
  it('Ross\'s four presets and a custom colour, the old slate wall staying the default', () => {
    expect(WALL_PRESETS.map((p) => p.label)).toEqual(['Slate', 'Cream', 'Off-white', 'White', 'Seafoam']);
    expect(WALL_PRESETS[0]).toMatchObject({ light: SLATE_WALL, dark: SLATE_WALL });
    expect(WALL_PRESET_IDS).toEqual(['slate', 'cream', 'off-white', 'white', 'seafoam', 'custom']);
    expect(DEFAULT_WALL).toBe('slate');
    expect(isWallPreset('cream') && isWallPreset('custom') && !isWallPreset('teal') && !isWallPreset(3)).toBe(true);
  });

  it('every preset has a light colour and a darker dark-theme counterpart of its own', () => {
    for (const p of WALL_PRESETS.filter((w) => w.id !== 'slate')) {
      expect(isHexColour(p.light) && isHexColour(p.dark), p.id).toBe(true);
      expect(lum(p.dark!), `${p.id}: the dark counterpart is darker`).toBeLessThan(lum(p.light!));
      // a dark-theme wall must still read against the dark steel shelves (#1d1e22)
      expect(lum(p.dark!), `${p.id}: and not as dark as the shelves`).toBeGreaterThan(lum('#1d1e22') * 2);
    }
    expect(lum(WALL_PRESETS.find((p) => p.id === 'white')!.light!)).toBeGreaterThan(lum(WALL_PRESETS.find((p) => p.id === 'cream')!.light!));
  });

  it('wallColour: the colour for a theme; none for the slate wall; a custom colour keeps its hue in the dark theme', () => {
    expect(wallColour('slate', '#112233', 'light')).toBeNull();
    expect(wallColour('cream', '#112233', 'light')).toBe(WALL_PRESETS[1]!.light);
    expect(wallColour('cream', '#112233', 'dark')).toBe(WALL_PRESETS[1]!.dark);
    expect(wallColour('custom', '#AABBCC', 'light')).toBe('#aabbcc');
    const dark = wallColour('custom', '#aabbcc', 'dark')!;
    expect(dark).toBe(mixHex('#aabbcc', '#17181b', CUSTOM_DARK_SHARE));
    expect(lum(dark)).toBeLessThan(lum('#aabbcc'));
    // an unreadable custom colour falls back to the starting colour
    expect(wallColour('custom', 'blue', 'light')).toBe(DEFAULT_WALL_CUSTOM);
    expect(wallColour('custom', '#12', 'dark')).toBe(wallColour('custom', DEFAULT_WALL_CUSTOM, 'dark'));
  });

  it('wallStyle: both themes\' colours as custom properties for the scene; empty for slate', () => {
    expect(wallStyle('slate', '#112233')).toEqual({});
    expect(wallStyle('seafoam', '#112233')).toEqual({ '--wall-light': WALL_PRESETS[4]!.light, '--wall-dark': WALL_PRESETS[4]!.dark });
    const c = wallStyle('custom', '#336699');
    expect(c['--wall-light']).toBe('#336699');
    expect(c['--wall-dark']).toBe(mixHex('#336699', '#17181b', CUSTOM_DARK_SHARE));
  });

  it('mixHex mixes by share and isHexColour takes only #rrggbb', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(['#a1B2c3', '#000000'].every(isHexColour)).toBe(true);
    expect(['a1b2c3', '#abc', '#12345g', '', null, 5].some(isHexColour)).toBe(false);
  });

  it('swatchStyle: both themes\' colours for a swatch, the slate one for the slate wall', () => {
    expect(swatchStyle('slate', '#112233')).toEqual({ '--swatch-light': SLATE_WALL, '--swatch-dark': SLATE_WALL });
    expect(swatchStyle('white', '#112233')).toEqual({ '--swatch-light': WALL_PRESETS[3]!.light, '--swatch-dark': WALL_PRESETS[3]!.dark });
    expect(swatchStyle('custom', '#336699')['--swatch-light']).toBe('#336699');
  });
});
