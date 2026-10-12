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

/**
 * The small literal font sizes allowed outside tokens.css, by file and CSS
 * rule: the case's in-scene plates, drawn in scene px and scaled by the case
 * camera. Every other rule of those files is guarded like any file.
 */
const LITERAL_SIZE_EXEMPT: Record<string, { rule: RegExp; why: string }> = {
  'components/display/CabinetScene.tsx': {
    rule: /^\.cabinet-scene \.(?:cab-plate|cab-figure__plate)$/,
    why: 'the in-scene plates, sized in scene px and scaled by the case camera',
  },
};

/**
 * Every way a source file sets a font size: CSS font-size and font (in a
 * stylesheet or a style object), camelCase fontSize (a style object or an
 * attribute), the font-size attribute, and a canvas's font. `js` values are
 * expressions: a number (bare, or quoted in an attribute) is px, another
 * string is CSS, and anything else is unreadable.
 */
const SIZE_SETTERS: { re: RegExp; shorthand: boolean; js: boolean }[] = [
  { re: /\bfont-size\s*:\s*((?:\$\{[^}]*\}|[^;`{}\n])*)/g, shorthand: false, js: false },
  { re: /\bfont\s*:\s*((?:\$\{[^}]*\}|[^;`{}\n])*)/g, shorthand: true, js: false },
  { re: /\bfontSize\s*[:=]\s*(\{[^}\n]*\}|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|[^,;}\s]+)/g, shorthand: false, js: true },
  { re: /\bfont-size\s*=\s*(\{[^}\n]*\}|'[^'\n]*'|"[^"\n]*")/g, shorthand: false, js: true },
  { re: /\.font\s*=\s*('[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g, shorthand: true, js: true },
];

/** A length's px on a 16 px root (em and % taken against it). */
const LENGTH = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|%)(?![\w-])/g;
const lengthPx = (n: string, unit: string) => parseFloat(n) * (unit === 'px' ? 1 : unit === '%' ? REM_TO_PX / 100 : REM_TO_PX);

/** The top-level calc(), min(), max() and clamp() calls in a CSS value. */
function mathCalls(value: string): string[] {
  const calls: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const head = value.slice(i).match(/^(?:calc|min|max|clamp)\(/);
    if (!head || /[\w-]/.test(value[i - 1] ?? '')) continue;
    let depth = 0;
    let j = i + head[0].length - 1;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
    }
    calls.push(value.slice(i, j + 1));
    i = j;
  }
  return calls;
}

/**
 * A math size's smallest px at every width the tokens are checked at, the
 * font tokens it names put in (a var() of anything else takes its fallback),
 * and the floor it answers to: 12px, or its smallest token's own size when
 * that is less (calc(var(--font-2xs)) is the token itself). Null if unreadable.
 */
function mathSize(expr: string): { px: number; floor: number } | null {
  let floor = 12;
  let unreadable = false;
  const filled = expr
    .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => {
      if (SIZE_TOKENS.includes(name)) {
        floor = Math.min(floor, ...WIDTHS.map((w) => sizeAt(name, w)));
        return `calc(${getDeclaredValue(name)})`;
      }
      if (fallback === undefined) unreadable = true;
      return `calc(${fallback ?? '0px'})`;
    })
    .replace(LENGTH, (_, n: string, unit: string) => (unit === 'px' ? `${n}px` : `${lengthPx(n, unit) / REM_TO_PX}rem`));
  if (unreadable) return null;
  try {
    return { px: Math.min(...WIDTHS.map((w) => cssPx(filled, { rootPx: REM_TO_PX, viewportPx: w }))), floor };
  } catch {
    return null;
  }
}

/** Why a CSS font or font-size value sets text under 12px outside the tokens, or null when it does not. */
function cssSizeOffence(value: string, shorthand: boolean): string | null {
  let v = value.replace(/!important/g, '').trim();
  if (v.includes('${')) return 'an interpolated size the guard cannot read';
  // The font shorthand's line height follows its size after a slash.
  if (shorthand) v = v.replace(/(\d*\.?\d+(?:px|rem|em|%)|\))\s*\/\s*\S+/g, '$1');
  const keyword = v.match(/(?:^|[\s,(])(xx-small|x-small|smaller)(?=$|[\s,)])/);
  if (keyword) return `the keyword ${keyword[1]}`;
  let rest = v;
  for (const call of mathCalls(v)) {
    rest = rest.replace(call, ' ');
    const size = mathSize(call);
    if (size === null) return `${call}, a size the guard cannot read`;
    if (size.px < size.floor - 1e-9) return `${call} reaches ${+size.px.toFixed(2)}px`;
  }
  for (const [, n, unit] of rest.matchAll(LENGTH)) {
    if (lengthPx(n, unit) < 12) return `${n}${unit}`;
  }
  return null;
}

/** The enclosing CSS rule's selector at `at` in `source`, '' when outside a rule. */
function ruleAt(source: string, at: number): string {
  const open = source.lastIndexOf('{', at);
  if (open < 0 || source.lastIndexOf('}', at) > open) return '';
  const start = Math.max(source.lastIndexOf('}', open), source.lastIndexOf(';', open), source.lastIndexOf('`', open)) + 1;
  return source.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
}

