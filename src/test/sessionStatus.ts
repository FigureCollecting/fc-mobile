// A stand-in for the page's session that carries only an auth status: what the auth phase (local/useLocal) reads.
import { signal } from '@preact/signals';
import type { AuthStatus } from '../auth/statusGate';
import { localSession } from '../local/session';

/** Sets the session's status (undefined: no session yet); returns the status signal so a test can change it. */
export function stubSessionStatus(status: AuthStatus | undefined) {
  const s = signal<AuthStatus>(status ?? 'loading');
  localSession.value = status === undefined ? undefined : ({ status: s } as unknown as NonNullable<typeof localSession.value>);
  return s;
}
