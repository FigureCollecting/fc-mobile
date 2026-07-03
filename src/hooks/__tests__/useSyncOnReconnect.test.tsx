import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../storage/pendingOps', () => ({
  getPendingOpsCount: vi.fn(),
  flushPendingOps: vi.fn(),
}));

import { getPendingOpsCount, flushPendingOps } from '../../storage/pendingOps';
import { useSyncOnReconnect } from '../useSyncOnReconnect';

const mockedCount = getPendingOpsCount as unknown as ReturnType<typeof vi.fn>;
const mockedFlush = flushPendingOps as unknown as ReturnType<typeof vi.fn>;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: unknown }) => (
    <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
  );
}

describe('useSyncOnReconnect', () => {
  it('skips flushing when there are no pending ops and just invalidates', async () => {
    mockedCount.mockResolvedValueOnce(0);
    renderHook(() => useSyncOnReconnect(), { wrapper: wrapper() });
    await waitFor(() => expect(mockedCount).toHaveBeenCalled());
    expect(mockedFlush).not.toHaveBeenCalled();
  });

  it('flushes pending ops when present', async () => {
    mockedCount.mockResolvedValueOnce(3);
    mockedFlush.mockResolvedValueOnce({ success: 3, failed: 0 });
    renderHook(() => useSyncOnReconnect(), { wrapper: wrapper() });
    await waitFor(() => expect(mockedFlush).toHaveBeenCalled());
  });
});
