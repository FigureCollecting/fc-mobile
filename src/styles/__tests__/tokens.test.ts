import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_VIEWPORTS } from '../../../e2e/caseViewports';

/**
 * Guards the design system's font-size floor (11px general, 16px inputs)
 * directly against the token source, so a future token addition can't
 * quietly slip under it. `--font-plate` / `--font-plate-sub` are the one
 * deliberate exception (Ross, nameplate/caption only) — this test makes
 * that exemption explicit and keeps it fenced to its two consumers instead
 * of letting it become a loophole for anything else.
 */
const tokensPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tokens.css');
const tokensCss = fs.readFileSync(tokensPath, 'utf-8');
const REM_TO_PX = 16;

function pxOf(rawValue: string): number | null {
  const value = rawValue.trim();
  const rem = value.match(/^([\d.]+)rem$/);
  if (rem) return parseFloat(rem[1]) * REM_TO_PX;
  const px = value.match(/^([\d.]+)px$/);
  if (px) return parseFloat(px[1]);
  return null; // clamp()/calc() fluid values are checked by design, not by static parse here
}

function getDeclaredValue(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${name} not declared in tokens.css`);
  return match[1].trim();
}

const FLOOR_EXEMPT = new Set(['--font-plate', '--font-plate-sub']);

/** Root font size and viewport width, in px, that a CSS length is evaluated at. */
interface CssContext {
  rootPx: number;
  viewportPx: number;
}

/**
 * Evaluates a token's length to px the way the browser does: sums of rem,
 * vw and px terms inside clamp(), min(), max() and calc(), nested at will.
 * clamp(a, b, c) is max(a, min(b, c)), as CSS Values 4 defines it. Throws on
 * anything else, so a token in some other form cannot pass unread.
 */
function cssPx(source: string, ctx: CssContext): number {
  const tokens = source.match(/clamp\(|min\(|max\(|calc\(|[(),+-]|\d*\.?\d+(?:rem|vw|px)|\S/g) ?? [];
  let i = 0;
  const take = (expected?: string): string => {
    const token = tokens[i++];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`cannot read ${expected ?? 'a term'} at token ${i} of ${source}`);
    }
    return token;
  };
  const term = (): number => {
    const token = take();
    const length = token.match(/^(\d*\.?\d+)(rem|vw|px)$/);
    if (length) {
      const n = parseFloat(length[1]);
      if (length[2] === 'rem') return n * ctx.rootPx;
      if (length[2] === 'vw') return (n * ctx.viewportPx) / 100;
      return n;
    }
    const fn = token.match(/^(clamp|min|max|calc)\($/);
    if (!fn) throw new Error(`cannot read ${token} in ${source}`);
    const args = [sum()];
    while (tokens[i] === ',') {
      take(',');
      args.push(sum());
    }
    take(')');
    if (fn[1] === 'clamp') {
      if (args.length !== 3) throw new Error(`clamp() takes 3 arguments in ${source}`);
      return Math.max(args[0], Math.min(args[1], args[2]));
    }
    if (fn[1] === 'min') return Math.min(...args);
    if (fn[1] === 'max') return Math.max(...args);
    if (args.length !== 1) throw new Error(`calc() takes 1 argument in ${source}`);
    return args[0];
  };
  const sum = (): number => {
    let value = term();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = take();
      const next = term();
      value = op === '+' ? value + next : value - next;
    }
    return value;
  };
  const value = sum();
  if (i !== tokens.length) throw new Error(`unread ${tokens.slice(i).join(' ')} in ${source}`);
  return value;
}

/** Every font-size token: all --font-* but the family and the weights. */
const SIZE_TOKENS = [...tokensCss.matchAll(/(--font-[\w-]+):\s*[^;]+;/g)]
  .map((m) => m[1])
  .filter((name) => name !== '--font-family' && !name.startsWith('--font-weight-'));

/** A token's size in px at a viewport width, on a 16 px root unless given. */
function sizeAt(name: string, viewportPx: number, rootPx = REM_TO_PX): number {
  return cssPx(getDeclaredValue(name), { rootPx, viewportPx });
}

/** The phone floor, every case viewport (the Fold8's four ways, android), and the desktop at 1280 and 1920. */
const WIDTHS = [320, 360, ...CASE_VIEWPORTS.map((v) => v.width), 1024, 1280, 1536, 1920, 2560];

describe('cssPx, the token evaluator these tests read sizes with', () => {
  const ctx = { rootPx: 16, viewportPx: 1000 };

  it('reads rem, vw and px terms, sums and differences, and the math functions, nested', () => {
    expect(cssPx('0.75rem', ctx)).toBe(12);
    expect(cssPx('10px', ctx)).toBe(10);
    expect(cssPx('0.5rem + 1vw - 2px', ctx)).toBe(16);
    expect(cssPx('calc(1rem + 1vw)', ctx)).toBe(26);
    expect(cssPx('min(1rem, 2rem, 0.5rem)', ctx)).toBe(8);
    expect(cssPx('max(1rem, 2rem)', ctx)).toBe(32);
    expect(cssPx('clamp(1rem, 0.5rem + 1vw, 2rem)', ctx)).toBe(18);
    expect(cssPx('clamp(1rem, 0.5rem, 2rem)', ctx)).toBe(16);
    expect(cssPx('clamp(1rem, 3rem, 2rem)', ctx)).toBe(32);
    expect(cssPx('clamp(1rem, 4rem, clamp(1rem, 0.5rem + 1vw, 2rem))', ctx)).toBe(18);
    expect(cssPx('clamp(2rem, 1rem, 1rem)', ctx)).toBe(32); // the minimum wins, as in CSS
  });

  it('rejects what it cannot read rather than guess', () => {
    expect(() => cssPx('1em', ctx)).toThrow();
    expect(() => cssPx('clamp(1rem, 2rem)', ctx)).toThrow();
    expect(() => cssPx('calc(1rem, 2rem)', ctx)).toThrow();
    expect(() => cssPx('1rem 2rem', ctx)).toThrow();
    expect(() => cssPx('min(1rem', ctx)).toThrow();
    expect(() => cssPx('foo(1rem)', ctx)).toThrow();
    expect(() => cssPx('1rem +', ctx)).toThrow();
  });
});

describe('design tokens: user text scaling (rem) applies to every font size', () => {
  it('finds the font-size tokens', () => {
    expect(SIZE_TOKENS).toEqual(
      expect.arrayContaining(['--font-2xs', '--font-xs', '--font-sm', '--font-base', '--font-lg', '--font-xl', '--font-2xl', '--font-input']),
    );
  });

  it('declares every font size in rem and vw, never px, so a larger root font size reaches it', () => {
    for (const name of SIZE_TOKENS) {
      expect(getDeclaredValue(name), name).not.toMatch(/px/);
      expect(getDeclaredValue(name), name).toMatch(/rem/);
    }
  });

  it('scales every font token with a 125% root, at every phone, Fold8 and desktop width', () => {
    for (const name of SIZE_TOKENS) {
      const fluid = /vw/.test(getDeclaredValue(name));
      for (const w of WIDTHS) {
        const normal = sizeAt(name, w);
        const large = sizeAt(name, w, REM_TO_PX * 1.25);
        expect(large, `${name} at ${w}px`).toBeGreaterThan(normal);
        // never smaller than 125% of its own floor, the size on the narrowest phone
        expect(large, `${name} at ${w}px`).toBeGreaterThanOrEqual(sizeAt(name, 320) * 1.25 - 1e-9);
        // a static step scales exactly; a fluid one by its rem parts, its vw parts held
        if (!fluid) expect(large, `${name} at ${w}px`).toBeCloseTo(normal * 1.25, 9);
      }
      // the widest desktop has every fluid step at its maximum, which scales exactly
      expect(sizeAt(name, 2560, REM_TO_PX * 1.25), name).toBeCloseTo(sizeAt(name, 2560) * 1.25, 9);
    }
  });
});

describe('design tokens: font-size floor (11px general, 16px inputs)', () => {
  it('marks the floor-exempt tokens with an explicit FLOOR-EXEMPT comment in tokens.css', () => {
    expect(tokensCss).toContain('FLOOR-EXEMPT');
    for (const name of FLOOR_EXEMPT) {
      expect(tokensCss.includes(name), `${name} missing from tokens.css`).toBe(true);
    }
  });

  it('keeps every non-exempt static --font-* token at or above the 11px floor', () => {
    const declarations = [...tokensCss.matchAll(/(--font-[\w-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(0);

    for (const [, name, rawValue] of declarations) {
      if (name === '--font-family' || FLOOR_EXEMPT.has(name)) continue;
      const px = pxOf(rawValue);
      if (px === null) continue; // fluid clamp() step — its floor is its smallest operand, not this check
      expect(px, `${name} = ${rawValue} is below the 11px floor`).toBeGreaterThanOrEqual(11);
    }
  });

  it('sets --font-2xs, the smallest step, to 11px (Ross 2026-10-11: up from 10px), in rem', () => {
    expect(getDeclaredValue('--font-2xs')).toBe('0.6875rem');
    expect(pxOf(getDeclaredValue('--font-2xs'))).toBe(11);
  });

  it('sets --font-xs to 12px (Ross 2026-10-11: up from 11px; revert this step alone if it reads too loose), in rem', () => {
    expect(getDeclaredValue('--font-xs')).toBe('0.75rem');
    expect(pxOf(getDeclaredValue('--font-xs'))).toBe(12);
  });

  it('keeps --font-input at the 16px iOS zoom guard', () => {
    expect(pxOf(getDeclaredValue('--font-input'))).toBe(16);
  });

  it('pins the exempted plate tokens to their intended 7px / 6px values, not smaller', () => {
    expect(pxOf(getDeclaredValue('--font-plate'))).toBe(7);
    expect(pxOf(getDeclaredValue('--font-plate-sub'))).toBe(6);
  });

  it('fences --font-plate / --font-plate-sub to the nameplate and caption components only', () => {
    const srcRoot = path.resolve(path.dirname(tokensPath), '..');
    const allowedFiles = new Set(['JustifiedRows.tsx']);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(tsx?|css)$/.test(entry.name) && full !== tokensPath) {
          const content = fs.readFileSync(full, 'utf-8');
          if (/--font-plate(-sub)?\b/.test(content) && !allowedFiles.has(entry.name)) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});

/** The fluid steps as they were before TYPE-1 (develop 7d1fad1): their phone and Fold8 sizes must not move. */
const FLUID_BEFORE: Record<string, string> = {
  '--font-sm': 'clamp(0.75rem, 0.7rem + 0.22vw, 0.8125rem)',
  '--font-base': 'clamp(0.8125rem, 0.76rem + 0.24vw, 0.875rem)',
  '--font-lg': 'clamp(0.9375rem, 0.88rem + 0.28vw, 1rem)',
  '--font-xl': 'clamp(1.0625rem, 1rem + 0.3vw, 1.125rem)',
};

/** One notch up at desktop widths (Ross 2026-10-11): each fluid step's maximum, 1 px more. */
const DESKTOP_PX: Record<string, number> = { '--font-sm': 14, '--font-base': 15, '--font-lg': 17, '--font-xl': 19 };

const before = (name: string, viewportPx: number) => cssPx(FLUID_BEFORE[name], { rootPx: REM_TO_PX, viewportPx });

describe('design tokens: one notch up at desktop widths, the phone and Fold8 sizes unchanged', () => {
  for (const [name, px] of Object.entries(DESKTOP_PX)) {
    it(`${name} reads ${px}px from 1280 wide on, 1 px over its old maximum`, () => {
      for (const w of [1280, 1536, 1920, 2560]) {
        expect(sizeAt(name, w), `${name} at ${w}px`).toBeCloseTo(px, 9);
        expect(sizeAt(name, w), `${name} at ${w}px`).toBeCloseTo(before(name, w) + 1, 9);
      }
    });

    it(`${name} is unchanged on phones, at every Fold8 size and up to 960 wide`, () => {
      for (const w of [320, 360, ...CASE_VIEWPORTS.map((v) => v.width), 900, 960]) {
        expect(sizeAt(name, w), `${name} at ${w}px`).toBeCloseTo(before(name, w), 9);
      }
    });

    it(`${name} climbs smoothly as the window widens: never shrinks, never jumps`, () => {
      let last = sizeAt(name, 320);
      for (let w = 328; w <= 2560; w += 8) {
        const size = sizeAt(name, w);
        expect(size, `${name} at ${w}px`).toBeGreaterThanOrEqual(last - 1e-9);
        expect(size - last, `${name} from ${w - 8}px to ${w}px`).toBeLessThan(0.05);
        last = size;
      }
    });
  }
});
