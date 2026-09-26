// One simulated device-and-network: a fake IdP and coordinator behind a routed
// fetch, a shared IndexedDB (fake-indexeddb) and a shared lock manager, so two
// AuthSessions built here behave like two tabs of the same origin.
import { IDBFactory } from 'fake-indexeddb';
import { openLocalDb, type LocalDb } from '../../storage/localDb';
import { AuthSession } from '../session';
import { APP_ORIGIN, FakeCoordinator, FakeIdp, FakeNet, IDP_ORIGIN, MemoryLocks, SUB_A, T0 } from './fakes';

export interface TabOptions {
  /** Device clock minus the servers' clock. */
  skewMs?: number;
  /** Omit to exercise the no-Web-Locks fallback. */
  locks?: MemoryLocks | null;
  timeoutMs?: number;
}

export class World {
  t = T0;
  readonly net = new FakeNet();
  readonly locks = new MemoryLocks();
  readonly factory = new IDBFactory();
  readonly navigations: string[] = [];

  readonly idp: FakeIdp;
  readonly coord: FakeCoordinator;

  private constructor(idp: FakeIdp, coord: FakeCoordinator) {
    this.idp = idp;
    this.coord = coord;
  }

  static async create(): Promise<World> {
    const idp = await FakeIdp.create();
    const coord = new FakeCoordinator(idp);
    const world = new World(idp, coord);
    idp.now = () => world.t;
    coord.serverNow = () => world.t;
    world.net.route(IDP_ORIGIN, idp.handler);
    world.net.route(APP_ORIGIN, coord.handler);
    return world;
  }

  tab(options: TabOptions = {}): AuthSession {
    let db: Promise<LocalDb> | undefined;
    return new AuthSession({
      db: () => (db ??= openLocalDb({ factory: this.factory })),
      config: this.idp.config,
      origin: APP_ORIGIN,
      fetch: this.net.fetch,
      navigate: (url) => this.navigations.push(url),
      ...(options.locks === null ? {} : { locks: options.locks ?? this.locks }),
      now: () => this.t + (options.skewMs ?? 0),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  /** Sign in through the IdP the way the browser would: navigate, authorize, come back to /callback. */
  async signIn(session: AuthSession, sub = SUB_A, returnTo = '/'): Promise<{ sub: string; returnTo: string }> {
    await session.signIn(returnTo);
    const callback = this.idp.authorize(this.navigations.at(-1)!, sub);
    return session.completeSignIn(callback);
  }

  /** A second connection for looking at what the store holds. */
  inspect(): Promise<LocalDb> {
    return openLocalDb({ factory: this.factory });
  }

  statuses(from = 0): number[] {
    return this.coord.log.slice(from).map((e) => e.status);
  }
}

export const compareUrl = `${APP_ORIGIN}/api/coordinator.v1.CompareService/Compare`;

export const compareInit = (gtin14 = '04580416940269'): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' },
  body: JSON.stringify({ gtin14 }),
});
