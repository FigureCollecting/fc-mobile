// The coordinator's Connect-Web transport: same origin under /api, every call
// through the DPoP fetch (proof, nonce retry, one refresh). Auth and network
// failures, a local store only a reload can use, and an enrolment the coordinator
// could not answer, reach callers as Connect codes they can branch on.
import { Code, ConnectError, type Transport } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { AuthRequiredError, EnrolmentError, NetworkError, ReloadRequiredError } from '../auth/errors';
import type { DpopFetch } from '../auth/dpopFetch';

export const COORDINATOR_BASE_URL = '/api';

function toConnectError(err: unknown): unknown {
  if (err instanceof ConnectError || (err as { name?: unknown } | null)?.name === 'AbortError') return err;
  if (err instanceof AuthRequiredError) return new ConnectError(err.message, Code.Unauthenticated, undefined, undefined, err);
  if (err instanceof ReloadRequiredError) return new ConnectError(err.message, Code.FailedPrecondition, undefined, undefined, err);
  if (err instanceof NetworkError || (err instanceof EnrolmentError && err.status >= 500)) {
    return new ConnectError(err.message, Code.Unavailable, undefined, undefined, err);
  }
  return ConnectError.from(err);
}

export function createCoordinatorTransport(dpopFetch: DpopFetch): Transport {
  return createConnectTransport({
    baseUrl: COORDINATOR_BASE_URL,
    fetch: async (input, init) => {
      try {
        return await dpopFetch(String(input), init);
      } catch (err) {
        throw toConnectError(err);
      }
    },
  });
}
