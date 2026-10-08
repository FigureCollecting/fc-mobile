// A signed-in local session over the WK-13 engine test rig (fake coordinator, fake IndexedDB),
// as OidcSession publishes one to the screens.
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { QueryClientProvider } from '@tanstack/react-query';
import { CompareResponseSchema, GetProductImagesResponseSchema, ImportMfcExportResponseSchema } from '@figurecollecting/fc-api-contract';
import type { AuthStatus } from '../../auth/statusGate';
import type { SyncEngineDeps } from '../../sync/engine';
import { makeTestQueryClient } from '../../test/testUtils';
import { localSession, type LocalSession, type OnlineClients } from '../session';
import { rig, type Rig } from '../../sync/__tests__/engineSupport';

export interface LocalRig extends Rig {
  status: ReturnType<typeof signal<AuthStatus>>;
  session: LocalSession;
  clients: {
    compare: ReturnType<typeof vi.fn>;
    getProducts: ReturnType<typeof vi.fn>;
    getProductImages: ReturnType<typeof vi.fn>;
    importMfcExport: ReturnType<typeof vi.fn>;
  };
}

export async function localRig(opts: { status?: AuthStatus; publish?: boolean; deps?: Partial<SyncEngineDeps> } = {}): Promise<LocalRig> {
  const r = await rig(opts.deps === undefined ? {} : { deps: opts.deps });
  const status = signal<AuthStatus>(opts.status ?? 'signed-in');
  const clients = {
    compare: vi.fn(async () => create(CompareResponseSchema, { resultJson: JSON.stringify({ heads: [] }) })),
    getProducts: vi.fn((req: Parameters<typeof r.server.catalog.getProducts>[0], o?: Parameters<typeof r.server.catalog.getProducts>[1]) =>
      r.server.catalog.getProducts(req, o),
    ),
    getProductImages: vi.fn(async () => create(GetProductImagesResponseSchema, {})),
    importMfcExport: vi.fn(async () => create(ImportMfcExportResponseSchema, {})),
  };
  const online: OnlineClients = {
    compare: { compare: clients.compare as never },
    catalog: { getProducts: clients.getProducts as never, getProductImages: clients.getProductImages as never },
    import: { importMfcExport: clients.importMfcExport as never },
  };
  const session: LocalSession = {
    engine: r.engine,
    status,
    sub: () => (status.peek() === 'signed-out' ? undefined : 'user-a'),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    clients: online,
  };
  if (opts.publish !== false) localSession.value = session;
  return { ...r, status, session, clients };
}

export function queryWrapper(client = makeTestQueryClient()) {
  return ({ children }: { children: ComponentChildren }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
