// OIDC code + PKCE login, tokens per sub in IndexedDB, single-flight refresh across tabs,
// the device key and its enrolment. A token or network failure never navigates and never
// removes data: it only moves `status` to 'offline' or 'reauth-required'. A local store this
// page's code cannot use (a newer build upgraded it) moves it to 'reload-required'.
import type { ReadonlySignal } from '@preact/signals';
import type { LocalDb } from '../storage/localDb';
import { ServerClock } from './clock';
import { postLogoutUriFor, redirectUriFor, type OidcConfig } from './config';
import { generateDeviceKey, type DeviceKeyRecord } from './deviceKey';
import { createDpopFetch, ENROL_PATH, type DpopCredentials, type DpopFetch } from './dpopFetch';
import { AuthRequiredError, EnrolmentError, LoginError, NetworkError, ReloadRequiredError } from './errors';
import { defaultLocks, type LockManagerLike } from './locks';
import {
  authorizeUrl,
  endSessionUrl,
  exchangeCode,
  idTokenClaims,
  refreshGrant,
  sameIdentity,
  TOKEN_TIMEOUT_MS,
  TokenError,
  type TokenResponse,
} from './oidc';
import { createPkcePair, randomToken } from './pkce';
import { StatusGate, type AuthStatus, type Ticket } from './statusGate';
import { AuthStore, type TokenRecord } from './store';

export type { AuthStatus } from './statusGate';

export interface AuthSessionDeps {
  /** The open local store, asked for on every use: its owner reopens it once its connection is lost. */
  db: () => Promise<LocalDb>;
  config: OidcConfig;
  /** The page origin: redirect_uri, post-logout URI and every DPoP htu derive from it. */
  origin: string;
  fetch: typeof fetch;
  /** A full-page navigation (the IdP legs). */
  navigate: (url: string) => void;
  locks?: LockManagerLike;
  now?: () => number;
  deviceLabel?: string;
  /** Token endpoint and enrolment calls; a request that never answers counts as offline. */
  timeoutMs?: number;
}

const PENDING_TTL_MS = 10 * 60_000;
/** Refresh this close to expiry rather than spend a round trip on a 401. */
const EXPIRY_MARGIN_MS = 5_000;
const DEFAULT_EXPIRES_IN_S = 300;

/** Only a same-origin path, so /callback can never be turned into an open redirect. */
const safeReturnTo = (target: string): string => (/^\/(?![/\\])/.test(target) ? target : '/');

// Every status write goes through the gate with the ticket its public operation took first,
// so a newer build taking the store mid-operation is never overwritten by what that operation
// worked out before it (sessionStatusWrites.test.ts holds this file to that).
export class AuthSession implements DpopCredentials {
  private readonly gate = new StatusGate();
  readonly status: ReadonlySignal<AuthStatus> = this.gate.status;
  readonly clock: ServerClock;
  readonly config: OidcConfig;
  readonly fetch: DpopFetch;
  private readonly deps: AuthSessionDeps;
  private readonly now: () => number;
  private readonly locks: LockManagerLike;
  private readonly timeoutMs: number;
  private currentSub: string | undefined;
  private started: Promise<AuthStatus> | undefined;
  private readonly enrolling = new Map<string, Promise<DeviceKeyRecord>>();

  constructor(deps: AuthSessionDeps) {
    this.deps = deps;
    this.config = deps.config;
    this.now = deps.now ?? Date.now;
    this.locks = deps.locks ?? defaultLocks();
    this.timeoutMs = deps.timeoutMs ?? TOKEN_TIMEOUT_MS;
    this.clock = new ServerClock(this.now);
    this.fetch = createDpopFetch({ credentials: this, clock: this.clock, fetch: deps.fetch, origin: deps.origin, now: this.now });
  }

  sub(): string | undefined {
    return this.currentSub;
  }

  /** The local store this session keeps its rows in, for the sync engine; reopened once the browser closes it. */
  localDb(): Promise<LocalDb> {
    return this.deps.db();
  }

  start(): Promise<AuthStatus> {
    this.started ??= (async () => {
      const ticket = this.gate.ticket();
      const store = await this.store();
      const sub = await store.getCurrentSub();
      const tokens = sub === undefined ? undefined : await store.getTokens(sub);
      if (sub === undefined || tokens === undefined) return this.gate.settle(ticket, 'signed-out');
      this.currentSub = sub;
      const usable = tokens.reauth !== true && (tokens.refreshToken !== undefined || !this.expiring(tokens));
      return this.gate.settle(ticket, usable ? 'signed-in' : 'reauth-required');
    })().catch((err: unknown) => {
      // Shared while pending; a failed start is not kept, so the next call retries it.
      this.started = undefined;
      throw err;
    });
    return this.started;
  }

