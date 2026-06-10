import { useState, useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import { registerUser } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { AuthLayout } from '../components/auth/AuthLayout';
import { PasswordStrength } from '../components/auth/PasswordStrength';

export function Register() {
  const [, setLocation] = useLocation();
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((): Record<string, string> | null => {
    const errors: Record<string, string> = {};
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();

    // Username
    if (!trimmedUsername) {
      errors.username = 'Username is required.';
    } else if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      errors.username = 'Username must be 3-30 characters.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      errors.username = 'Only letters, numbers, and underscores allowed.';
    }

    // Email
    if (!trimmedEmail) {
      errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Please enter a valid email address.';
    }

    // Password
    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }

    // Confirm password
    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (confirmPassword !== password) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }, [username, email, password, confirmPassword]);

  const handleSubmit = useCallback(async () => {
    const errors = validate();
    if (errors) {
      setFieldErrors(errors);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    setFieldErrors({});

    try {
      const result = await registerUser(api, username.trim(), email.trim(), password);

      if (result && 'token' in result) {
        setUser(result);
        setLocation('/');
      } else {
        setError('Registration failed. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Registration failed. Please try again.';
      // Try to map server errors to fields
      if (msg.toLowerCase().includes('email') && msg.toLowerCase().includes('exist')) {
        setFieldErrors({ email: 'An account with this email already exists.' });
      } else if (msg.toLowerCase().includes('username') && msg.toLowerCase().includes('exist')) {
        setFieldErrors({ username: 'This username is already taken.' });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [username, email, password, confirmPassword, validate, setUser, setLocation]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
    },
    [handleSubmit],
  );

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (error) setError('');
  }, [error]);

  return (
    <AuthLayout>
      <p class="auth-subtitle">Create your account</p>

      {/* Username */}
      <div class="auth-field">
        <input
          class={`auth-input ${fieldErrors.username ? 'auth-input--error' : ''}`}
          type="text"
          autocomplete="username"
          placeholder="Username"
          value={username}
          onInput={(e) => {
            setUsername((e.target as HTMLInputElement).value);
            clearFieldError('username');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') emailRef.current?.focus();
          }}
        />
        {fieldErrors.username && (
          <p class="auth-field-error">{fieldErrors.username}</p>
        )}
      </div>

      {/* Email */}
      <div class="auth-field">
        <input
          ref={emailRef}
          class={`auth-input ${fieldErrors.email ? 'auth-input--error' : ''}`}
          type="email"
          inputMode="email"
          autocomplete="email"
          placeholder="Email address"
          value={email}
          onInput={(e) => {
            setEmail((e.target as HTMLInputElement).value);
            clearFieldError('email');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') passwordRef.current?.focus();
          }}
        />
        {fieldErrors.email && (
          <p class="auth-field-error">{fieldErrors.email}</p>
        )}
      </div>

      {/* Password */}
      <div class="auth-field">
        <div class="auth-password-wrapper">
          <input
            ref={passwordRef}
            class={`auth-input auth-input--password ${fieldErrors.password ? 'auth-input--error' : ''}`}
            type={showPassword ? 'text' : 'password'}
            autocomplete="new-password"
            placeholder="Password"
            value={password}
            onInput={(e) => {
              setPassword((e.target as HTMLInputElement).value);
              clearFieldError('password');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRef.current?.focus();
            }}
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
        <PasswordStrength password={password} />
        {fieldErrors.password && (
          <p class="auth-field-error">{fieldErrors.password}</p>
        )}
      </div>

      {/* Confirm password */}
      <div class="auth-field">
        <div class="auth-password-wrapper">
          <input
            ref={confirmRef}
            class={`auth-input auth-input--password ${fieldErrors.confirmPassword ? 'auth-input--error' : ''}`}
            type={showConfirmPassword ? 'text' : 'password'}
            autocomplete="new-password"
            placeholder="Confirm password"
            value={confirmPassword}
            onInput={(e) => {
              setConfirmPassword((e.target as HTMLInputElement).value);
              clearFieldError('confirmPassword');
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            class="auth-password-toggle"
            type="button"
            onClick={() => setShowConfirmPassword((v) => !v)}
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {fieldErrors.confirmPassword && (
          <p class="auth-field-error">{fieldErrors.confirmPassword}</p>
        )}
      </div>

      {/* Terms */}
      <p class="auth-terms">
        By creating an account, you agree to our Terms of Service and Privacy Policy.
      </p>

      {/* Error */}
      {error && <p class="auth-error">{error}</p>}

      {/* Submit */}
      <button
        class="auth-btn auth-btn--primary"
        type="button"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? <span class="auth-spinner" /> : 'Create Account'}
      </button>

      {/* Login link */}
      <div class="auth-switch">
        <span class="auth-switch__text">Already have an account?</span>
        <button
          class="auth-text-btn"
          type="button"
          onClick={() => setLocation('/login')}
        >
          Sign in
        </button>
      </div>

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

  .auth-field-error {
    font-size: var(--font-xs);
    color: var(--accent-danger);
    padding-left: var(--space-1);
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

  .auth-terms {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    text-align: center;
    line-height: var(--line-height-normal);
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

  .auth-btn:disabled {
    opacity: 0.7;
  }

  .auth-text-btn {
    font-size: var(--font-sm);
    color: var(--brand-400);
    font-weight: var(--font-weight-medium);
    padding: var(--space-1) 0;
  }

  .auth-switch {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding-bottom: var(--space-4);
  }

  .auth-switch__text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
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
