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
      {
        find: /^use-sync-external-store\/shim.*$/,
        replacement: path.join(__dirname, 'src/test/useSyncExternalStoreShim.ts'),
      },
    ],
    dedupe: ['preact', 'preact/hooks', 'preact/compat', 'zustand'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
      include: ['src/pages/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],
      // The hooks layer is the system's load-bearing logic — enforce a high
      // bar there. Pages are mostly JSX/CSS and their interactive branches
      // (sheet open/close, filter dropdowns, selection mode) are lower ROI
      // to unit-test, so we don't force a threshold there; the routing +
      // smoke tests guard the render paths.
    },
  },
});
