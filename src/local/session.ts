// What the screens read and write through (WK-15): the page's sync engine, the session's status and
// the coordinator clients for the online-only calls, published by OidcSession once sync starts.
// The engine is the only path to the local store and the only sync path; the screens never write
// the auth status. SearchProducts is the Search screen's catalog section (WK-17).
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Client } from '@connectrpc/connect';
import type { CatalogService, CompareService, ImportService } from '@figurecollecting/fc-api-contract';
import type { AuthStatus } from '../auth/statusGate';
import type { SyncEngine } from '../sync/engine';

export interface OnlineClients {
  compare: Pick<Client<typeof CompareService>, 'compare'>;
  catalog: Pick<Client<typeof CatalogService>, 'getProducts' | 'getProductImages' | 'searchProducts'>;
  import: Pick<Client<typeof ImportService>, 'importMfcExport'>;
}

export interface LocalSession {
  engine: SyncEngine;
  status: ReadonlySignal<AuthStatus>;
  sub(): string | undefined;
  signIn(returnTo?: string): Promise<void>;
  signOut(): Promise<void>;
  clients: OnlineClients;
}

export const localSession = signal<LocalSession | undefined>(undefined);

export class NotSignedInError extends Error {
  constructor() {
    super('not signed in: there is no local store to write to');
    this.name = 'NotSignedInError';
  }
}

export function requireSession(): LocalSession {
  const session = localSession.peek();
  if (session === undefined) throw new NotSignedInError();
  return session;
}
