import { useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from './useOnlineStatus';
import { flushPendingOps, getPendingOpsCount } from '../storage/pendingOps';
import { api } from '../api/client';

export function useSyncOnReconnect() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!online.value) return;

    let cancelled = false;

    const sync = async () => {
      const count = await getPendingOpsCount();
      if (count === 0) {
        // No pending ops — just refetch
        await queryClient.invalidateQueries();
        return;
      }

      const { success, failed } = await flushPendingOps(api);

      if (cancelled) return;

      if (success > 0) {
        console.log(`[sync] Flushed ${success} pending operations`);
      }
      if (failed > 0) {
        console.warn(`[sync] ${failed} operations failed to sync`);
      }

      // Refetch all queries to get fresh server state
      await queryClient.invalidateQueries();
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, [online.value, queryClient]);
}
