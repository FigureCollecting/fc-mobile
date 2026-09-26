/** No usable session: signed out, or the refresh token is gone. Only an interactive sign-in helps. */
export class AuthRequiredError extends Error {
  readonly reason: 'signed_out' | 'reauth';

  constructor(reason: 'signed_out' | 'reauth') {
    super(reason === 'signed_out' ? 'sign in to sync' : 'the session needs signing in again');
    this.name = 'AuthRequiredError';
    this.reason = reason;
  }
}

/** The request never got an answer (offline, DNS, connection reset). Nothing about the session changed. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network unreachable', { cause });
    this.name = 'NetworkError';
  }
}

/** The /callback leg failed; `code` is the OAuth error or one of ours. */
export class LoginError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'LoginError';
    this.code = code;
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
