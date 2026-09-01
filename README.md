# fc-mobile

Preact + Vite PWA for the Figure Collector platform.

## Development

```bash
npm install
npm run dev
```

The dev server expects a backend on the URL set by `VITE_API_URL`.
`.env.development` defaults to `http://localhost:5080/api`.

## Build

```bash
npm run build
```

Produces a production bundle in `dist/`. `.env.production` supplies the
production API URL.

## API URL configuration

`src/api/client.ts` resolves its base URL with the following precedence:

1. `localStorage.getItem('fc.apiUrl')` — runtime override, handy for beta
   testers who want to point a deployed build at staging without rebuilding.
2. `import.meta.env.VITE_API_URL` — build-time default from
   `.env.development` / `.env.production`.
3. `https://figurecollecting.com/api` — hard-coded production fallback.

## Running tests

```bash
npm test              # run the suite once (used in CI)
npm run test:watch    # watch mode for local development
npm run test:coverage # produces coverage/ with an HTML report
```

Tests use Vitest with a `jsdom` environment and
`@testing-library/preact`. Component tests live in
`src/<area>/__tests__/`; the routing reachability test lives in
`src/__tests__/routing.test.tsx`.

End-to-end smoke (Playwright):

```bash
npx playwright install chromium    # one-time
npm run test:e2e                   # boots the Vite dev server and runs e2e/
```

Mocks:
- `src/test/framerMotionMock.tsx` — drop-in for framer-motion so jsdom
  doesn't have to handle pointer / animation APIs.
- `src/test/useSyncExternalStoreShim.ts` — routes wouter / zustand's
  `use-sync-external-store` import at preact/compat so hook state stays in a
  single preact instance.
- `src/test/setup.ts` — resets the DOM, zustand stores, localStorage, and
  fake-indexeddb between tests.

## CI on forks (shift-left)

Development happens on personal forks; pull requests go to `FigureCollecting/*`.
CI on a fork follows one rule. The push gate (its four cases are documented in
a comment block) sits at the top of every workflow here (`build.yml`,
`security-scan.yml`, `codeql.yml`); this repo publishes nothing from CI.

- **Feature branches on your fork run the core CI on every push**: build + lint,
  dependency and npm-audit scans, and CodeQL, so problems surface before the PR
  is opened.
- **Set a fork secret `NODE_AUTH_TOKEN`** (repo Settings > Secrets and variables >
  Actions) to a classic GitHub PAT with **only** the `read:packages` scope, so
  `npm ci` can read the private `@figurecollecting/*` packages. Without it the
  install falls back to the fork's `GITHUB_TOKEN` and fails with `npm error 403`.
  Upstream needs no such secret. The secret reaches your own pushes and PRs from
  branches of your fork, never a PR opened from someone else's fork.
- **`develop` and `main` on your fork are mirrors of upstream: pushes to them
  run no jobs.** The workflows still trigger, so each sync leaves grey
  `skipped` runs in the Actions tab; that is the gate working, not a failure.
  Manual `workflow_dispatch` runs of `security-scan.yml` are not gated and still
  run there, and so do scheduled runs if you enable schedules on the fork.
  The gate compares branch names case-insensitively, so do not name a feature
  branch `Develop` or `MAIN`.
- **Nothing is published from this repo's CI**, on the org or on forks.

## Project conventions

- Preact with `preact/compat` aliases (do not introduce React).
- Styling: scoped `<style>` blocks + CSS custom properties from
  `src/styles/tokens.css`. No external UI frameworks.
- State: `@tanstack/react-query` for server state, `zustand` for auth,
  `@preact/signals` for lightweight global values (online status, toast).
