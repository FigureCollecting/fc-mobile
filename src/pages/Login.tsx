import { useState, useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import { loginUser } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ForgotPassword } from '../components/auth/ForgotPassword';

export function Login() {
  const [, setLocation] = useLocation();
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((): string | null => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return 'Please enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return 'Please enter a valid email address.';
    if (!password) return 'Please enter your password.';
    return null;
  }, [email, password]);

  const handleSubmit = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await loginUser(api, email.trim(), password);

      // Handle 2FA required
      if (result && 'requiresTwoFactor' in result && result.requiresTwoFactor) {
        // For now, show a message. 2FA flow can be added later.
        setError('Two-factor authentication is not yet supported in the mobile app.');
        setLoading(false);
        return;
      }

      // Success - store user and navigate
      if (result && 'token' in result) {
        setUser(result);
        setLocation('/');
      } else {
        setError('Login failed. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Invalid email or password.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [email, password, validate, setUser, setLocation]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <AuthLayout>
      <p class="auth-subtitle">Welcome back</p>

      {/* Email */}
      <div class="auth-field">
        <input
          class={`auth-input ${error ? 'auth-input--error' : ''}`}
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
            if (e.key === 'Enter') passwordRef.current?.focus();
          }}
        />
      </div>

      {/* Password */}
      <div class="auth-field">
        <div class="auth-password-wrapper">
          <input
            ref={passwordRef}
            class={`auth-input auth-input--password ${error ? 'auth-input--error' : ''}`}
            type={showPassword ? 'text' : 'password'}
            autocomplete="current-password"
            placeholder="Password"
            value={password}
            onInput={(e) => {
              setPassword((e.target as HTMLInputElement).value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            class="auth-password-toggle"
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {/* Forgot password */}
      <div class="auth-forgot-row">
        <button
          class="auth-text-btn"
          type="button"
          onClick={() => setForgotOpen(true)}
        >
          Forgot password?
        </button>
      </div>

      {/* Error */}
      {error && <p class="auth-error">{error}</p>}

      {/* Submit */}
      <button
        class="auth-btn auth-btn--primary"
        type="button"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? <span class="auth-spinner" /> : 'Sign In'}
      </button>

      {/* Divider */}
      <div class="auth-divider">
        <span class="auth-divider__line" />
        <span class="auth-divider__text">or</span>
        <span class="auth-divider__line" />
      </div>

      {/* Register link */}
      <button
        class="auth-btn auth-btn--secondary"
        type="button"
        onClick={() => setLocation('/register')}
      >
        Create Account
      </button>

      {/* Forgot password sheet */}
      <ForgotPassword open={forgotOpen} onClose={() => setForgotOpen(false)} />

      <style>{styles}</style>
    </AuthLayout>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const styles = `
  .auth-subtitle {
    text-align: center;
    font-size: var(--font-lg);
    color: var(--text-secondary);
    margin-top: calc(-1 * var(--space-4));
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

  .auth-input--password {
    padding-right: calc(var(--touch-min) + var(--space-1));
  }

  .auth-input::placeholder {
    color: var(--text-tertiary);
  }

  .auth-password-wrapper {
    position: relative;
  }

  .auth-password-toggle {
    position: absolute;
    right: 0;
    top: 0;
    width: var(--touch-min);
    height: var(--touch-min);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .auth-forgot-row {
    display: flex;
    justify-content: flex-end;
    margin-top: calc(-1 * var(--space-2));
  }

  .auth-text-btn {
    font-size: var(--font-sm);
    color: var(--brand-400);
    font-weight: var(--font-weight-medium);
    padding: var(--space-1) 0;
  }

  .auth-error {
    font-size: var(--font-sm);
    color: var(--accent-danger);
    text-align: center;
    line-height: var(--line-height-normal);
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

  .auth-btn--secondary:active {
    background: var(--surface-tertiary);
  }

  .auth-btn:disabled {
    opacity: 0.7;
  }

  .auth-divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .auth-divider__line {
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
  }

  .auth-divider__text {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
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
