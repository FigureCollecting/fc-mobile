// WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the back wall in the colour the View card sets, a light and a dark-theme counterpart,
// and shelf undersides that are the shelf's own material in shade, not black (he could not judge the gaps against black).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { CabinetScene } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { WALL_PRESETS } from '../wallColour';

// WCAG contrast of two #rrggbb or [r,g,b]
const linear = (c: number[]) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: number[], b: number[]) => (Math.max(linear(a), linear(b)) + 0.05) / (Math.min(linear(a), linear(b)) + 0.05);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

afterEach(cleanup);

const scene = (patch: Partial<CasePrefs> = {}) => {
  const { container } = render(<CabinetScene figures={getFixtureFigures(6)} onSelect={vi.fn()} prefs={{ ...LEGACY_PREFS, ...patch }} />);
  return container.querySelector<HTMLElement>('.cabinet-scene')!;
};

/** Every rule the app's constructed stylesheets (or style elements) hold, as text. */
const css = (): string => {
  const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  const sheets = adopted.flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText));
  const elements = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '');
  return [...sheets, ...elements].join('\n');
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const colourOf = (selector: string): string => {
  const at = css().indexOf(selector);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  const rule = css().slice(at, css().indexOf('}', at));
  const m = /background:\s*(#[0-9a-f]{6})/i.exec(rule);
  expect(m, `${selector} has a flat colour`).not.toBeNull();
  return m![1]!;
};

describe('CabinetScene: the wall colour (WALL-COLOUR-1)', () => {
  it('Cream is the default: the scene carries its light colour and its dark-theme counterpart', () => {
    const host = scene();
    expect(host.dataset.wallColour).toBe('cream');
    expect(host.style.getPropertyValue('--wall-light')).toBe('#efe6d6');
    expect(host.style.getPropertyValue('--wall-dark')).toBe('#3b342a');
  });

  it('a preset puts its light colour and its dark-theme counterpart on the scene, in every view', () => {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      cleanup();
      const host = scene({ wall: 'seafoam', view });
      const seafoam = WALL_PRESETS.find((p) => p.id === 'seafoam')!;
      expect(host.dataset.wallColour, view).toBe('seafoam');
      expect(host.style.getPropertyValue('--wall-light'), view).toBe(seafoam.light);
      expect(host.style.getPropertyValue('--wall-dark'), view).toBe(seafoam.dark);
      expect(host.querySelector('.room-wall'), `${view} draws the room's back wall`).not.toBeNull();
    }
  });

  it('a custom colour is carried the same way, its dark counterpart the same hue at 25 % lightness', () => {
    const host = scene({ wall: 'custom', wallCustom: '#336699' });
    expect(host.dataset.wallColour).toBe('custom');
    expect(host.style.getPropertyValue('--wall-light')).toBe('#336699');
    expect(lum(host.style.getPropertyValue('--wall-dark'))).toBeLessThan(lum('#336699'));
  });

  it('the stylesheet draws the wall, the floor and the ceiling from those properties, the light ones in the light theme', () => {
    scene({ wall: 'white' });
    const text = css();
    expect(text).toMatch(/\[data-theme=['"]?light['"]?\] \.cabinet-scene/);
    expect(text).toContain('var(--wall-light');
    expect(text).toContain('var(--wall-dark');
    expect(text).toMatch(/\.room-wall[^}]*var\(--wall\)/);
    expect(text).toMatch(/\.room-floor[^}]*color-mix\([^}]*var\(--wall/);
    expect(text).toMatch(/\.room-ceiling[^}]*color-mix\([^}]*var\(--wall/);
    // no wall colour is hard-coded any more
    expect(text).not.toContain('#2d3037 0%');
  });

  it('shelf undersides are their own material shaded 15 to 25 % darker than its top, never black', () => {
    scene();
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const m of ['m-steel', 'm-wood']) {
      const top = channels(colourOf(`.cabinet-scene .${m}.f-top`));
      const under = channels(colourOf(`.cabinet-scene .${m}.f-bottom`));
      top.forEach((t, i) => {
        const darker = 1 - under[i]! / t;
        expect(darker, `${m} channel ${i}: ${under[i]} against the top's ${t}`).toBeGreaterThanOrEqual(0.15 - 0.02);
        expect(darker, `${m} channel ${i}`).toBeLessThanOrEqual(0.25 + 0.02);
      });
    }
    // what it was: nothing like the old #0d0e10
    expect(lum(colourOf('.cabinet-scene .m-steel.f-bottom'))).toBeGreaterThan(lum('#0d0e10') * 2);
  });

  it('glass reads on a light wall: in the light theme its edges are a darker teal, each over every light wall with a visible contrast', () => {
    scene();
    const text = css();
    const rgba = (selector: string) => {
      const at = text.indexOf(selector);
      expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
      const m = /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(text.slice(at, text.indexOf('}', at)));
      expect(m, `${selector} is a translucent colour`).not.toBeNull();
      return { c: [Number(m![1]), Number(m![2]), Number(m![3])], a: Number(m![4]) };
    };
    const rim = rgba("[data-theme='light'] .cabinet-scene .m-glass-rim");
    const edge = rgba("[data-theme='light'] .cabinet-scene .m-glass-edge");
    const plate = rgba("[data-theme='light'] .cabinet-scene .m-glass-plate");
    for (const w of WALL_PRESETS) {
      const wall = rgb(w.light);
      const over = (g: { c: number[]; a: number }) => g.c.map((v, i) => v * g.a + wall[i]! * (1 - g.a));
      expect(contrast(over(rim), wall), `${w.id}: the rim`).toBeGreaterThanOrEqual(1.8);
      expect(contrast(over(edge), wall), `${w.id}: the edge`).toBeGreaterThanOrEqual(2.5);
      expect(plate.a, 'the plate stays translucent').toBeLessThanOrEqual(0.2);
    }
  });
});

