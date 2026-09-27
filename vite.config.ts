import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { NGINX_CONF, previewHeaders } from './deploy/securityHeaders.ts';
import { WEB_MANIFEST } from './deploy/webManifest.ts';

const nm = path.resolve(import.meta.dirname, 'node_modules');

const NO_FIXTURE_ART = '\0fc-no-fixture-art';

/**
 * Dev fixture art (the git-ignored real cut-outs and the committed
 * synthetic stand-ins that src/dev-fixtures/fixtures.ts globs) belongs only
 * in builds where fixture mode can be switched on. Any other build resolves
 * it to nothing: unused imported assets are still emitted, and the service
 * worker would precache them.
 */
function fixtureArtOnlyWhereFixturesRun(mode: string): Plugin {
  const allowed = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_ALLOW_FIXTURE_OVERRIDE === 'true';
  return {
    name: 'fc-fixture-art-only-where-fixtures-run',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      const fromFixtures = importer?.replaceAll('\\', '/').endsWith('/src/dev-fixtures/fixtures.ts');
      return !allowed && fromFixtures && /\.png(\?|$)/.test(source) ? NO_FIXTURE_ART : null;
    },
    load(id) {
      return id === NO_FIXTURE_ART ? 'export default undefined;' : null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `npm run dev` against a local coordinator started with
  // COORDINATOR_PUBLIC_ORIGIN=http://localhost:5173 and COORDINATOR_ROUTE_PREFIX=/api:
  // the path and Host pass through unchanged, so every DPoP htu matches.
  server: {
    proxy: {
      '/api': { target: process.env.FC_COORDINATOR_URL ?? 'http://127.0.0.1:5052', changeOrigin: false },
    },
  },
  // `vite preview` serves the e2e suite under the headers nginx ships.
  preview: {
    headers: previewHeaders(readFileSync(NGINX_CONF, 'utf8'), loadEnv(mode, import.meta.dirname, 'VITE_')),
  },
  plugins: [
    // Disable preset's react aliases so we can set absolute-path ones below.
    // This prevents "rewrote react to preact/compat but was not an absolute path"
    // and ensures transitive deps (fc-shared -> zustand -> react) resolve correctly.
    preact({ reactAliasesEnabled: false }),
    fixtureArtOnlyWhereFixturesRun(mode),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The user takes a new build from the prompt (src/pwa/updates.ts registers).
      registerType: 'prompt',
      injectRegister: false,
      // Behind Cloudflare Access the manifest fetch needs the session cookie.
      useCredentials: true,
      manifest: WEB_MANIFEST,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    // Absolute-path aliases so transitive deps (e.g. fc-shared's zustand)
    // resolve react -> preact/compat correctly even outside this tree.
    alias: {
      'react-dom/test-utils': path.join(nm, 'preact/test-utils'),
      'react-dom': path.join(nm, 'preact/compat'),
      'react/jsx-runtime': path.join(nm, 'preact/jsx-runtime'),
      'react': path.join(nm, 'preact/compat'),
    },
    // Force shared deps to resolve from fc-mobile's node_modules (single copy)
    dedupe: ['preact', 'zustand'],
  },
}));
