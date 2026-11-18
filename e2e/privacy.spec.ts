import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { e2eServers } from './e2eServers';

/**
 * P1: /privacy is the page anyone can read, signed out, before any account exists: opened by its address it loads with
 * no request to /api, none to another origin (the "no trackers" claim on the page, as a test) and no redirect; the
 * onboarding and Settings link to it; its text is src/content/privacy.md word for word; it is axe clean in both themes,
 * prints whole, and opens offline once the app is installed.
 */

const TEXT = readFileSync(fileURLToPath(new URL('../src/content/privacy.md', import.meta.url)), 'utf8');
/** What the file says, as a reader sees it: one entry per title, heading, paragraph and list item. */
const TEXT_LINES = TEXT.split('\n')
  .map((line) => line.replace(/^(# |## |- )/, '').trim())
  .filter((line) => line !== '');
const CONTACT = 'privacy@figurecollecting.com';
const LINK = 'How we use your data';
const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const servers = e2eServers();

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

interface Watch {
  /** Every request the context made, a service worker's included. */
  requests: string[];
  /** Requests to anything but this run's own server, stopped before they left. */
  offOrigin: string[];
  /** Each address the page's main frame showed. */
  shown: string[];
}

/** Records what the page asks for and where it goes; a request to any other origin is recorded and refused, never sent. */
async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watch> {
  const seen: Watch = { requests: [], offOrigin: [], shown: [] };
  await context.route(
    (url) => url.origin !== origin,
    (route) => {
      seen.offOrigin.push(route.request().url());
      return route.abort();
    },
  );
  context.on('request', (request) => seen.requests.push(request.url()));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.shown.push(frame.url());
  });
  return seen;
}

const shownText = (page: Page) => page.locator('.privacy__text :is(h1, h2, p, li)').allTextContents();

async function expectThePage(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

for (const build of [
  { name: '--mode test build', origin: servers.appUrl },
  { name: 'real production build', origin: servers.prodUrl },
]) {
  for (const visitor of ['first-time', 'returning'] as const) {
    test(`signed out, ${visitor} visitor, ${build.name}: /privacy loads with no request to /api, none off this origin and no redirect`, async ({ context, page }) => {
      if (visitor === 'returning') await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
      const seen = await watch(context, page, build.origin);

      const response = await page.goto(`${build.origin}/privacy`);
      await expectThePage(page);
      // Past the first paint: the worker installs and precaches, and anything lazy has had its chance to ask.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      expect(response!.status()).toBe(200);
      expect(response!.request().redirectedFrom()).toBeNull();
      expect(seen.shown.map((u) => new URL(u).pathname)).toEqual(['/privacy']);
      expect(new URL(page.url()).pathname).toBe('/privacy');

      expect(seen.requests.length).toBeGreaterThan(0);
      expect(seen.requests.filter((u) => new URL(u).pathname.startsWith('/api'))).toEqual([]);
      expect(seen.offOrigin).toEqual([]);
      expect(seen.requests.filter((u) => new URL(u).origin !== build.origin)).toEqual([]);

      // The page alone: no onboarding over it, no sign-in prompt, no tab bar, nothing kept about the visit.
      await expect(page.locator('.onboarding')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
      await expect(page.locator('.sync-auth-banner')).toHaveCount(0);
      expect(await page.evaluate(() => document.cookie)).toBe('');
      expect(await page.evaluate(() => localStorage.getItem('onboarding_complete'))).toBe(visitor === 'returning' ? '1' : null);
      expect(await shownText(page)).toEqual(TEXT_LINES);
    });
  }
}

// The address as it gets typed or pasted: a trailing slash, another letter case. On the real production build each is
// the page alone, for a visitor who has never opened the app and for one who has.
for (const typed of ['/privacy/', '/Privacy']) {
  for (const visitor of ['first-time', 'returning'] as const) {
    test(`signed out, ${visitor} visitor, real production build: ${typed} is the page alone, with no request to /api and none off this origin`, async ({ context, page }) => {
      if (visitor === 'returning') await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
      const seen = await watch(context, page, servers.prodUrl);

      const response = await page.goto(`${servers.prodUrl}${typed}`);
      await expectThePage(page);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      expect(response!.status()).toBe(200);
      expect(seen.shown.map((u) => new URL(u).pathname)).toEqual([typed]);
      expect(seen.requests.filter((u) => new URL(u).pathname.startsWith('/api'))).toEqual([]);
      expect(seen.offOrigin).toEqual([]);
      await expect(page.locator('.onboarding')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open FigureCollecting' })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('onboarding_complete'))).toBe(visitor === 'returning' ? '1' : null);
      expect(await shownText(page)).toEqual(TEXT_LINES);
    });
  }
}

test('the page shows the text of src/content/privacy.md, word for word, with the contact address as a mail link', async ({ page }) => {
  await page.goto('/privacy');
  await expectThePage(page);
  expect(TEXT_LINES[0]).toBe('Privacy');
  expect(TEXT_LINES.length).toBeGreaterThan(30);
  expect(await shownText(page)).toEqual(TEXT_LINES);
  expect(await page.locator('.privacy__text h2').allTextContents()).toEqual(
    TEXT.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3)),
  );
  expect(await page.locator('.privacy__text li').count()).toBe(TEXT.split('\n').filter((l) => l.startsWith('- ')).length);
  const mail = page.locator('.privacy__text a');
  await expect(mail).toHaveCount(TEXT.split(CONTACT).length - 1);
  for (const link of await mail.all()) {
    await expect(link).toHaveAttribute('href', `mailto:${CONTACT}`);
    await expect(link).toHaveText(CONTACT);
  }
});

test('the onboarding links to it from every slide, the create-account one included, and its link back returns to the onboarding', async ({ page }) => {
  await page.setViewportSize(COVER);
  await page.goto('/');
  for (const n of [1, 2, 3, 4]) {
    await page.getByRole('tab', { name: `Page ${n}` }).click();
    await expect(page.getByRole('link', { name: LINK })).toBeVisible();
    await expect(page.getByRole('link', { name: LINK })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('link', { name: LINK }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expectThePage(page);
  await expect(page.locator('.onboarding')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('onboarding_complete'))).toBeNull();

  await page.getByRole('link', { name: 'Open FigureCollecting' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.onboarding')).toBeVisible();
});

test('Settings links to it, the page shows inside the app, and Back returns to Settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.setViewportSize(COVER);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 3, name: 'Privacy' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: LINK }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expectThePage(page);
  expect(await shownText(page)).toEqual(TEXT_LINES);
  await expect(page.getByRole('button', { name: 'Collection' })).toBeVisible();

  // The whole text can be reached: the last line scrolls into view above the tab bar.
  const last = page.locator('.privacy__text p').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  const lastBox = (await last.boundingBox())!;
  const tabBar = (await page.getByRole('button', { name: 'Collection' }).boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(tabBar.y);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 3, name: 'About' })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  for (const size of [COVER, { name: 'desktop', width: 1536, height: 730 }]) {
    test(`axe finds nothing on the page: ${theme} theme, ${size.name}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('fc-theme', t), theme);
      await page.setViewportSize(size);
      await page.goto('/privacy');
      await expectThePage(page);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(results.passes.length).toBeGreaterThan(10);
      // The whole text is within reach at this size: the page scrolls to its last line, and nothing runs off the side.
      const last = page.locator('.privacy__text p').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator('.privacy').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  }

  test(`axe finds nothing in the page shown inside the app: ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('fc-theme', t);
      localStorage.setItem('onboarding_complete', '1');
    }, theme);
    await page.setViewportSize(COVER);
    await page.goto('/settings');
    await page.getByRole('link', { name: LINK }).click();
    await expectThePage(page);
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).include('.privacy').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

for (const from of ['its address', 'Settings'] as const) {
  test(`prints whole, black on white, without the app's controls: opened by ${from}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
    if (from === 'Settings') {
      await page.goto('/settings');
      await page.getByRole('link', { name: LINK }).click();
    } else {
      await page.goto('/privacy');
    }
    await expectThePage(page);
    await page.waitForTimeout(500);
    // On screen, inside the app, the sign-in banner and the tab bar stand around the page.
    if (from === 'Settings') {
      await expect(page.locator('.sync-auth-banner')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Collection' })).toBeVisible();
    }
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.privacy__nav')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Collection' })).toBeHidden();
    await expect(page.locator('.sync-auth-banner')).toBeHidden();
    // Nothing but the text takes room on the paper.
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('body *'))
          .filter((el) => !el.closest('.privacy__text') && !el.contains(document.querySelector('.privacy__text')))
          .filter((el) => (el as HTMLElement).offsetHeight > 0 && getComputedStyle(el).visibility !== 'hidden')
          .map((el) => `${el.tagName}.${el.className}`),
      ),
    ).toEqual([]);
    const paper = await page.evaluate(() => {
      const css = (el: Element) => getComputedStyle(el);
      const text = document.querySelector('.privacy__text')!;
      // Every box from the text up to the document: none may clip or scroll, or only the first sheet would print.
      const clipping: string[] = [];
      for (let el: Element | null = text; el !== null; el = el.parentElement) {
        const s = css(el);
        if (s.overflowY !== 'visible' || s.position === 'fixed') clipping.push(`${el.tagName}.${el.className}: ${s.overflowY} ${s.position}`);
      }
      return {
        clipping,
        colour: css(text.querySelector('p')!).color,
        heading: css(text.querySelector('h2')!).color,
        link: css(text.querySelector('a')!).color,
        background: [css(document.body).backgroundColor, css(document.querySelector('.privacy')!).backgroundColor],
        textHeight: text.getBoundingClientRect().height,
        documentHeight: document.documentElement.scrollHeight,
      };
    });
    expect(paper.clipping).toEqual([]);
    expect([paper.colour, paper.heading, paper.link]).toEqual(['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)']);
    expect(paper.background).toEqual(['rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
    // The document is as tall as the text: all of it reaches the paper.
    expect(paper.documentHeight).toBeGreaterThanOrEqual(Math.floor(paper.textHeight));

    // And on paper: more than one sheet, the last line of the text on the last one.
    const pdf = await page.pdf({ format: 'A5' });
    const sheets = pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? [];
    expect(sheets.length).toBeGreaterThan(1);
  });
}

test('once the app is installed, /privacy opens offline from the precache', async ({ context, page }) => {
  await page.goto('/privacy');
  await expectThePage(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise<void>((done) => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expectThePage(page);
  expect(await shownText(page)).toEqual(TEXT_LINES);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});
