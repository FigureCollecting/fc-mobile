import { signal, effect } from '@preact/signals';

export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'fc-theme';

const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
export const theme = signal<Theme>(stored || 'dark');

/** Resolve the effective theme (dark or light) from the current signal value */
export function resolvedTheme(): 'dark' | 'light' {
  if (theme.value === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme.value;
}

// Apply theme to document whenever the signal changes
effect(() => {
  const resolved = resolvedTheme();
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(STORAGE_KEY, theme.value);
});

// Listen for OS preference changes when using "system" theme
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') {
      const resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', resolved);
    }
  });
}
