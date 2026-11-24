import type { BrowserContext, Page } from '@playwright/test';

/** A made-up account subject: the app shows its first eight characters on Profile. */
export const E2E_SUB = '0b9e1c52-6a43-4d6e-9c1f-3c2b8f1d7a10';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Answers every request that would leave this machine with a stub page, so nothing reaches the sign-in server or any
 * other host; returns the addresses it answered, in order.
 */
export async function stubOffMachine(context: BrowserContext): Promise<string[]> {
  const answered: string[] = [];
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname),
    (route) => {
      answered.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>' });
    },
  );
  return answered;
}

/**
 * Leaves the page signed in as E2E_SUB with no server: the onboarding marked done, then, once the app has made its local
 * store, a current subject and an hour-long access token with no refresh token (so no refresh is ever tried) written
 * into it, and the page reloaded so the session starts from them.
 */
export async function seedSignedIn(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.goto('/');
  // Write only once the app has made the store with its auth table: opening a missing store would make an empty
  // version 1 under the app, and Chromium can list the store while its upgrade is still running. Retried until then;
  // each try is one page.evaluate, which settles only once the write has committed or been skipped.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const written = await page.evaluate(async (sub) => {
      if (!(await indexedDB.databases()).some((d) => d.name === 'fc-mobile' && (d.version ?? 0) >= 3)) return false;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('fc-mobile');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('auth')) return false;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('auth', 'readwrite');
          const auth = tx.objectStore('auth');
          auth.put({ sub, accessToken: 'e2e-access-token', expiresAt: Date.now() + 3_600_000, scope: 'openid profile email offline_access' }, `tokens:${sub}`);
          auth.put({ sub }, 'current');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return true;
      } finally {
        db.close();
      }
    }, E2E_SUB);
    if (written) break;
    if (Date.now() > deadline) throw new Error('seedSignedIn: the app made no local store with an auth table in 15 s');
    await page.waitForTimeout(100);
  }
  await page.reload();
}
