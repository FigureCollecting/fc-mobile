// The coordinator's clock as seen from here. DPoP iat must fall within
// [server - 30 s, server + 5 s], and phones drift, so every proof is stamped with
// device time plus the offset measured from the coordinator's Date header.
export class ServerClock {
  private offset: number | undefined;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get known(): boolean {
    return this.offset !== undefined;
  }

  offsetMs(): number {
    return this.offset ?? 0;
  }

  serverNow(): number {
    return this.now() + this.offsetMs();
  }

  /** Date has whole-second resolution: take the middle of that second at the middle of the round trip. */
  observe(dateHeader: string | null, sentAt: number, receivedAt: number): void {
    if (dateHeader === null) return;
    const server = Date.parse(dateHeader);
    if (Number.isNaN(server)) return;
    this.offset = server + 500 - Math.round((sentAt + receivedAt) / 2);
  }
}
