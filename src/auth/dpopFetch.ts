// fetch with DPoP for every coordinator call, Connect or plain JSON alike. Per
// call: at most one retry for a nonce or clock correction and at most one
// refresh on invalid_token; after that the 401 goes back to the caller.
import type { ServerClock } from './clock';
import type { DeviceKeyRecord } from './deviceKey';
import { createDpopProof, dpopChallengeError } from './dpop';
import { NetworkError } from './errors';

export const ENROL_PATH = '/api/auth/devices';

/** A 401 whose Date moved the clock estimate this far was an iat rejection worth one retry. */
const CLOCK_RETRY_MS = 3_000;

export interface DpopCredentials {
  accessToken(): Promise<string>;
  /** The signing key, enrolled first unless this call is the enrolment. */
  deviceKey(enrolment: boolean): Promise<DeviceKeyRecord>;
  refreshAfterReject(rejected: string): Promise<string>;
  requireReauth(): Promise<void>;
}

export interface DpopRequestInit extends RequestInit {
  enrolment?: boolean;
}

export type DpopFetch = (input: string, init?: DpopRequestInit) => Promise<Response>;

export interface DpopFetchDeps {
  credentials: DpopCredentials;
  clock: ServerClock;
  fetch: typeof fetch;
  origin: string;
  now: () => number;
}

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

export function createDpopFetch(deps: DpopFetchDeps): DpopFetch {
  let nonce: string | undefined;

  return async (input, init = {}) => {
    const { enrolment = false, ...rest } = init;
    const url = new URL(input, deps.origin);
    const method = (rest.method ?? 'GET').toUpperCase();
    const htu = `${url.origin}${url.pathname}`;
    let accessToken = await deps.credentials.accessToken();
    const key = await deps.credentials.deviceKey(enrolment);
    let nonceRetried = false;
    let refreshed = false;

    for (;;) {
      const offsetUsed = deps.clock.offsetMs();
      const headers = new Headers(rest.headers);
      headers.set('authorization', `DPoP ${accessToken}`);
      headers.set(
        'dpop',
        await createDpopProof(key, {
          method,
          htu,
          iat: Math.floor(deps.clock.serverNow() / 1000),
          accessToken,
          ...(nonce === undefined ? {} : { nonce }),
        }),
      );
      const sentAt = deps.now();
      let res: Response;
      try {
        res = await deps.fetch(url.toString(), { ...rest, method, headers });
      } catch (err) {
        if (isAbort(err)) throw err;
        throw new NetworkError(err);
      }
      deps.clock.observe(res.headers.get('date'), sentAt, deps.now());
      nonce = res.headers.get('dpop-nonce') ?? nonce;
      if (res.status !== 401) return res;

      const error = dpopChallengeError(res.headers.get('www-authenticate'));
      const clockMoved = Math.abs(deps.clock.offsetMs() - offsetUsed) > CLOCK_RETRY_MS;
      if (!nonceRetried && (error === 'use_dpop_nonce' || (error === 'invalid_dpop_proof' && clockMoved))) {
        nonceRetried = true;
        continue;
      }
      if (error === 'invalid_token' && !refreshed) {
        refreshed = true;
        accessToken = await deps.credentials.refreshAfterReject(accessToken);
        continue;
      }
      if (error === 'invalid_token') await deps.credentials.requireReauth();
      return res;
    }
  };
}
