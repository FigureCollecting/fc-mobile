// The OIDC session and the page's sync as the app-level tests stand them in: a session whose
// status the test sets, and the WK-13 engine on the fake coordinator (no network, fake IndexedDB).
import { signal } from '@preact/signals';
import { vi } from 'vitest';
import type { AuthStatus } from '../auth/statusGate';
import { rig, type Rig } from '../sync/__tests__/engineSupport';

export function fakeAuthSession(settlesTo: AuthStatus) {
  const status = signal<AuthStatus>('loading');
  const session = {
    status,
    start: vi.fn(async () => {
      status.value = settlesTo;
      return settlesTo;
    }),
    boot: vi.fn(async () => session.start()),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    completeSignIn: vi.fn(async () => ({ sub: 'user-a', returnTo: '/' })),
    sub: () => (status.peek() === 'signed-out' || status.peek() === 'loading' ? undefined : 'user-a'),
    fetch: vi.fn(async () => new Response(null, { status: 503 })),
  };
  return session;
}

export type FakeAuthSession = ReturnType<typeof fakeAuthSession>;

export async function fakeBrowserSync(): Promise<{ engine: Rig['engine']; dispose: () => void; rig: Rig }> {
  const r = await rig();
  return { engine: r.engine, dispose: vi.fn(), rig: r };
}
