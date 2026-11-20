// PICK-SLOW: a cellular link for the stack specs whose image host and image lists are page routes. The routes pass each
// answer through it, the page's requests and the service worker's alike (the image sync's fetches go through the worker):
// one downlink every answer shares, first come first served, its bytes at `downBps` and each answer a round trip `rttMs`
// late. A routed answer arrives whole, so keep each one under the app's stall guard (KEPT_SYNC_STEP_MS, 20 s with no byte):
// past it the app aborts what a real link, trickling bytes, would deliver. Uplink is not modelled: what the app sends (a GET,
// a list call's few hundred bytes) is small.

export interface LinkProfile {
  readonly name: string;
  /** Downlink, bits a second. */
  readonly downBps: number;
  readonly rttMs: number;
}

/** The brief's two profiles: a slow cellular link, and a poor one. */
export const SLOW_CELL: LinkProfile = { name: 'cell-1.6M-150ms', downBps: 1_600_000, rttMs: 150 };
export const POOR_CELL: LinkProfile = { name: 'cell-400k-400ms', downBps: 400_000, rttMs: 400 };

export interface Passed {
  readonly url: string;
  readonly bytes: number;
  /** When it was asked and when its last byte arrived, ms since the epoch. */
  readonly askedAt: number;
  readonly doneAt: number;
}

export class SlowLink {
  profile: LinkProfile | undefined;
  /** Every answer passed while a profile was on. */
  readonly passed: Passed[] = [];
  private freeAt = 0;

  /** Hold an answer of `bytes` for as long as the link would take to deliver it (nothing while no profile is on). */
  async pass(url: string, bytes: number): Promise<void> {
    const p = this.profile;
    if (p === undefined) return;
    const askedAt = Date.now();
    const start = Math.max(askedAt + p.rttMs / 2, this.freeAt);
    const doneAt = start + (bytes * 8 * 1000) / p.downBps + p.rttMs / 2;
    this.freeAt = doneAt - p.rttMs / 2;
    this.passed.push({ url, bytes, askedAt, doneAt });
    const wait = doneAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
