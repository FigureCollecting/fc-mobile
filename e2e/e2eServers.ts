/**
 * Where the e2e preview servers listen (playwright.config.ts). Several seats
 * share this host: a run takes its own ports from E2E_PORT (the --mode test
 * build) and E2E_PROD_PORT (the real production build), 5173 and 4174 unless
 * set, as CI runs them, and never reuses a server it did not start. A port
 * already taken then fails the run (--strictPort) instead of quietly testing
 * whatever build another seat left serving there.
 */
export interface E2EServers {
  appPort: number;
  prodPort: number;
  appUrl: string;
  prodUrl: string;
  reuseExistingServer: false;
}

function port(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65535) {
    throw new Error(`${name}=${raw} is not a port from 1024 to 65535`);
  }
  return Number(raw);
}

export function e2eServers(env: Record<string, string | undefined> = process.env): E2EServers {
  const appPort = port(env, 'E2E_PORT', 5173);
  const prodPort = port(env, 'E2E_PROD_PORT', 4174);
  if (appPort === prodPort) throw new Error(`E2E_PORT and E2E_PROD_PORT name the same port (${appPort})`);
  return {
    appPort,
    prodPort,
    appUrl: `http://localhost:${appPort}`,
    prodUrl: `http://localhost:${prodPort}`,
    reuseExistingServer: false,
  };
}
