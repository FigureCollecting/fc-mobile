import path from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

const nm = path.resolve(__dirname, 'node_modules');

export default defineConfig({
  plugins: [
    // Disable preset's react aliases so we can set absolute-path ones below.
    // This prevents "rewrote react to preact/compat but was not an absolute path"
    // and ensures transitive deps (fc-shared -> zustand -> react) resolve correctly.
    preact({ reactAliasesEnabled: false }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: 'FigureCollecting',
        short_name: 'FC',
        description: 'Your collectibles, anywhere',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0967d2',
        background_color: '#0a0a0a',
        // Branded (graphite bg, warm-white mark), maskable-safe — one file
        // per size covers both the "any" and "maskable" display contexts.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
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
});
