import path from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

const nm = path.resolve(__dirname, 'node_modules');

export default defineConfig({
  plugins: [preact({ reactAliasesEnabled: false })],
  resolve: {
    alias: [
      { find: 'react-dom/test-utils', replacement: path.join(nm, 'preact/test-utils/dist/testUtils.mjs') },
      { find: 'react-dom', replacement: path.join(nm, 'preact/compat/dist/compat.mjs') },
      { find: 'react/jsx-runtime', replacement: path.join(nm, 'preact/jsx-runtime/dist/jsxRuntime.mjs') },
      { find: /^react$/, replacement: path.join(nm, 'preact/compat/dist/compat.mjs') },
      // wouter / zustand pull in use-sync-external-store's CJS shim which
      // `require("react")` at runtime — bypass it and read the hook straight
      // from preact/compat instead.
      { find: 'virtual:pwa-register', replacement: path.join(__dirname, 'src/test/pwaRegisterStub.ts') },
      {
        find: /^use-sync-external-store\/shim.*$/,
        replacement: path.join(__dirname, 'src/test/useSyncExternalStoreShim.ts'),
      },
    ],
    dedupe: ['preact', 'preact/hooks', 'preact/compat', 'zustand'],
  },
  test: {
    environment: 'jsdom',
    // Node's built-in Web Storage globals shadow jsdom's; jsdom only installs
    // globals not already defined, so disable Node's.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'deploy/**/*.test.ts', 'e2e/*.vitest.ts'],
    exclude: ['node_modules', 'dist'],
    // Force Vitest to run zustand, framer-motion, fc-shared, and wouter through
    // the Vite transform pipeline so our "react -> preact/compat" aliases apply
    // transitively. Otherwise Node ESM bypasses the aliases and explodes on
    // `import React from "react"`.
    // Force Vitest to run third-party ESM through the Vite transform pipeline
    // so our "react -> preact/compat" aliases apply transitively. Without
    // inlining, Node-style imports bypass the aliases and either can't find
    // `react` at all, or resolve a second preact copy and the hooks explode
    // with "Cannot read properties of undefined (reading '__H')".
    server: {
      deps: {
        inline: [
          /zustand/,
          /wouter/,
          /framer-motion/,
          /@tanstack\/react-query/,
          /@figurecollecting\/fc-shared/,
          /preact/,
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'deploy/**/*.ts', 'e2e/handsOff.ts'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/test/**',
      ],
      // Per-glob thresholds only, not a global floor. The local store and sync
      // layer are held to 90%. src/auth/** is a no-op until the unit that adds it.
      thresholds: {
        'src/storage/**': { lines: 90, branches: 90 },
        'src/sync/**': { lines: 90, branches: 90 },
        'src/auth/**': { lines: 85, branches: 85 },
      },
    },
  },
});
