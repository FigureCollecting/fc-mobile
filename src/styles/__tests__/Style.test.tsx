import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Style, adoptStyle, type StyleHost } from '../Style';

/** A document that supports constructable stylesheets, which jsdom lacks. */
function host(): StyleHost & { adoptedStyleSheets: CSSStyleSheet[] } {
  return { adoptedStyleSheets: [] } as unknown as StyleHost & { adoptedStyleSheets: CSSStyleSheet[] };
}

const texts = (h: { adoptedStyleSheets: CSSStyleSheet[] }) =>
  h.adoptedStyleSheets.map((s) => Array.from(s.cssRules, (r) => r.cssText.replace(/\s+/g, '')).join(''));

describe('adoptStyle', () => {
  it('adopts a constructed sheet holding the css, not a <style> element', () => {
    const h = host();
    adoptStyle('.a { color: red; }', h);
    expect(texts(h)).toEqual(['.a{color:red;}']);
    expect(document.querySelectorAll('style')).toHaveLength(0);
  });

  it('shares one sheet between users of the same css and drops it after the last release', () => {
    const h = host();
    const r1 = adoptStyle('.b { color: blue; }', h);
    const r2 = adoptStyle('.b { color: blue; }', h);
    expect(h.adoptedStyleSheets).toHaveLength(1);
    r1();
    expect(h.adoptedStyleSheets).toHaveLength(1);
    r2();
    expect(h.adoptedStyleSheets).toHaveLength(0);
  });

  it('releasing twice is harmless', () => {
    const h = host();
    const keep = adoptStyle('.k { color: green; }', h);
    const r = adoptStyle('.c { color: red; }', h);
    r();
    r();
    expect(texts(h)).toEqual(['.k{color:green;}']);
    keep();
  });

  it('keeps sheets it did not add', () => {
    const h = host();
    const foreign = new CSSStyleSheet();
    h.adoptedStyleSheets = [foreign];
    adoptStyle('.d { color: red; }', h)();
    expect(h.adoptedStyleSheets).toEqual([foreign]);
  });

  it('falls back to a <style> in <head> where constructable sheets are missing', () => {
    const release = adoptStyle('.e { color: red; }', document);
    const el = document.head.querySelector('style');
    expect(el?.textContent).toBe('.e { color: red; }');
    release();
    expect(document.head.querySelector('style')).toBeNull();
  });
});

describe('<Style>', () => {
  it('applies while mounted and is removed on unmount', () => {
    const h = host();
    const { unmount } = render(<Style css=".f { color: red; }" host={h} />);
    expect(texts(h)).toEqual(['.f{color:red;}']);
    unmount();
    expect(h.adoptedStyleSheets).toHaveLength(0);
  });

  it('swaps its sheet when the css changes', () => {
    const h = host();
    const { rerender, unmount } = render(<Style css=".g { color: red; }" host={h} />);
    rerender(<Style css=".g { color: blue; }" host={h} />);
    expect(texts(h)).toEqual(['.g{color:blue;}']);
    unmount();
    expect(h.adoptedStyleSheets).toHaveLength(0);
  });

  it('is in place before the first layout effect of a sibling rendered after it', () => {
    const h = host();
    let seen = -1;
    function Measure() {
      // Runs in the same commit; the sheet must already be adopted.
      seen = h.adoptedStyleSheets.length;
      return null;
    }
    render(
      <>
        <Style css=".h { color: red; }" host={h} />
        <Measure />
      </>,
    );
    expect(seen).toBe(1);
  });

  it('renders nothing into the DOM', () => {
    const { container } = render(<Style css=".i { color: red; }" host={host()} />);
    expect(container.innerHTML).toBe('');
  });
});
