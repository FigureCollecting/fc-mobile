// Auth state in the v2 local store, never localStorage. The `auth` store holds the
// in-flight login (keyed by state), tokens per sub and the current sub; the
// `device_key` store holds one key per sub.
import type { LocalDb } from '../storage/localDb';
import type { DeviceKeyRecord } from './deviceKey';

export interface PendingLogin {
  state: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
}

export interface TokenRecord {
  sub: string;
  accessToken: string;
  /** Device-clock ms; a steady skew cancels out because it is compared with the same clock. */
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
  scope: string;
  /** The refresh token was refused: only an interactive sign-in can continue. */
  reauth?: boolean;
}

const pendingKey = (state: string): string => `pending:${state}`;
const tokensKey = (sub: string): string => `tokens:${sub}`;
const CURRENT = 'current';

export class AuthStore {
  private readonly db: LocalDb;

  constructor(db: LocalDb) {
    this.db = db;
  }

  async putPending(p: PendingLogin): Promise<void> {
    await this.db.put('auth', p, pendingKey(p.state));
  }

  /** Read and delete in one transaction: a state is good for one callback only. */
  async takePending(state: string): Promise<PendingLogin | undefined> {
    const tx = this.db.transaction('auth', 'readwrite');
    // Watched from the start: a transaction the browser aborts must not leave an unhandled rejection.
    tx.done.catch(() => {});
    const found = (await tx.store.get(pendingKey(state))) as PendingLogin | undefined;
    if (found !== undefined) await tx.store.delete(pendingKey(state));
    await tx.done;
    return found;
  }

  async getTokens(sub: string): Promise<TokenRecord | undefined> {
    return (await this.db.get('auth', tokensKey(sub))) as TokenRecord | undefined;
  }

  async putTokens(rec: TokenRecord): Promise<void> {
    await this.db.put('auth', rec, tokensKey(rec.sub));
  }

  async deleteTokens(sub: string): Promise<void> {
    await this.db.delete('auth', tokensKey(sub));
  }

  async getCurrentSub(): Promise<string | undefined> {
    return ((await this.db.get('auth', CURRENT)) as { sub: string } | undefined)?.sub;
  }

  async setCurrentSub(sub: string | undefined): Promise<void> {
    if (sub === undefined) await this.db.delete('auth', CURRENT);
    else await this.db.put('auth', { sub }, CURRENT);
  }

  async getDeviceKey(sub: string): Promise<DeviceKeyRecord | undefined> {
    return (await this.db.get('device_key', sub)) as DeviceKeyRecord | undefined;
  }

  /** First writer wins, so two tabs creating a key at once end up signing with the same one. */
  async addDeviceKey(rec: DeviceKeyRecord): Promise<DeviceKeyRecord> {
    const tx = this.db.transaction('device_key', 'readwrite');
    tx.done.catch(() => {});
    const existing = (await tx.store.get(rec.sub)) as DeviceKeyRecord | undefined;
    if (existing === undefined) await tx.store.add(rec as unknown as { sub: string });
    await tx.done;
    return existing ?? rec;
  }

  async putDeviceKey(rec: DeviceKeyRecord): Promise<void> {
    await this.db.put('device_key', rec as unknown as { sub: string });
  }
}
