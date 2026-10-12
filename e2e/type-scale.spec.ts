import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * TYPE-1 (Ross 2026-10-11) in the engine itself: what every font token
 * computes to in Chromium at each case viewport (the Fold8's four ways and
 * android) and at desktop widths 1280 and 1920, on a 16 px root and on a
 * 125 % root (user text scaling). The fluid steps as they were before TYPE-1
 * are computed by Chromium alongside, so "unchanged on the Fold8" is the
 * engine's own reading, not a table of numbers.
 */

const TOKENS = [
  '--font-2xs',
  '--font-xs',
  '--font-sm',
  '--font-base',
  '--font-lg',
  '--font-xl',
  '--font-2xl',
  '--font-input',
  '--font-plate',
  '--font-plate-sub',
] as const;

/** The fluid steps before TYPE-1 (develop 7d1fad1). */
const FLUID_BEFORE: Record<string, string> = {
  '--font-sm': 'clamp(0.75rem, 0.7rem + 0.22vw, 0.8125rem)',
  '--font-base': 'clamp(0.8125rem, 0.76rem + 0.24vw, 0.875rem)',
  '--font-lg': 'clamp(0.9375rem, 0.88rem + 0.28vw, 1rem)',
  '--font-xl': 'clamp(1.0625rem, 1rem + 0.3vw, 1.125rem)',
};

/** One notch up at desktop widths: each fluid step's maximum, 1 px more. */
const DESKTOP_PX: Record<string, number> = { '--font-sm': 14, '--font-base': 15, '--font-lg': 17, '--font-xl': 19 };

/** The static steps, in px on a 16 px root. */
const STATIC_PX: Record<string, number> = { '--font-2xs': 11, '--font-xs': 12, '--font-input': 16, '--font-plate': 7, '--font-plate-sub': 6 };

const WIDTHS = [
  ...CASE_VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

type Sizes = Record<string, number>;

/** Each token's computed font size, and each pre-TYPE-1 fluid step's, in px (probes set through the CSSOM, which the CSP allows). */
async function computedSizes(page: Page): Promise<{ now: Sizes; before: Sizes }> {
  return page.evaluate(
    ({ tokens, before }) => {
      const probe = (fontSize: string) => {
        const el = document.createElement('span');
        el.style.fontSize = fontSize;
        document.body.appendChild(el);
        const px = parseFloat(getComputedStyle(el).fontSize);
        el.remove();
        return px;
      };
      return {
        now: Object.fromEntries(tokens.map((t) => [t, probe(`var(${t})`)])),
        before: Object.fromEntries(Object.entries(before).map(([t, css]) => [t, probe(css)])),
      };
    },
    { tokens: [...TOKENS], before: FLUID_BEFORE },
  );
}

async function setRootFontSize(page: Page, size: string) {
  await page.evaluate((s) => {
    document.documentElement.style.fontSize = s;
  }, size);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible({ timeout: 15_000 });
});

test('2xs 11 px and xs 12 px everywhere; the fluid steps as before on phones and the Fold8, 1 px up on the desktop', async ({ page }) => {
  for (const v of WIDTHS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    const { now, before } = await computedSizes(page);
    for (const [token, px] of Object.entries(STATIC_PX)) expect(now[token], `${token} at ${v.name}`).toBe(px);
    for (const [token, px] of Object.entries(DESKTOP_PX)) {
      if (v.width >= 1280) {
        expect(now[token], `${token} at ${v.name}`).toBeCloseTo(px, 3);
        expect(now[token], `${token} at ${v.name}`).toBeCloseTo(before[token] + 1, 3);
      } else {
        expect(now[token], `${token} at ${v.name}`).toBeCloseTo(before[token], 3);
      }
    }
  }
});

test('a 125 % root font size scales every font token at every phone, Fold8 and desktop width', async ({ page }) => {
  for (const v of WIDTHS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await setRootFontSize(page, '');
    const normal = (await computedSizes(page)).now;
    await setRootFontSize(page, '125%');
    const large = (await computedSizes(page)).now;
    for (const token of TOKENS) {
      expect(large[token], `${token} at ${v.name}`).toBeGreaterThan(normal[token]);
      if (token in STATIC_PX || v.width >= 1920) {
        expect(large[token], `${token} at ${v.name}`).toBeCloseTo(normal[token] * 1.25, 3);
      }
    }
  }
});
