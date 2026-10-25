// NAV-PTR-1: what the app's own pull-to-refresh does across a gesture. A fixture-mode refresh is over within a frame or
// two, so a look after the gesture alone would miss it: this watches every change the indicator and the spinner make.
import type { Page } from '@playwright/test';

export interface PullSeen {
  /** The tallest the indicator was drawn (CSS px): it grows with a pull. */
  tallestPx: number;
  /** Whether the spinner ever turned: a refresh ran. */
  refreshed: boolean;
}

/** Watch the pull-to-refresh from now on; the returned function reads what it saw. */
export async function watchPull(page: Page): Promise<() => Promise<PullSeen>> {
  await page.evaluate(() => {
    const seen = { tallestPx: 0, refreshed: false };
    (window as unknown as { __pullSeen: typeof seen }).__pullSeen = seen;
    const look = () => {
      const indicator = document.querySelector<HTMLElement>('.pull-to-refresh__indicator');
      if (indicator) seen.tallestPx = Math.max(seen.tallestPx, parseFloat(indicator.style.height) || 0);
      if (document.querySelector('.pull-to-refresh__spinner--active')) seen.refreshed = true;
    };
    new MutationObserver(look).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  });
  return () => page.evaluate(() => ({ ...(window as unknown as { __pullSeen: { tallestPx: number; refreshed: boolean } }).__pullSeen }));
}
