import { useState, useCallback } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import { forgotPasswordRequest } from '@figurecollecting/fc-shared';
import { api } from '../../api/client';

interface ForgotPasswordProps {
  open: boolean;
  onClose: () => void;
}

export function ForgotPassword({ open, onClose }: ForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await forgotPasswordRequest(api, trimmed);
      setSent(true);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleClose = useCallback(() => {
    // Reset state on close
    setEmail('');
    setError('');
    setSent(false);
    setLoading(false);
    onClose();
  }, [onClose]);

  return (
    <BottomSheet open={open} onClose={handleClose} snapPoint="half">
      <div class="forgot-pw">
        {sent ? (
          <>
            <div class="forgot-pw__icon forgot-pw__icon--success">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3 class="forgot-pw__title">Check your email</h3>
            <p class="forgot-pw__text">
              If an account exists for <strong>{email.trim()}</strong>, we sent a password reset link.
            </p>
            <button
              class="forgot-pw__btn forgot-pw__btn--primary"
              type="button"
              onClick={handleClose}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h3 class="forgot-pw__title">Reset password</h3>
            <p class="forgot-pw__text">
              Enter your email and we will send you a link to reset your password.
            </p>

            <input
              class={`forgot-pw__input ${error ? 'forgot-pw__input--error' : ''}`}
              type="email"
              inputMode="email"
              autocomplete="email"
              placeholder="Email address"
              value={email}
              onInput={(e) => {
                setEmail((e.target as HTMLInputElement).value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />

            {error && <p class="forgot-pw__error">{error}</p>}

            <button
              class="forgot-pw__btn forgot-pw__btn--primary"
              type="button"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <span class="forgot-pw__spinner" />
              ) : (
                'Send Reset Link'
              )}
            </button>
          </>
        )}
      </div>

      <style>{styles}</style>
    </BottomSheet>
  );
}

const styles = `
  .forgot-pw {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) 0;
    text-align: center;
  }

  .forgot-pw__icon--success {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: rgba(34, 197, 94, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .forgot-pw__title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .forgot-pw__text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
    max-width: 300px;
  }

  .forgot-pw__input {
    width: 100%;
    height: var(--touch-min);
    padding: 0 var(--space-4);
    background: var(--surface-tertiary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--font-base);
  }

  .forgot-pw__input:focus {
    border-color: var(--brand-500);
  }

  .forgot-pw__input--error {
    border-color: var(--accent-danger);
  }

  .forgot-pw__error {
    font-size: var(--font-sm);
    color: var(--accent-danger);
    text-align: center;
  }

  .forgot-pw__btn {
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

  .forgot-pw__btn--primary {
    background: var(--brand-500);
    color: white;
  }

  .forgot-pw__btn--primary:active:not(:disabled) {
    background: var(--brand-600);
  }

  .forgot-pw__btn:disabled {
    opacity: 0.7;
  }

  .forgot-pw__spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: forgot-spin 0.7s linear infinite;
  }

  @keyframes forgot-spin {
    to { transform: rotate(360deg); }
  }
`;