  /**
   * start() for the page's boot: never rejects. A store that will not open leaves the page
   * 'reload-required' instead of 'loading' with an unhandled rejection; the next call retries it.
   */
  async boot(): Promise<AuthStatus> {
    const ticket = this.gate.ticket();
    try {
      return await this.start();
    } catch {
      return this.gate.settle(ticket, 'reload-required');
    }
  }

  /**
   * A newer build is taking the local store (its owner heard the versionchange): this page's
   * code cannot use it. The next call re-reads the store, so the status follows it if it clears.
   */
  reloadRequired(): void {
    this.started = undefined;
    this.gate.reloadRequired();
  }

  async signIn(returnTo = '/', loginHint?: string): Promise<void> {
    const { verifier, challenge } = await createPkcePair();
    const state = randomToken();
    const nonce = randomToken();
    const redirectUri = redirectUriFor(this.deps.origin);
    const store = await this.store();
    await store.putPending({ state, verifier, nonce, redirectUri, returnTo: safeReturnTo(returnTo), createdAt: this.now() });
    this.deps.navigate(
      authorizeUrl(this.config, { redirectUri, state, challenge, nonce, ...(loginHint === undefined ? {} : { loginHint }) }),
    );
  }

  async completeSignIn(callbackUrl: string): Promise<{ sub: string; returnTo: string }> {
    const ticket = this.gate.ticket();
    await this.start();
    const params = new URL(callbackUrl).searchParams;
    const state = params.get('state');
    const pending = state === null ? undefined : await (await this.store()).takePending(state);
    // No login of ours: a spent or crafted link, so nothing it says is repeated on screen.
    if (pending === undefined) throw new LoginError('unknown_state');
    const back = pending.returnTo;
    const error = params.get('error');
    if (error !== null) throw new LoginError(error, params.get('error_description') ?? undefined, back);
    const code = params.get('code');
    if (code === null) throw new LoginError('invalid_request', 'the reply carried no code', back);
    if (this.now() - pending.createdAt > PENDING_TTL_MS) throw new LoginError('expired_state', undefined, back);

    let tokens: TokenResponse;
    try {
      tokens = await exchangeCode(
        this.config,
        this.deps.fetch,
        { code, verifier: pending.verifier, redirectUri: pending.redirectUri },
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof TokenError) throw new LoginError(err.error, `token endpoint answered ${err.status}`, back, { cause: err });
      throw new LoginError('network', 'the sign-in service could not be reached', back, { cause: err });
    }
    let sub: string;
    try {
      const clock = this.clock.known ? { nowSeconds: this.nowSeconds() } : {};
      sub = idTokenClaims(this.config, tokens.id_token ?? '', { nonce: pending.nonce, ...clock }).sub;
    } catch (err) {
      throw new LoginError('invalid_id_token', (err as Error).message, back);
    }
    // A fresh handle: the browser may have closed the store during the exchange.
    const store = await this.store();
    await store.putTokens(this.record(sub, tokens));
    await store.setCurrentSub(sub);
    this.currentSub = sub;
    this.gate.settle(ticket, 'signed-in');
    try {
      await this.deviceKey(false);
    } catch {
      // Offline or refused: enrolment is retried before the next coordinator call.
    }
    return { sub, returnTo: pending.returnTo };
  }

  async signOut(): Promise<void> {
    const ticket = this.gate.ticket();
    await this.start();
    const store = await this.store();
    const sub = await store.getCurrentSub();
    let idToken: string | undefined;
    if (sub !== undefined) {
      await this.locks.request(this.refreshLock(sub), async () => {
        idToken = (await store.getTokens(sub))?.idToken;
        await store.deleteTokens(sub);
      });
    }
    await store.setCurrentSub(undefined);
    this.currentSub = undefined;
    this.gate.settle(ticket, 'signed-out');
    this.deps.navigate(
      endSessionUrl(this.config, {
        postLogoutRedirectUri: postLogoutUriFor(this.deps.origin),
        ...(idToken === undefined ? {} : { idTokenHint: idToken }),
      }),
    );
  }

  // ------------------------------------------------------------ DpopCredentials

  async accessToken(): Promise<string> {
    const ticket = this.gate.ticket();
    const sub = await this.requireSub(ticket);
    const tokens = await this.requireTokens(sub, ticket);
    return this.expiring(tokens) ? this.refresh(tokens.accessToken, ticket) : tokens.accessToken;
  }

  async refreshAfterReject(rejected: string): Promise<string> {
    const ticket = this.gate.ticket();
    return this.refresh(rejected, ticket);
  }

