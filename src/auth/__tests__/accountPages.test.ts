import { describe, expect, it } from 'vitest';
import { accountPages, configuredAccountPages, DEFAULT_IDP_ORIGIN } from '../config';

// The sign-in server's own pages for changing the account, both in Authentik 2026.8.5's user settings
// (/if/user/#/settings, web/src/user/Routes.ts:25-28): the User details tab holds the password card
// (UserSettingsPage.ts:137-157, slot page-details), the Credentials tab the MFA devices (:186-212, slot page-credentials).
// That page sends a signed-out visitor to sign in and back (web/src/common/users.ts:139-158, :186-187).
const USER_DETAILS = 'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-details%22%7D';
const CREDENTIALS = 'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D';

const tabOf = (href: string) => {
  const [route, params, ...rest] = new URL(href).hash.slice(1).split(';');
  return { route, page: JSON.parse(decodeURIComponent(params!)) as unknown, rest };
};

describe('account pages on the sign-in server', () => {
  it('opens the user settings on the production host: User details for the password, Credentials for two-factor', () => {
    expect(accountPages()).toEqual({ passwordChange: USER_DETAILS, mfaDevices: CREDENTIALS });
    expect(accountPages(DEFAULT_IDP_ORIGIN)).toEqual(accountPages());
  });

  it('carries each tab as the JSON Authentik reads after the route separator, and nothing else', () => {
    expect(tabOf(accountPages().passwordChange)).toEqual({ route: '/settings', page: { page: 'page-details' }, rest: [] });
    expect(tabOf(accountPages().mfaDevices)).toEqual({ route: '/settings', page: { page: 'page-credentials' }, rest: [] });
  });

  it('sends no next= and no flow link: Authentik brings a signed-out visitor back to the page itself', () => {
    for (const href of Object.values(accountPages())) {
      const url = new URL(href);
      expect(url.pathname).toBe('/if/user/');
      expect(url.search).toBe('');
      expect(href).not.toMatch(/next=|\/if\/flow\//);
    }
  });

  it('offers no email change until the sign-in server has one on its settings page', () => {
    expect(Object.keys(accountPages()).sort()).toEqual(['mfaDevices', 'passwordChange']);
  });

  it('follows the origin it is given, with or without trailing slashes', () => {
    expect(accountPages('http://127.0.0.1:8481//').passwordChange).toBe(
      'http://127.0.0.1:8481/if/user/#/settings;%7B%22page%22%3A%22page-details%22%7D',
    );
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
