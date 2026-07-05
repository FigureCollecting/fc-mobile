import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the design system's font-size floor (10px general, 16px inputs)
 * directly against the token source, so a future token addition can't
 * quietly slip under it. `--font-plate` / `--font-plate-sub` are the one
 * deliberate exception (Ross, nameplate/caption only) — this test makes
 * that exemption explicit and keeps it (plus the companion condensed
 * `--font-family-plate` stack) fenced to its two consumers instead of
 * letting it become a loophole for anything else.
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

describe('design tokens: font-size floor (10px general, 16px inputs)', () => {
  it('marks the floor-exempt tokens with an explicit FLOOR-EXEMPT comment in tokens.css', () => {
    expect(tokensCss).toContain('FLOOR-EXEMPT');
    for (const name of FLOOR_EXEMPT) {
      expect(tokensCss.includes(name), `${name} missing from tokens.css`).toBe(true);
    }
  });

  it('keeps every non-exempt static --font-* token at or above the 10px floor', () => {
    const declarations = [...tokensCss.matchAll(/(--font-[\w-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(0);

    for (const [, name, rawValue] of declarations) {
      if (name === '--font-family' || FLOOR_EXEMPT.has(name)) continue;
      const px = pxOf(rawValue);
      if (px === null) continue; // fluid clamp() step — its floor is its smallest operand, not this check
      expect(px, `${name} = ${rawValue} is below the 10px floor`).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps --font-input at the 16px iOS zoom guard', () => {
    expect(pxOf(getDeclaredValue('--font-input'))).toBe(16);
  });

  it('pins the exempted plate tokens to their intended 7px / 6px values, not smaller', () => {
    expect(pxOf(getDeclaredValue('--font-plate'))).toBe(7);
    expect(pxOf(getDeclaredValue('--font-plate-sub'))).toBe(6);
  });

  it('fences --font-plate / --font-plate-sub / --font-family-plate to the nameplate and caption components only', () => {
    const srcRoot = path.resolve(path.dirname(tokensPath), '..');
    const allowedFiles = new Set(['CaseShelf.tsx', 'JustifiedRows.tsx']);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(tsx?|css)$/.test(entry.name) && full !== tokensPath) {
          const content = fs.readFileSync(full, 'utf-8');
          if (/--font-(family-)?plate(-sub)?\b/.test(content) && !allowedFiles.has(entry.name)) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
