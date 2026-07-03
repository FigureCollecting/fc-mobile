import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/preact';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    validateMfcCookies: vi.fn(),
    executeFullSync: vi.fn(),
    cancelSyncJob: vi.fn(),
  };
});

import { validateMfcCookies, executeFullSync } from '@figurecollecting/fc-shared';
import { useSync } from '../useSync';
import { useAuthStore } from '../../stores/auth';

const mockedValidate = validateMfcCookies as unknown as ReturnType<typeof vi.fn>;
const mockedExecute = executeFullSync as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

describe('useSync', () => {
  beforeEach(() => {
    mockedValidate.mockReset();
    mockedExecute.mockReset();
  });

  it('starts in idle and exposes the expected shape', () => {
    const { result } = renderHook(() => useSync());
    expect(result.current.uiPhase).toBe('idle');
    expect(typeof result.current.openCookieSetup).toBe('function');
    expect(typeof result.current.validateCookies).toBe('function');
    expect(typeof result.current.startSync).toBe('function');
  });

  it('transitions to cookie-setup on openCookieSetup', () => {
    const { result } = renderHook(() => useSync());
    act(() => result.current.openCookieSetup());
    expect(result.current.uiPhase).toBe('cookie-setup');
  });

  it('validates cookies and returns true on success', async () => {
    mockedValidate.mockResolvedValueOnce({ valid: true });
    const { result } = renderHook(() => useSync());
    const ok = await result.current.validateCookies({} as any);
    expect(ok).toBe(true);
  });

  it('sets an error when the sync fails', async () => {
    signIn();
    mockedExecute.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await result.current.startSync({} as any);
    });
    await waitFor(() => expect(result.current.uiPhase).toBe('error'));
    expect(result.current.error).toBeTruthy();
  });

  it('fails gracefully when validateCookies throws', async () => {
    mockedValidate.mockRejectedValueOnce(new Error('bad'));
    const { result } = renderHook(() => useSync());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.validateCookies({} as any);
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.uiPhase).toBe('cookie-setup');
  });

  it('returns false when cookies are invalid', async () => {
    mockedValidate.mockResolvedValueOnce({ valid: false, error: 'nope' });
    const { result } = renderHook(() => useSync());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.validateCookies({} as any);
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toBe('nope'));
  });

  it('completes successfully and surfaces progress stats', async () => {
    signIn();
    mockedExecute.mockResolvedValueOnce({
      success: true,
      parsedCount: 10,
      queuedCount: 10,
      skippedCount: 0,
      errors: [],
    });
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await result.current.startSync({} as any);
    });
    await waitFor(() => expect(result.current.uiPhase).toBe('complete'));
    expect(result.current.progress.completed).toBe(10);
  });

  it('bails to error when the user is not signed in', async () => {
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await result.current.startSync({} as any);
    });
    await waitFor(() => expect(result.current.uiPhase).toBe('error'));
  });

  it('reset returns everything to idle', async () => {
    const { result } = renderHook(() => useSync());
    act(() => result.current.openCookieSetup());
    expect(result.current.uiPhase).toBe('cookie-setup');
    act(() => result.current.reset());
    expect(result.current.uiPhase).toBe('idle');
  });
});
