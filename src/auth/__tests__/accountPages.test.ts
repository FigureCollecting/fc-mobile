import { describe, expect, it } from 'vitest';
import { accountPages, configuredAccountPages, DEFAULT_IDP_ORIGIN } from '../config';

// The sign-in server's own pages for changing the account (fc-infra nodes/fc-ha-01/authentik/blueprints/fc-flows.yaml:
// slugs fc-password-change and fc-email-change; Authentik 2026.8.5 user settings, Credentials tab = the MFA devices).
describe('account pages on the sign-in server', () => {
  it('opens fc-password-change, fc-email-change and the MFA devices tab on the production host', () => {
    expect(accountPages()).toEqual({
      passwordChange: 'https://auth.mindsignals1.com/if/flow/fc-password-change/',
      emailChange: 'https://auth.mindsignals1.com/if/flow/fc-email-change/',
      mfaDevices: 'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D',
    });
    expect(accountPages(DEFAULT_IDP_ORIGIN)).toEqual(accountPages());
  });

  it('carries the MFA tab as the JSON Authentik reads after the route separator', () => {
    const hash = new URL(accountPages().mfaDevices).hash;
    const [route, params] = hash.slice(1).split(';', 2);
    expect(route).toBe('/settings');
    expect(JSON.parse(decodeURIComponent(params!))).toEqual({ page: 'page-credentials' });
  });

  it('follows the origin it is given, with or without trailing slashes', () => {
    expect(accountPages('http://127.0.0.1:8481//').passwordChange).toBe('http://127.0.0.1:8481/if/flow/fc-password-change/');
    expect(accountPages('http://127.0.0.1:8481').emailChange).toBe('http://127.0.0.1:8481/if/flow/fc-email-change/');
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
