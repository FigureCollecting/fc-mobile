import { describe, expect, it } from 'vitest';
import { accountPages, configuredAccountPages, DEFAULT_IDP_ORIGIN } from '../config';

// Change Password runs fc's own flow (fc-infra nodes/fc-ha-01/authentik/blueprints/fc-flows.yaml slug
// fc-password-change: current password, then a second factor, then the new password). Not the user settings' User
// details tab: its password card runs the first password stage with a configure flow, the stock
// default-password-change, which asks for neither. Two-Factor opens the user settings' Credentials tab
// (Authentik 2026.8.5 web: UserSettingsPage.ts slot page-credentials).
const PASSWORD_FLOW = 'https://auth.mindsignals1.com/if/flow/fc-password-change/';
const CREDENTIALS = 'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D';

const tabOf = (href: string) => {
  const [route, params, ...rest] = new URL(href).hash.slice(1).split(';');
  return { route, page: JSON.parse(decodeURIComponent(params!)) as unknown, rest };
};

describe('account pages on the sign-in server', () => {
  it('opens fc-password-change for the password and the Credentials tab for two-factor, on the production host', () => {
    expect(accountPages()).toEqual({ passwordChange: PASSWORD_FLOW, mfaDevices: CREDENTIALS });
    expect(accountPages(DEFAULT_IDP_ORIGIN)).toEqual(accountPages());
  });

  it('opens the password flow bare: no next=, no query, no hash, never the stock settings card', () => {
    const url = new URL(accountPages().passwordChange);
    expect(url.pathname).toBe('/if/flow/fc-password-change/');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(accountPages().passwordChange).not.toMatch(/next=|\/if\/user\/|settings|default-password-change/);
  });

  it('carries the two-factor tab as the JSON Authentik reads after the route separator, and nothing else', () => {
    const url = new URL(accountPages().mfaDevices);
    expect(url.pathname).toBe('/if/user/');
    expect(url.search).toBe('');
    expect(tabOf(accountPages().mfaDevices)).toEqual({ route: '/settings', page: { page: 'page-credentials' }, rest: [] });
    expect(accountPages().mfaDevices).not.toMatch(/next=/);
  });

  it('offers no email change until the sign-in server has one on its settings page', () => {
    expect(Object.keys(accountPages()).sort()).toEqual(['mfaDevices', 'passwordChange']);
  });

  it('follows the origin it is given, with or without trailing slashes', () => {
    expect(accountPages('http://127.0.0.1:8481//').passwordChange).toBe('http://127.0.0.1:8481/if/flow/fc-password-change/');
    expect(accountPages('http://127.0.0.1:8481').mfaDevices).toBe(
      'http://127.0.0.1:8481/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D',
    );
  });

  it('uses the build IdP: production unless the build names another, an empty name being none', () => {
    expect(configuredAccountPages({})).toEqual(accountPages());
    expect(configuredAccountPages({ VITE_OIDC_ORIGIN: '' })).toEqual(accountPages());
    expect(configuredAccountPages({ VITE_OIDC_ORIGIN: 42 })).toEqual(accountPages());
    expect(configuredAccountPages({ VITE_OIDC_ORIGIN: 'http://127.0.0.1:8481/' })).toEqual(accountPages('http://127.0.0.1:8481'));
    expect(configuredAccountPages()).toEqual(
      accountPages(import.meta.env.VITE_OIDC_ORIGIN ? String(import.meta.env.VITE_OIDC_ORIGIN) : DEFAULT_IDP_ORIGIN),
    );
  });
});
