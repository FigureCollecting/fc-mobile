import { describe, expect, it } from 'vitest';
import { e2eServers } from './e2eServers';

describe('e2eServers: the ports the e2e preview servers listen on (playwright.config.ts)', () => {
  it('defaults to the ports CI uses, and never reuses a server it did not start', () => {
    expect(e2eServers({})).toEqual({
      appPort: 5173,
      prodPort: 4174,
      appUrl: 'http://localhost:5173',
      prodUrl: 'http://localhost:4174',
      reuseExistingServer: false,
    });
  });

  it('takes a seat its own ports from E2E_PORT and E2E_PROD_PORT, so two seats on one host never test each other', () => {
    const s = e2eServers({ E2E_PORT: '5673', E2E_PROD_PORT: '4674' });
    expect([s.appPort, s.prodPort, s.appUrl, s.prodUrl]).toEqual([5673, 4674, 'http://localhost:5673', 'http://localhost:4674']);
    expect(s.reuseExistingServer).toBe(false);
  });

  it('an empty variable is unset', () => {
    expect(e2eServers({ E2E_PORT: '', E2E_PROD_PORT: ' ' })).toMatchObject({ appPort: 5173, prodPort: 4174 });
  });

  it.each(['0', '1023', '65536', '5173.5', 'abc', '-1', '5e3'])('refuses %s as a port rather than falling back quietly', (bad) => {
    expect(() => e2eServers({ E2E_PORT: bad })).toThrow(/E2E_PORT/);
    expect(() => e2eServers({ E2E_PROD_PORT: bad })).toThrow(/E2E_PROD_PORT/);
  });

  it('accepts the ends of the range', () => {
    expect(e2eServers({ E2E_PORT: '1024', E2E_PROD_PORT: '65535' })).toMatchObject({ appPort: 1024, prodPort: 65535 });
  });

  it('refuses one port for both servers', () => {
    expect(() => e2eServers({ E2E_PORT: '4174' })).toThrow(/same port/);
  });
});
