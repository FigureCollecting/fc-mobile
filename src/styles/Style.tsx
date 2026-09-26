// Component CSS as constructed stylesheets. CSP style-src governs <style>
// elements and style attributes, not CSSOM, so this needs no 'unsafe-inline'.
import { useEffect, useRef } from 'preact/hooks';

export type StyleHost = Document | { adoptedStyleSheets: CSSStyleSheet[] };

interface Held {
  refs: number;
  sheet?: CSSStyleSheet;
  element?: HTMLStyleElement;
}

const registry = new WeakMap<object, Map<string, Held>>();

function constructable(host: StyleHost): boolean {
  return 'adoptedStyleSheets' in host && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;
}

/** Apply `css` to `host` until the returned release is called; one sheet per distinct text. */
export function adoptStyle(css: string, host: StyleHost = document): () => void {
  let byCss = registry.get(host);
  if (byCss === undefined) registry.set(host, (byCss = new Map()));
  let held = byCss.get(css);
  if (held === undefined) {
    held = { refs: 0 };
    if (constructable(host)) {
      held.sheet = new CSSStyleSheet();
      held.sheet.replaceSync(css);
      host.adoptedStyleSheets = [...host.adoptedStyleSheets, held.sheet];
    } else {
      // Safari < 16.4 only; a strict CSP blocks this, which leaves the app unstyled there.
      const doc = host as Document;
      held.element = doc.createElement('style');
      held.element.textContent = css;
      doc.head.appendChild(held.element);
    }
    byCss.set(css, held);
  }
  held.refs += 1;

  let released = false;
  const entry = held;
  const map = byCss;
  return () => {
    if (released) return;
    released = true;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    map.delete(css);
    if (entry.sheet !== undefined) {
      const sheet = entry.sheet;
      host.adoptedStyleSheets = host.adoptedStyleSheets.filter((s) => s !== sheet);
    }
    entry.element?.remove();
  };
}

/**
 * Drop-in for `<style>{css}</style>`: applies while mounted. Adopted during
 * render, so it is in place before any layout effect of the same commit.
 */
export function Style({ css, host = document }: { css: string; host?: StyleHost }): null {
  const held = useRef<{ css: string; release: () => void } | null>(null);
  if (held.current?.css !== css) {
    held.current?.release();
    held.current = { css, release: adoptStyle(css, host) };
  }
  useEffect(
    () => () => {
      held.current?.release();
      held.current = null;
    },
    [],
  );
  return null;
}
