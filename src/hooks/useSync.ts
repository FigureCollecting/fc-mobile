import { useState, useCallback, useRef } from 'preact/hooks';
import { useSyncStore } from '@figurecollecting/fc-shared';
import type { MfcCookies, SyncPhase, SyncJobStats } from '@figurecollecting/fc-shared';
import {
  validateMfcCookies,
  executeFullSync,
  cancelSyncJob,
} from '@figurecollecting/fc-shared';
import { scraperApi } from '../api/client';
import { useAuthStore } from '../stores/auth';

export type SyncUiPhase =
  | 'idle'
  | 'cookie-setup'
  | 'validating-cookies'
  | 'syncing'
  | 'complete'
  | 'error';

interface SyncProgress {
  completed: number;
  total: number;
  failed: number;
  skipped: number;
  byStatus?: {
    owned: { queued: number; completed: number; failed: number };
    ordered: { queued: number; completed: number; failed: number };
    wished: { queued: number; completed: number; failed: number };
  };
}

/**
 * Manages sync state for the mobile app.
 * Uses the sync store from fc-shared and connects to the scraper API.
 */
export function useSync() {
  const [uiPhase, setUiPhase] = useState<SyncUiPhase>('idle');
  const [progress, setProgress] = useState<SyncProgress>({
    completed: 0,
    total: 0,
    failed: 0,
    skipped: 0,
  });
  const [syncPhase, setSyncPhase] = useState<SyncPhase | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const syncStore = useSyncStore;

  const openCookieSetup = useCallback(() => {
    setUiPhase('cookie-setup');
    setError(null);
  }, []);

  const validateCookies = useCallback(async (cookies: MfcCookies): Promise<boolean> => {
    setUiPhase('validating-cookies');
    setError(null);

    try {
      const result = await validateMfcCookies(scraperApi, cookies);
      if (result.valid) {
        return true;
      }
      setError(result.error || 'Invalid cookies. Please check and try again.');
      setUiPhase('cookie-setup');
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to validate cookies';
      setError(msg);
      setUiPhase('cookie-setup');
      return false;
    }
  }, []);

  const startSync = useCallback(async (cookies: MfcCookies) => {
    setUiPhase('syncing');
    setError(null);
    setSyncPhase('validating');
    setMessage('Starting sync...');
    setProgress({ completed: 0, total: 0, failed: 0, skipped: 0 });

    const user = useAuthStore.getState().user;
    if (!user) {
      setError('You must be signed in to sync.');
      setUiPhase('error');
      return;
    }

    const sessionId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = sessionId;
    syncStore.getState().startSync(sessionId);

    try {
      const result = await executeFullSync(scraperApi, {
        cookies,
        userId: user._id,
        sessionId,
        skipCached: true,
      });

      if (result.success) {
        const stats: SyncJobStats = {
          total: result.parsedCount ?? 0,
          pending: 0,
          processing: 0,
          completed: result.queuedCount ?? 0,
          failed: result.errors?.length ?? 0,
          skipped: result.skippedCount ?? 0,
        };

        setProgress({
          completed: stats.completed,
          total: stats.total,
          failed: stats.failed,
          skipped: stats.skipped,
          byStatus: stats.byStatus,
        });
        setSyncPhase('completed');
        setMessage('Sync complete');
        setUiPhase('complete');
        syncStore.getState().completeSync('completed', stats, 'Sync complete');
      } else {
        throw new Error('Sync did not complete successfully');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      setSyncPhase('failed');
      setUiPhase('error');
      syncStore.getState().setError(err instanceof Error ? err : new Error(msg));
    }
  }, [syncStore]);

  const cancelSync = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await cancelSyncJob(scraperApi, sid);
      } catch {
        // Best-effort cancel
      }
      syncStore.getState().cancelSync();
    }
    sessionIdRef.current = null;
    setSyncPhase('cancelled');
    setMessage('Sync cancelled');
    setUiPhase('idle');
    setProgress({ completed: 0, total: 0, failed: 0, skipped: 0 });
  }, [syncStore]);

  const reset = useCallback(() => {
    setUiPhase('idle');
    setSyncPhase(null);
    setMessage(null);
    setError(null);
    setProgress({ completed: 0, total: 0, failed: 0, skipped: 0 });
    sessionIdRef.current = null;
    syncStore.getState().reset();
  }, [syncStore]);

  return {
    uiPhase,
    syncPhase,
    progress,
    message,
    error,
    openCookieSetup,
    validateCookies,
    startSync,
    cancelSync,
    reset,
  };
}
