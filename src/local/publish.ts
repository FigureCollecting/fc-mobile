// OidcSession hands the screens the page's sync engine, the session's status and the coordinator
// clients for the online-only calls (Compare, ImportService, GetProductImages), all over the
// session's DPoP fetch. Making a client sends nothing.
import { createClient } from '@connectrpc/connect';
import { CatalogService, CompareService, ImportService } from '@figurecollecting/fc-api-contract';
import type { ReadonlySignal } from '@preact/signals';
import { createCoordinatorTransport } from '../api/transport';
import type { DpopFetch } from '../auth/dpopFetch';
import type { AuthStatus } from '../auth/statusGate';
import type { SyncEngine } from '../sync/engine';
import { localSession, type LocalSession } from './session';

export interface PublishableSession {
  readonly status: ReadonlySignal<AuthStatus>;
  readonly fetch: DpopFetch;
  sub(): string | undefined;
  signIn(returnTo?: string): Promise<void>;
  signOut(): Promise<void>;
}

export function publishLocalSession(session: PublishableSession, engine: SyncEngine): LocalSession {
  const transport = createCoordinatorTransport(session.fetch);
  const local: LocalSession = {
    engine,
    status: session.status,
    sub: () => session.sub(),
    signIn: (returnTo) => session.signIn(returnTo),
    signOut: () => session.signOut(),
    clients: {
      compare: createClient(CompareService, transport),
      catalog: createClient(CatalogService, transport),
      import: createClient(ImportService, transport),
    },
  };
  localSession.value = local;
  return local;
}
