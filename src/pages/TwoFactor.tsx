import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { verify2FA } from '@figurecollecting/fc-shared';
import type { User } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { AuthLayout } from '../components/auth/AuthLayout';

const CODE_LENGTH = 6;
const CODE_RE = /^\d{6}$/;

/**
 * Turns the raw /auth/2fa/verify response data into a User shape consistent
 * with what loginUser returns. The backend wraps the payload in
 * { success, data: { _id, username, email, isAdmin, accessToken, refreshToken, ... } }
 * but verify2FA returns the entire envelope unchanged, so we normalize here.
 */
function normalizeVerifyResponse(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = (raw as { data?: Record<string, unknown> }).data;
  if (!payload || typeof payload !== 'object') return null;
  const {
    _id,
    username,
    email,
    isAdmin,
    accessToken,
    refreshToken,
    twoFactorEnabled,
    emailVerified,
    webauthnCredentialCount,
  } = payload as Record<string, unknown>;
  if (!_id || !username || !email || !accessToken) return null;
  return {
    _id: String(_id),
    username: String(username),
    email: String(email),
    isAdmin: Boolean(isAdmin),
    token: String(accessToken),
    refreshToken: refreshToken ? String(refreshToken) : undefined,
    tokenExpiresAt: Date.now() + 14 * 60 * 1000,
    twoFactorEnabled: Boolean(twoFactorEnabled ?? true),
    emailVerified: Boolean(emailVerified ?? false),
    webauthnCredentialCount: Number(webauthnCredentialCount ?? 0),
  };
}

export function TwoFactor() {
  const [, setLocation] = useLocation();
  const pending = useAuthStore((s) => s.twoFactorPending);
  const setUser = useAuthStore((s) => s.setUser);
  const setTwoFactorPending = useAuthStore((s) => s.setTwoFactorPending);

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // No pending 2FA session? Bounce back to login — can't verify without it.
  useEffect(() => {
    if (!pending) {
      setLocation('/login');
    }
  }, [pending, setLocation]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const method = pending?.methods?.[0] ?? 'totp';

  const handleVerify = useCallback(async () => {
    if (loading) return;
    if (!pending) {
      setLocation('/login');
      return;
    }

    const trimmed = code.trim();
    if (!CODE_RE.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const raw = await verify2FA(api, pending.sessionId, method, trimmed);
      const user = normalizeVerifyResponse(raw);
      if (!user) {
        setError('Verification succeeded but the response was malformed. Please try signing in again.');
        setLoading(false);
        return;
      }
      setTwoFactorPending(null);
      setUser(user);
      setLocation('/');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Invalid verification code.';
      setError(msg);
      setLoading(false);
    }
  }, [loading, pending, code, method, setUser, setTwoFactorPending, setLocation]);

  const handleCancel = useCallback(() => {
    setTwoFactorPending(null);
    setLocation('/login');
  }, [setTwoFactorPending, setLocation]);

  const handleCodeInput = useCallback((e: Event) => {
    const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(raw);
    if (error) setError('');
  }, [error]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === CODE_LENGTH && !loading) {
      handleVerify();
    }
  }, [code, loading, handleVerify]);

  if (!pending) {
    return null;
  }

  return (
    <AuthLayout>
      <p class="auth-subtitle">Two-Factor Authentication</p>
      <p class="two-factor__hint">
        Enter the 6-digit code from your authenticator app.
      </p>

      <div class="auth-field">
        <input
          ref={inputRef}
          class={`auth-input two-factor__code ${error ? 'auth-input--error' : ''}`}
          type="text"
          inputMode="numeric"
          autocomplete="one-time-code"
          maxLength={CODE_LENGTH}
          placeholder="000000"
          aria-label="Verification code"
          aria-invalid={error ? 'true' : 'false'}
          value={code}
          onInput={handleCodeInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleVerify();
          }}
        />
      </div>

      {error && <p class="auth-error" role="alert">{error}</p>}

      <button
        class="auth-btn auth-btn--primary"
        type="button"
        onClick={handleVerify}
        disabled={loading || code.length !== CODE_LENGTH}
      >
        {loading ? <span class="auth-spinner" /> : 'Verify'}
      </button>

      <button
        class="auth-btn auth-btn--secondary"
        type="button"
        onClick={handleCancel}
        disabled={loading}
      >
        Cancel
      </button>

      <style>{styles}</style>
    </AuthLayout>
  );
}

const styles = `
  .auth-subtitle {
    text-align: center;
    font-size: var(--font-lg);
    color: var(--text-secondary);
    margin-top: calc(-1 * var(--space-4));
  }

  .two-factor__hint {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    text-align: center;
    line-height: var(--line-height-normal);
  }

  .auth-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .auth-input {
    width: 100%;
    height: var(--touch-min);
    padding: 0 var(--space-4);
    background: var(--surface-tertiary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--font-base);
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .auth-input:focus {
    border-color: var(--brand-500);
  }

  .auth-input--error {
    border-color: var(--accent-danger);
  }

  .two-factor__code {
    text-align: center;
    /* Larger than the 16px input floor by design; !important + the class
       selector opts out of the global guard while staying above 16px. */
    font-size: max(1rem, var(--font-xl)) !important;
    letter-spacing: 0.5em;
    font-variant-numeric: tabular-nums;
    padding-left: calc(var(--space-4) + 0.5em);
  }

  .auth-error {
    font-size: var(--font-sm);
    color: var(--accent-danger);
    text-align: center;
    padding: var(--space-2) var(--space-3);
    background: rgba(239, 68, 68, 0.08);
    border-radius: var(--radius-sm);
  }

  .auth-btn {
    width: 100%;
    height: var(--touch-min);
    border-radius: var(--radius-md);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
  }

  .auth-btn--primary {
    background: var(--brand-500);
    color: white;
  }

  .auth-btn--primary:active:not(:disabled) {
    background: var(--brand-600);
  }

  .auth-btn--secondary {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-primary);
  }

  .auth-btn--secondary:active:not(:disabled) {
    background: var(--surface-tertiary);
  }

  .auth-btn:disabled {
    opacity: 0.6;
  }

  .auth-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: auth-spin 0.7s linear infinite;
  }

  @keyframes auth-spin {
    to { transform: rotate(360deg); }
  }
`;
