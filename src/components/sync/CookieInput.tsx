import { useState, useCallback } from 'preact/hooks';
import type { MfcCookies } from '@figurecollecting/fc-shared';

interface CookieInputProps {
  onSubmit: (cookies: MfcCookies) => void;
  isValidating?: boolean;
  error?: string | null;
}

interface CookieField {
  key: 'PHPSESSID' | 'sesUID' | 'sesDID';
  label: string;
  placeholder: string;
}

const COOKIE_FIELDS: CookieField[] = [
  { key: 'PHPSESSID', label: 'PHPSESSID', placeholder: 'Paste PHPSESSID value' },
  { key: 'sesUID', label: 'sesUID', placeholder: 'Paste sesUID value' },
  { key: 'sesDID', label: 'sesDID', placeholder: 'Paste sesDID value' },
];

function validateCookieStructure(cookies: Record<string, string>): string | null {
  for (const field of COOKIE_FIELDS) {
    const value = cookies[field.key]?.trim();
    if (!value) {
      return `${field.label} is required`;
    }
    if (value.length < 4) {
      return `${field.label} looks too short`;
    }
  }
  return null;
}

export function CookieInput({ onSubmit, isValidating = false, error }: CookieInputProps) {
  const [values, setValues] = useState<Record<string, string>>({
    PHPSESSID: '',
    sesUID: '',
    sesDID: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value.trim() }));
    setLocalError(null);
  }, []);

  const handleClear = useCallback((key: string) => {
    setValues((prev) => ({ ...prev, [key]: '' }));
    setLocalError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const structureError = validateCookieStructure(values);
    if (structureError) {
      setLocalError(structureError);
      return;
    }
    onSubmit(values as unknown as MfcCookies);
  }, [values, onSubmit]);

  const displayError = error || localError;

  return (
    <div class="cookie-input">
      <p class="cookie-input__description">
        Enter your MyFigureCollection session cookies to sync your collection.
      </p>

      {COOKIE_FIELDS.map((field) => (
        <div key={field.key} class="cookie-input__field">
          <label class="cookie-input__label" for={`cookie-${field.key}`}>
            {field.label}
          </label>
          <div class="cookie-input__input-wrapper">
            <input
              id={`cookie-${field.key}`}
              type="text"
              class="cookie-input__input"
              placeholder={field.placeholder}
              value={values[field.key]}
              onInput={(e) => handleChange(field.key, (e.target as HTMLInputElement).value)}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              disabled={isValidating}
            />
            {values[field.key] && !isValidating && (
              <button
                class="cookie-input__clear"
                type="button"
                onClick={() => handleClear(field.key)}
                aria-label={`Clear ${field.label}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9l-6 6M9 9l6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ))}

      {displayError && (
        <div class="cookie-input__error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{displayError}</span>
        </div>
      )}

      <button
        class="cookie-input__submit"
        type="button"
        onClick={handleSubmit}
        disabled={isValidating}
      >
        {isValidating ? (
          <span class="cookie-input__submit-loading">
            <span class="cookie-input__spinner" />
            Validating...
          </span>
        ) : (
          'Validate & Start Sync'
        )}
      </button>

      <button
        class="cookie-input__help-toggle"
        type="button"
        onClick={() => setHelpOpen(!helpOpen)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <span>How to get cookies</span>
        <svg
          class={`cookie-input__help-chevron ${helpOpen ? 'cookie-input__help-chevron--open' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {helpOpen && (
        <div class="cookie-input__help">
          <ol class="cookie-input__help-steps">
            <li>Open <strong>myfigurecollection.net</strong> in your browser and sign in</li>
            <li>Open <strong>Developer Tools</strong> (F12 or right-click and Inspect)</li>
            <li>Go to the <strong>Application</strong> tab (Chrome) or <strong>Storage</strong> tab (Firefox)</li>
            <li>Under <strong>Cookies</strong>, find the MFC domain</li>
            <li>Copy the values for <strong>PHPSESSID</strong>, <strong>sesUID</strong>, and <strong>sesDID</strong></li>
            <li>Paste each value into the fields above</li>
          </ol>
        </div>
      )}

      <style>{`
        .cookie-input {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .cookie-input__description {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          line-height: var(--line-height-normal);
        }

        .cookie-input__field {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .cookie-input__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .cookie-input__input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .cookie-input__input {
          width: 100%;
          padding: var(--space-3) var(--space-4);
          padding-right: var(--touch-min);
          background: var(--surface-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: var(--font-base);
          font-family: monospace;
          min-height: var(--touch-min);
          transition: border-color var(--transition-fast);
        }

        .cookie-input__input::placeholder {
          color: var(--text-tertiary);
          font-family: var(--font-family);
        }

        .cookie-input__input:focus {
          outline: none;
          border-color: var(--brand-500);
        }

        .cookie-input__input:disabled {
          opacity: 0.6;
        }

        .cookie-input__clear {
          position: absolute;
          right: var(--space-2);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          color: var(--text-tertiary);
          border-radius: var(--radius-full);
        }

        .cookie-input__clear:active {
          background: var(--surface-tertiary);
        }

        .cookie-input__error {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3);
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: var(--radius-md);
          color: var(--accent-danger);
          font-size: var(--font-sm);
        }

        .cookie-input__submit {
          width: 100%;
          padding: var(--space-3) var(--space-4);
          background: var(--brand-500);
          color: var(--text-primary);
          border-radius: var(--radius-lg);
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-base);
          min-height: var(--touch-min);
          transition: background var(--transition-fast);
        }

        .cookie-input__submit:active:not(:disabled) {
          background: var(--brand-600);
        }

        .cookie-input__submit:disabled {
          opacity: 0.7;
        }

        .cookie-input__submit-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
        }

        .cookie-input__spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: cookie-spin 0.7s linear infinite;
        }

        @keyframes cookie-spin {
          to { transform: rotate(360deg); }
        }

        .cookie-input__help-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) 0;
          color: var(--text-secondary);
          font-size: var(--font-sm);
          min-height: var(--touch-min);
        }

        .cookie-input__help-toggle:active {
          color: var(--text-primary);
        }

        .cookie-input__help-chevron {
          transition: transform var(--transition-fast);
          margin-left: auto;
        }

        .cookie-input__help-chevron--open {
          transform: rotate(180deg);
        }

        .cookie-input__help {
          padding: var(--space-3) var(--space-4);
          background: var(--surface-primary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .cookie-input__help-steps {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding-left: var(--space-4);
          font-size: var(--font-sm);
          color: var(--text-secondary);
          line-height: var(--line-height-normal);
        }

        .cookie-input__help-steps strong {
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
