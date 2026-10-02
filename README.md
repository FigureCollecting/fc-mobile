# fc-mobile

Preact + Vite PWA for the Figure Collector platform.

## Development

```bash
npm install
npm run dev
```

The dev server expects a backend on the URL set by `VITE_API_URL`.
`.env.development` defaults to `http://localhost:5080/api`.

Every page the dev server serves gets the preview CSP plus inline styles
(`devServerHeaders` in `deploy/securityHeaders.ts`). The CSP refuses images,
scripts, fetches and WebSockets from any host but the page's own origin, the
mode's `VITE_API_URL` and `VITE_IMAGE_MANAGER_URL` and the production hosts,
so never from a hands-off host (sites that bar AI agents by name,
`e2e/handsOff.ts`). A CSP does not stop a navigation: a link, a `location`
change, `window.open` or a meta refresh still leaves.

The e2e suites guard the rest:
- Every context from `e2e/fixtures.ts` aborts its pages' and service workers'
  requests to those hosts, navigations included, closes its pages' WebSockets
  to them, and refuses its API requests to them (`request`, `context.request`,
  `page.request`). A test fails if one of its requests got past that guard
  (a redirect hop, which routes never see).
- Every Chromium the suites launch resolves those hosts, with or without
  trailing dots, to nothing; that also stops redirect hops and workers'
  WebSockets.
- Each worker's Node DNS lookups (Node's `fetch`, Playwright's API requests)
  find no address for them.
- `e2e/handsOffScan.ts` fails the unit tests on a spec that takes `test` or a
  browser from Playwright directly, launches Chromium without the resolver
  rules, or opens a context no guard covers.

A spike page is therefore an HTML file in this repo, opened from a spec on
`e2e/fixtures.ts`. In any other browser `npm run dev` gives it the CSP only;
opened from disk or another server it has no guard at all. WebKit gets the
route guard but no resolver rules (that switch is Chromium's); it is not in CI.

## Build

```bash
npm run build
```

Produces a production bundle in `dist/`. `.env.production` supplies the
production API URL.

## Web image (fc-mobile-web)

`Dockerfile` builds the production bundle and serves it from
`nginxinc/nginx-unprivileged` (uid 101, port 8080, read-only root with a
writable `/tmp`). `deploy/nginx/default.conf` is the one source of the
response headers: CSP without `unsafe-inline`/`unsafe-eval`, HSTS, nosniff,
Referrer-Policy; `index.html`, `sw.js` and the manifest `no-cache`,
`/assets/*` immutable; `/api` always 404; the SPA fallback for navigations only.

```bash
docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t fc-mobile-web .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 fc-mobile-web
```

`vite preview` sends the same headers, so the e2e suite runs under the CSP and
fails on any `securitypolicyviolation`. Component CSS therefore goes through
`<Style css={...} />` (constructed stylesheets), never a `<style>` element or
a style attribute; `src/__tests__/cspSource.test.ts` guards this.

PWA acceptance against the image, behind the local stack (`e2e/stack`):

```bash
docker build ... --build-arg VITE_BUILD_ID=n  -t fc-mobile-web:n .
docker build ... --build-arg VITE_BUILD_ID=n1 -t fc-mobile-web:n1 .
FC_WEB_IMAGE=fc-mobile-web:n FC_WEB_IMAGE_NEXT=fc-mobile-web:n1 FC_STACK_WEB_IMAGE=fc-mobile-web:n \
  npx playwright test -c playwright.pwa.config.ts
```

`npm run dev` proxies `/api` to a coordinator on `http://127.0.0.1:5052`
(`FC_COORDINATOR_URL` overrides) with the path and Host unchanged; start it with
`COORDINATOR_PUBLIC_ORIGIN=http://localhost:5173 COORDINATOR_ROUTE_PREFIX=/api`.

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
npm run test:e2e:shots             # sign-off PNGs (below)
```

Sign-off shots: `e2e/signoff.shots.spec.ts` runs once per `SHOT_VIEWPORTS`
project (`e2e/caseViewports.ts`: the Fold8's full cover 444x701, open 870x657
and turned 657x870 panels at DPR 2.8125, and desktop 1536x730) and saves full
frames to `test-results/signoff/<project>/<name>.png` with `signoffShot`
(`e2e/signoffShots.ts`), checking each PNG's size against the panel's pixels.

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
`security-scan.yml`, `codeql.yml`, `stack.yml`, `web-image.yml`).

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
- **Only `web-image.yml` publishes**, and only on org pushes to `develop`/`main`:
  `ghcr.io/figurecollecting/fc-mobile-web:sha-<short>`. Nothing is published from forks.

## Project conventions

- Preact with `preact/compat` aliases (do not introduce React).
- Styling: per-component `<Style css={...} />` blocks (not `<style>`; see
  above) + CSS custom properties from `src/styles/tokens.css`. No external UI
  frameworks.
- State: `@tanstack/react-query` for server state, `zustand` for auth,
  `@preact/signals` for lightweight global values (online status, toast).
