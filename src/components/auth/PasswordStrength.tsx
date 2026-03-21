interface PasswordStrengthProps {
  password: string;
}

interface Rule {
  label: string;
  met: boolean;
}

function getPasswordRules(password: string): Rule[] {
  return [
    { label: '8+ characters', met: password.length >= 8 },
    { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Number', met: /[0-9]/.test(password) },
    { label: 'Special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

function getStrength(rules: Rule[]): { level: 'weak' | 'medium' | 'strong'; percent: number } {
  const met = rules.filter((r) => r.met).length;
  if (met <= 1) return { level: 'weak', percent: 25 };
  if (met === 2) return { level: 'weak', percent: 40 };
  if (met === 3) return { level: 'medium', percent: 70 };
  return { level: 'strong', percent: 100 };
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) return null;

  const rules = getPasswordRules(password);
  const { level, percent } = getStrength(rules);

  const colorMap = {
    weak: 'var(--accent-danger)',
    medium: 'var(--accent-warning)',
    strong: 'var(--accent-success)',
  };

  return (
    <div class="pw-strength">
      <div class="pw-strength__bar-track">
        <div
          class="pw-strength__bar-fill"
          style={{ width: `${percent}%`, background: colorMap[level] }}
        />
      </div>
      <div class="pw-strength__rules">
        {rules.map((rule) => (
          <span
            key={rule.label}
            class={`pw-strength__rule ${rule.met ? 'pw-strength__rule--met' : ''}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              {rule.met ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <circle cx="12" cy="12" r="1" fill="currentColor" />
              )}
            </svg>
            {rule.label}
          </span>
        ))}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .pw-strength {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pw-strength__bar-track {
    height: 4px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .pw-strength__bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 300ms var(--spring-snappy), background 300ms var(--spring-snappy);
  }

  .pw-strength__rules {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .pw-strength__rule {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    transition: color var(--transition-fast);
  }

  .pw-strength__rule--met {
    color: var(--accent-success);
  }
`;
