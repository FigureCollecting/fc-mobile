// WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the back wall in the colour the View card sets, a light and a dark-theme counterpart,
// and shelf undersides that are the shelf's own material in shade, not black (he could not judge the gaps against black).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { WALL_PRESETS } from '../wallColour';

afterEach(cleanup);

const scene = (patch: Partial<CasePrefs> = {}) => {
  const { container } = render(<CabinetScene figures={getFixtureFigures(6)} onSelect={vi.fn()} prefs={{ ...DEFAULT_CASE_PREFS, ...patch }} />);
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

describe('CabinetScene: the back wall colour (WALL-COLOUR-1)', () => {
  it('the slate wall, the old look, carries no colour of its own: data-wall-colour says so and no wall properties are set', () => {
    const host = scene();
    expect(host.dataset.wallColour).toBe('slate');
    expect(host.style.getPropertyValue('--wall-light')).toBe('');
    expect(host.style.getPropertyValue('--wall-dark')).toBe('');
  });

  it('a preset puts its light colour and its dark-theme counterpart on the scene', () => {
    const host = scene({ wall: 'cream' });
    const cream = WALL_PRESETS.find((p) => p.id === 'cream')!;
    expect(host.dataset.wallColour).toBe('cream');
    expect(host.style.getPropertyValue('--wall-light')).toBe(cream.light);
    expect(host.style.getPropertyValue('--wall-dark')).toBe(cream.dark);
  });

  it('a custom colour is carried the same way, its dark counterpart mixed from it', () => {
    const host = scene({ wall: 'custom', wallCustom: '#336699' });
    expect(host.dataset.wallColour).toBe('custom');
    expect(host.style.getPropertyValue('--wall-light')).toBe('#336699');
    expect(lum(host.style.getPropertyValue('--wall-dark'))).toBeLessThan(lum('#336699'));
  });

  it('the stylesheet draws a coloured wall from those properties by the app\'s theme, and the floor and ceiling from the wall', () => {
    scene({ wall: 'white' });
    const text = css();
    expect(text).toMatch(/\[data-wall-colour\]:not\(\[data-wall-colour=['"]?slate['"]?\]\) \.room-wall/);
    expect(text).toMatch(/\[data-theme=['"]?light['"]?\] \.cabinet-scene/);
    expect(text).toContain('var(--wall-light');
    expect(text).toContain('var(--wall-dark');
    expect(text).toMatch(/\.room-floor[^}]*color-mix\([^}]*var\(--wall/);
    expect(text).toMatch(/\.room-ceiling[^}]*color-mix\([^}]*var\(--wall/);
  });

  it('shelf undersides are their own material, as the front is, never black: steel and wood keep at least 90 % of their front\'s light', () => {
    scene();
    for (const m of ['m-steel', 'm-wood']) {
      const front = lum(colourOf(`.cabinet-scene .${m} {`));
      const underside = lum(colourOf(`.cabinet-scene .${m}.f-bottom`));
      expect(underside, `${m}'s underside`).toBeGreaterThanOrEqual(front * 0.9);
      expect(underside, `${m}'s underside is not lit past its front`).toBeLessThanOrEqual(front * 1.05);
    }
    // what it was: nothing like the old #0d0e10
    expect(lum(colourOf('.cabinet-scene .m-steel.f-bottom'))).toBeGreaterThan(lum('#0d0e10') * 1.8);
  });
});