/** The font sizes under 12px that `source` (the file at `rel`, under src/) declares outside the tokens, as `rel:line declaration`. */
function literalSizeOffenders(source: string, rel: string): string[] {
  const exempt = LITERAL_SIZE_EXEMPT[rel];
  const offenders: string[] = [];
  for (const { re, shorthand, js } of SIZE_SETTERS) {
    for (const m of source.matchAll(re)) {
      let value = m[1].trim();
      let offence: string | null;
      if (js) {
        if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1).trim();
        // A number, bare or quoted (an SVG attribute), is px; another string is CSS.
        const quoted = value.match(/^(['"`])([\s\S]*)\1$/);
        const inner = quoted ? quoted[2].trim() : value;
        if (/^\d*\.?\d+$/.test(inner)) offence = parseFloat(inner) < 12 ? `${inner} (px)` : null;
        else if (quoted) offence = cssSizeOffence(inner, shorthand);
        else offence = `${value}, a size the guard cannot read`;
      } else {
        offence = cssSizeOffence(value, shorthand);
      }
      if (offence === null) continue;
      const selector = ruleAt(source, m.index!);
      if (exempt && selector && selector.split(',').every((part) => exempt.rule.test(part.trim()))) continue;
      const line = source.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line} ${m[0].trim()}`);
    }
  }
  return offenders;
}

describe('the literal-size guard reads every way a font size is written', () => {
  const offences = (source: string, rel = 'components/Sample.tsx') => literalSizeOffenders(source, rel);

  it('flags px, rem, em and percent sizes under 12px, also inside calc(), min(), max(), clamp() and a var() fallback', () => {
    for (const value of [
      '10px',
      '0.625rem',
      '0.7em',
      '62.5%',
      'calc(10px)',
      'min(10px, 2.5vw)',
      'max(9px, 0.5rem)',
      'clamp(0.5rem, 1vw, 0.7rem)',
      'min(var(--font-sm), 2.5vw)',
      'var(--font-xs, 11px)',
      'calc(var(--font-2xs) - 1px)',
    ]) {
      expect(offences(`.a {\n  font-size: ${value};\n}`), value).toEqual([`components/Sample.tsx:2 font-size: ${value}`]);
    }
    expect(offences('.a { font: 600 11px/1 system-ui; }')).toHaveLength(1);
  });

  it('flags the keyword sizes under 12px, and smaller', () => {
    for (const value of ['xx-small', 'x-small', 'smaller']) expect(offences(`.a { font-size: ${value}; }`), value).toHaveLength(1);
  });

  it('flags camelCase fontSize in style objects and attributes, a font-size attribute, a font in a style object and a canvas font', () => {
    for (const source of [
      '<span style={{ fontSize: 9 }} />',
      "<span style={{ fontSize: '10px' }} />",
      '<text fontSize={10}>x</text>',
      '<text font-size="10">x</text>',
      "ctx.font = '10px sans-serif';",
      "const s = { font: '600 10px/1 system-ui' };",
    ]) {
      expect(offences(source), source).toHaveLength(1);
    }
  });

  it('flags a size it cannot read rather than guess: an interpolation or a variable', () => {
    expect(offences('const css = `.a { font-size: ${10}px; }`;')).toHaveLength(1);
    expect(offences('<span style={{ fontSize: size }} />')).toHaveLength(1);
    expect(offences('.a { font-size: max(var(--unknown), 14px); }')).toHaveLength(1);
  });

  it('passes the tokens, sizes from 12px, the keywords from small, a line height under 12px and the other font properties', () => {
    for (const source of [
      '.a { font-size: var(--font-2xs); }',
      '.a { font-size: var(--font-xs); }',
      '.a { font-size: 12px; }',
      '.a { font-size: 0.75rem; }',
      '.a { font-size: small; }',
      '.a { font-size: 100%; }',
      '.a { font-size: inherit; }',
      '.a { font: 600 14px/10px system-ui; }',
      '.a { font-size: max(1rem, var(--font-input, 1rem)) !important; }',
      '.a { font-size: calc(var(--font-sm) + 2px); }',
      '.a { font-size: max(var(--font-2xs), 2vw); }',
      "<span style={{ fontSize: 'var(--font-xs)' }} />",
      '<text fontSize={14}>x</text>',
      '.a { font-weight: 400; font-family: system-ui; }',
    ]) {
      expect(offences(source), source).toEqual([]);
    }
  });

  it("exempts the case's in-scene plates in CabinetScene.tsx only, not the rest of that file", () => {
    const cabinet = 'components/display/CabinetScene.tsx';
    expect(offences('  .cabinet-scene .cab-plate {\n    font: 600 11px/1 system-ui;\n  }', cabinet)).toEqual([]);
    expect(offences('  .cabinet-scene .cab-figure__plate {\n    font: 600 9px/1.2 system-ui;\n  }', cabinet)).toEqual([]);
    expect(offences('  .cabinet-scene__fit {\n    font: 600 9px/1.3 system-ui;\n  }', cabinet)).toHaveLength(1);
    expect(offences('  .cabinet-scene .cab-figure__plate--reading { font-size: 9px; }', cabinet)).toHaveLength(1);
    expect(offences('  .cabinet-scene .cab-plate {\n    font: 600 11px/1 system-ui;\n  }')).toHaveLength(1);
  });
});

describe('design tokens: the smallest text goes through the tokens', () => {
  it('declares no font size under 12px outside tokens.css (use --font-2xs or --font-xs), so TYPE-1 and user text scaling reach it', () => {
    const srcRoot = path.resolve(path.dirname(tokensPath), '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'test') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(entry.name) || full === tokensPath) continue;
        offenders.push(...literalSizeOffenders(fs.readFileSync(full, 'utf-8'), path.relative(srcRoot, full)));
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
