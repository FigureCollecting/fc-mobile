import { defineConfig } from 'vitest/config';

// Harness tests are *.vitest.ts, never *.test.ts or *.spec.ts: the root
// Playwright config collects every .test/.spec file under ./e2e, and a vitest
// file loaded by Playwright fails the whole run.
export default defineConfig({
  test: {
    include: ['test/**/*.vitest.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/gen/**', 'src/cli.ts'],
      thresholds: { lines: 85, branches: 85, perFile: true },
    },
  },
});
