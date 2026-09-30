import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { HANDS_OFF_DOMAINS, HANDS_OFF_LAUNCH_ARGS, blockHandsOff, handsOffResolverRules } from './handsOff';

/**
 * Ross, 2026-09-29: nothing we run may send a request to a site that bars AI
 * agents by name. These tests never reach one: every browser they start maps
 * every host it resolves to a local sentinel first, so a request that gets
 * past the guard under test lands on 127.0.0.1 and fails the test.
 */

/** Images on every hands-off domain: the apex, subdomains, http, https and a port. */
const HANDS_OFF_IMAGES = [
  'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  'https://myfigurecollection.net/pics/item.jpg',
  'http://myfigurecollection.net/pics/item.jpg',
  'https://www.suruga-ya.jp/database/pics/game/g1.jpg',
  'https://suruga-ya.com/img/1.jpg',
  'https://www.hobby-genki.com/img/1.jpg',
  'https://t.vndb.org/cv/00/1.jpg',
  'http://s2.vndb.org:8080/ch/1.jpg',
];

/** A host that is not hands-off, loaded first to prove the sentinel catches what a browser sends. */
const CANARY = 'http://fc-canary.test/canary.png';

/** Not hands-off, though they look like it or mention one: the guard must let them through. */
const LOOK_ALIKES = [
  'http://notmyfigurecollection.net/x.png',
  'http://myfigurecollection.net.fc-canary.test/x.png',
  'http://fc-canary.test/from?u=https://static.myfigurecollection.net/x.jpg',
];

/**
 * A local TCP listener standing in for the internet. It records the Host of
 * each plain HTTP request, or 'tls' for an https handshake, and hangs up.
 */
async function startSentinel() {
  const hosts: string[] = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (chunk) => {
      hosts.push(chunk[0] === 0x16 ? 'tls' : (/\r\nhost: ([^\r\n:]+)/i.exec(chunk.toString('latin1'))?.[1] ?? 'unknown'));
      socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    hosts,
    /** Last in a rule list: every host no earlier rule maps goes to the sentinel. */
    catchAll: `MAP * 127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Puts the images in a blank page (no CSP) and waits until each has loaded or failed. */
async function loadImages(page: Page, urls: string[]): Promise<void> {
  await page.setContent(urls.map((u) => `<img src="${u}">`).join(''));
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
}

/** Each failed request's error, by URL. */
function failures(page: Page): Map<string, string> {
  const out = new Map<string, string>();
  page.on('requestfailed', (r) => out.set(r.url(), r.failure()?.errorText ?? ''));
  return out;
}

test('the probe images cover every hands-off domain', () => {
  for (const domain of HANDS_OFF_DOMAINS) {
    const hosts = HANDS_OFF_IMAGES.map((u) => new URL(u).hostname);
    expect(hosts.some((h) => h === domain || h.endsWith(`.${domain}`)), domain).toBe(true);
  }
});

test.describe('resolver rules (the network-level net under every Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '--host-resolver-rules is a Chromium switch');

  test('this project launches Chromium with them', ({}, testInfo) => {
    expect(HANDS_OFF_LAUNCH_ARGS).toHaveLength(1);
    expect(testInfo.project.use.launchOptions?.args ?? []).toEqual(expect.arrayContaining(HANDS_OFF_LAUNCH_ARGS));
  });

  test('they give a hands-off host no address, so an image there is never sent even with no route', async ({ playwright }) => {
    const sentinel = await startSentinel();
    const rules = [handsOffResolverRules(), sentinel.catchAll].filter(Boolean).join(', ');
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=${rules}`] });
    try {
      const page = await browser.newPage();
      const failed = failures(page);
      await loadImages(page, [CANARY]);
      await expect.poll(() => sentinel.hosts, 'the canary reached the sentinel').toContain('fc-canary.test');

      await loadImages(page, HANDS_OFF_IMAGES);
      expect(new Set(sentinel.hosts)).toEqual(new Set(['fc-canary.test']));
      for (const url of HANDS_OFF_IMAGES) expect(failed.get(url), url).toBe('net::ERR_NAME_NOT_RESOLVED');
    } finally {
      await browser.close();
      await sentinel.close();
    }
  });
});

test.describe('the route guard every e2e context gets', () => {
  // The resolver rules are the net under these tests; WebKit has none.
  test.skip(({ browserName }) => browserName !== 'chromium', 'runs only where the resolver rules back it up');

  test('aborts an image on every hands-off host before it is sent', async ({ page, handsOffBlocked }) => {
    const failed = failures(page);
    const answered: string[] = [];
    page.on('response', (r) => answered.push(r.url()));

    await loadImages(page, HANDS_OFF_IMAGES);

    expect(new Set(handsOffBlocked)).toEqual(new Set(HANDS_OFF_IMAGES));
    // Blocked by the client (the route), not a failed lookup (the resolver rules under it).
    for (const url of HANDS_OFF_IMAGES) expect(failed.get(url), url).toMatch(/^net::ERR_BLOCKED_BY_CLIENT\b/);
    expect(answered).toEqual([]);
    expect(await page.evaluate(() => Array.from(document.images, (img) => img.naturalWidth))).toEqual(HANDS_OFF_IMAGES.map(() => 0));
  });

  test('aborts a fetch and a navigation to a hands-off host too', async ({ page, handsOffBlocked }) => {
    const fetched = await page.evaluate(() =>
      fetch('https://vndb.org/v11').then(
        () => 'answered',
        () => 'refused',
      ),
    );
    expect(fetched).toBe('refused');
    await expect(page.goto('https://myfigurecollection.net/item/1')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(handsOffBlocked).toEqual(['https://vndb.org/v11', 'https://myfigurecollection.net/item/1']);
  });

  test('blockHandsOff keeps any browser off the hosts and lets other hosts through', async ({ playwright }) => {
    const sentinel = await startSentinel();
    // No hands-off rules here: whatever the guard lets through reaches the sentinel.
    const browser = await playwright.chromium.launch({ args: [`--host-resolver-rules=${sentinel.catchAll}`] });
    try {
      const context = await browser.newContext();
      const blocked = await blockHandsOff(context);
      const page = await context.newPage();
      await loadImages(page, [CANARY]);
      await expect.poll(() => sentinel.hosts, 'the canary reached the sentinel').toContain('fc-canary.test');

      await loadImages(page, [...HANDS_OFF_IMAGES, ...LOOK_ALIKES]);
      await expect
        .poll(() => new Set(sentinel.hosts))
        .toEqual(new Set(['fc-canary.test', 'notmyfigurecollection.net', 'myfigurecollection.net.fc-canary.test']));
      expect(new Set(blocked)).toEqual(new Set(HANDS_OFF_IMAGES));
    } finally {
      await browser.close();
      await sentinel.close();
    }
  });
});

