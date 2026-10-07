/** No usable session: signed out, or the refresh token is gone. Only an interactive sign-in helps. */
export class AuthRequiredError extends Error {
  readonly reason: 'signed_out' | 'reauth';

  constructor(reason: 'signed_out' | 'reauth') {
    super(reason === 'signed_out' ? 'sign in to sync' : 'the session needs signing in again');
    this.name = 'AuthRequiredError';
    this.reason = reason;
  }
}

/**
 * This page's code cannot use the local store: a newer build upgraded it, or it would not open
 * at boot. Nothing in the store was touched; a reload (into the newest build) continues.
 */
export class ReloadRequiredError extends Error {
  constructor(options?: ErrorOptions) {
    super('this page needs a reload', options);
    this.name = 'ReloadRequiredError';
  }
}

/** The request never got an answer (offline, DNS, connection reset). Nothing about the session changed. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network unreachable', { cause });
    this.name = 'NetworkError';
  }
}

/**
 * The /callback leg failed; `code` is the OAuth error or one of ours. `returnTo` is set only
 * when the reply matched a login this device started (a safe same-origin path).
 */
export class LoginError extends Error {
  readonly code: string;
  readonly returnTo: string | undefined;

  constructor(code: string, detail?: string, returnTo?: string, options?: ErrorOptions) {
    super(detail === undefined ? code : `${code}: ${detail}`, options);
    this.name = 'LoginError';
    this.code = code;
    this.returnTo = returnTo;
  }
}

/** POST /api/auth/devices answered with something other than 200/201. */
export class EnrolmentError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`device enrolment refused (${status})`);
    this.name = 'EnrolmentError';
    this.status = status;
  }
}
