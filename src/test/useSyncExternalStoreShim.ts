// Test-only shim. The real `use-sync-external-store/shim` package ships a
// CJS entry that `require("react")` at runtime. That pierces through our
// vite aliases in Node ESM land and explodes. Aliasing straight to preact/compat
// keeps wouter and zustand happy in tests.
export { useSyncExternalStore } from 'preact/compat';
export { useSyncExternalStore as useSyncExternalStoreWithSelector } from 'preact/compat';
