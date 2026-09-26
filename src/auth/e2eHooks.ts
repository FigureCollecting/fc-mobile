// Test-only handles for the local-stack Playwright suite. Loaded only when the
// build sets VITE_E2E_HOOKS=true (.env.stack); production builds never import it.
import { Code, ConnectError, createClient } from '@connectrpc/connect';
import { CompareService } from '@figurecollecting/fc-api-contract';
import { createCoordinatorTransport } from '../api/transport';
import type { AuthSession, AuthStatus } from './session';

export type CompareOutcome = { ok: true; redacted: string[] } | { ok: false; code: string; message: string };

export interface E2eHooks {
  status(): AuthStatus;
  sub(): string | undefined;
  compare(gtin14: string): Promise<CompareOutcome>;
  session(): Promise<{ status: number; body: unknown }>;
  signIn(returnTo?: string): Promise<void>;
  signOut(): Promise<void>;
}

export function createE2eHooks(session: AuthSession): E2eHooks {
  const compare = createClient(CompareService, createCoordinatorTransport(session.fetch));
  return {
    status: () => session.status.value,
    sub: () => session.sub(),
    compare: async (gtin14) => {
      try {
        const res = await compare.compare({ seed: { case: 'gtin14', value: gtin14 }, nowIso: new Date().toISOString() });
        return { ok: true, redacted: res.coverage?.redacted ?? [] };
      } catch (err) {
        const e = ConnectError.from(err);
        return { ok: false, code: Code[e.code], message: e.rawMessage };
      }
    },
    session: async () => {
      const res = await session.fetch('/api/auth/session');
      return { status: res.status, body: await res.json() };
    },
    signIn: (returnTo) => session.signIn(returnTo),
    signOut: () => session.signOut(),
  };
}

export function installE2eHooks(session: AuthSession, target: { __fcAuth?: unknown } = window as never): void {
  target.__fcAuth = createE2eHooks(session);
}