  private async refresh(rejected: string, ticket: Ticket): Promise<string> {
    const sub = await this.requireSub(ticket);
    return this.locks.request(this.refreshLock(sub), async () => {
      const tokens = await this.requireTokens(sub, ticket);
      // Another tab or call refreshed while this one waited for the lock.
      if (tokens.accessToken !== rejected && !this.expiring(tokens)) return tokens.accessToken;
      if (tokens.reauth === true || tokens.refreshToken === undefined) return this.reauth(tokens, ticket);
      let answer: TokenResponse;
      try {
        answer = await refreshGrant(this.config, this.deps.fetch, tokens.refreshToken, this.timeoutMs);
      } catch (err) {
        if (err instanceof TokenError && err.error === 'invalid_grant') return this.reauth(tokens, ticket);
        if (err instanceof NetworkError) this.gate.settle(ticket, 'offline');
        throw err;
      }
      // Stored first, through a fresh handle (the browser may have closed the store during the
      // request): the IdP has already retired the old refresh token.
      await (await this.store()).putTokens(this.record(sub, answer, tokens));
      if (answer.id_token !== undefined && !sameIdentity(this.config, answer.id_token, sub)) return this.reauth(tokens, ticket);
      this.gate.settle(ticket, 'signed-in');
      return answer.access_token;
    });
  }

  async requireReauth(): Promise<void> {
    const ticket = this.gate.ticket();
    const sub = await this.requireSub(ticket);
    await this.reauth(await this.requireTokens(sub, ticket), ticket).catch(() => undefined);
  }

  async deviceKey(enrolment: boolean): Promise<DeviceKeyRecord> {
    const ticket = this.gate.ticket();
    const sub = await this.requireSub(ticket);
    const store = await this.store();
    const key = (await store.getDeviceKey(sub)) ?? (await store.addDeviceKey(await generateDeviceKey(sub, this.now())));
    if (enrolment || key.deviceId !== undefined) return key;
    let pending = this.enrolling.get(sub);
    if (pending === undefined) {
      pending = this.enrol(store, key).finally(() => this.enrolling.delete(sub));
      this.enrolling.set(sub, pending);
    }
    return pending;
  }

  // ------------------------------------------------------------ internals

  private async enrol(store: AuthStore, key: DeviceKeyRecord): Promise<DeviceKeyRecord> {
    const res = await this.fetch(`${this.deps.origin}${ENROL_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: this.deps.deviceLabel ?? 'fc-mobile web' }),
      signal: AbortSignal.timeout(this.timeoutMs),
      enrolment: true,
    });
    const body = (await res.json().catch(() => ({}))) as { deviceId?: unknown; enrolledAt?: unknown };
    if ((res.status !== 200 && res.status !== 201) || typeof body.deviceId !== 'string') throw new EnrolmentError(res.status);
    const next: DeviceKeyRecord = {
      ...key,
      deviceId: body.deviceId,
      ...(typeof body.enrolledAt === 'string' ? { enrolledAt: body.enrolledAt } : {}),
    };
    await store.putDeviceKey(next);
    return next;
  }

  /** The refresh token is dead: keep everything else, and wait for an interactive sign-in. */
  private async reauth(tokens: TokenRecord, ticket: Ticket): Promise<never> {
    const { refreshToken: _dropped, ...rest } = tokens;
    await (await this.store()).putTokens({ ...rest, reauth: true });
    this.gate.settle(ticket, 'reauth-required');
    throw new AuthRequiredError('reauth');
  }

  private record(sub: string, t: TokenResponse, previous?: TokenRecord): TokenRecord {
    const expiresIn = typeof t.expires_in === 'number' ? t.expires_in : DEFAULT_EXPIRES_IN_S;
    const refreshToken = t.refresh_token ?? previous?.refreshToken;
    const idToken = t.id_token ?? previous?.idToken;
    return {
      sub,
      accessToken: t.access_token,
      expiresAt: this.now() + expiresIn * 1000,
      scope: t.scope ?? previous?.scope ?? this.config.scope,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(idToken === undefined ? {} : { idToken }),
    };
  }

  private async requireSub(ticket: Ticket): Promise<string> {
    await this.start();
    const sub = await (await this.store()).getCurrentSub();
    this.currentSub = sub;
    if (sub === undefined) {
      this.gate.settle(ticket, 'signed-out');
      throw new AuthRequiredError('signed_out');
    }
    return sub;
  }

  private async requireTokens(sub: string, ticket: Ticket): Promise<TokenRecord> {
    const tokens = await (await this.store()).getTokens(sub);
    if (tokens === undefined) {
      this.gate.settle(ticket, 'signed-out');
      throw new AuthRequiredError('signed_out');
    }
    return tokens;
  }

  private expiring(tokens: TokenRecord): boolean {
    return tokens.expiresAt - this.now() <= EXPIRY_MARGIN_MS;
  }

  private nowSeconds(): number {
    return Math.floor(this.clock.serverNow() / 1000);
  }

  private refreshLock(sub: string): string {
    return `fc-auth-refresh:${sub}`;
  }

  /** A VersionError is a newer build's store: no retry of this code opens it, only a reload. */
  private async store(): Promise<AuthStore> {
    try {
      return new AuthStore(await this.deps.db());
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name !== 'VersionError') throw err;
      this.reloadRequired();
      throw new ReloadRequiredError({ cause: err });
    }
  }
}
