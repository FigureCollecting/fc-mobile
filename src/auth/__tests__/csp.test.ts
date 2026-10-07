// The shipped CSP and the build's default IdP live in two files; this ties them,
// so moving the IdP without the CSP (or the reverse) fails here, not on a phone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NGINX_CONF, parseCsp, readNginxHeaders } from '../../../deploy/securityHeaders';
import { configuredOidc, DEFAULT_IDP_ORIGIN, oidcConfig } from '../config';

describe('the shipped CSP and the default IdP', () => {
  const csp = parseCsp(readNginxHeaders(readFileSync(NGINX_CONF, 'utf8'))['Content-Security-Policy'] as string);

  it("lets the page call the default IdP's token endpoint", () => {
    // The page fetches only the token endpoint; authorize and end-session are navigations.
    expect(csp['connect-src']).toContain(new URL(oidcConfig(DEFAULT_IDP_ORIGIN).tokenEndpoint).origin);
  });

  it('is the IdP a build without VITE_OIDC_ORIGIN uses', () => {
    expect(configuredOidc({})).toEqual(oidcConfig(DEFAULT_IDP_ORIGIN));
    expect(new URL(configuredOidc({}).tokenEndpoint).origin).toBe(new URL(DEFAULT_IDP_ORIGIN).origin);
  });
});
