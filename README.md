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
change, `window.open` or a meta refresh still leaves. The CSP, like the e2e
route guard below, refuses a request before it is sent, but not the
connection: for an https frame or form post the CSP refuses, or a popup the
guard aborts, full Chromium (your own Chrome's engine) still connects to the
hands-off host and sends it a TLS ClientHello that names it. The resolver
rules below stop that (`e2e/hands-off.spec.ts` tests both). Every Chromium in
the three Playwright configs has them; your own Chrome on `npm run dev` does
not, so open a spike page only in a Chromium launched with
`HANDS_OFF_LAUNCH_ARGS` (a spec on `e2e/fixtures.ts`), never in your own
browser.

The e2e suites guard the rest:
- Every context from `e2e/fixtures.ts` aborts its pages' and service workers'
  requests to those hosts, navigations included, closes its pages' WebSockets
  to them, and refuses its API requests to them (`request`, `context.request`,
  `page.request`, a relative URL read against the test's `baseURL`). A test
  fails if one of its requests got past that guard (a redirect hop, which
  routes never see).
- A route a spec adds runs before the guard's. One that continues a request,
  or fetches it with `route.fetch()` (which no API guard sees), goes round
  the abort and leaves only the layers below and the failing test, so the
  scan refuses such routes. `unroute` or `unrouteAll` on a context would take
  the guard's routes off, so the scan refuses them on anything but `page`.
- Every Chromium project in the three Playwright configs gets
  `HANDS_OFF_LAUNCH_ARGS`, and every Chromium launch in a worker is refused
  unless its args keep them (below): resolver rules that give those hosts,
  with or without trailing dots, no address, which also stops redirect hops
  and workers' WebSockets. `HANDS_OFF_LAUNCH_ARGS` and the domain list are
  frozen: a spec that pushes onto either, or sets an element, throws before
  any browser launches with the change. The configs pass the args in
  `HANDS_OFF_LAUNCH_OPTIONS`, frozen too, so a spec that imports a config and
  sets the args or adds a proxy there throws as well. A test reads each config
  as Playwright merges it (a project's `use` over the config's), compares its
  args with the rules built afresh (not with the export), and fails on a
  Chromium project whose args leave the rules out, add another rule list, a
  proxy switch or `--`, or are not frozen (a copy is an array a spec could
  push onto through its `launchOptions` fixture before the worker's browser
  launches) or sit in launch options that are not frozen, and on a `proxy` (in
  `use` or in `contextOptions`), `connectOptions`, or launch options with
  anything but `args`: a launch `proxy` or `env`, `ignoreDefaultArgs`
  (Playwright counts the args it is given among its defaults, so a list there
  can take the rules off Chromium's command line), or any option the test does
  not read.
- Each worker refuses to start with a proxy in its environment (`http_proxy`
  and the like: Chromium sends hosts to it unresolved, and the headless shell
  does so even with `--no-proxy-server`), a variable that sends a launch to a
  browser elsewhere (`SELENIUM_REMOTE_URL`, `SELENIUM_REMOTE_CAPABILITIES`,
  `SELENIUM_REMOTE_HEADERS`, `PW_TEST_CONNECT_WS_ENDPOINT`,
  `PW_TEST_CONNECT_HEADERS`, `PW_TEST_CONNECT_EXPOSE_NETWORK`, or
  `PWTEST_UNDER_TEST`, which lets a launch option name a Selenium grid), or a
  browser to connect to (`connectOptions`), or with a name on
  `Object.prototype` that Node does not put there. From then on
  `Object.prototype` takes no new name (`Object.preventExtensions`): every
  options object inherits it, and Playwright reads launch and context
  options such as `ignoreDefaultArgs` or `proxy` from it a few ticks after
  each call, so a name written even right after a call is never written.
  `blockHandsOff`, so every fixture context, checks it too.
- Each `launch`, `launchPersistentContext` or `launchServer` on the worker's
  `playwright` object (its own browser's and a spec's, called on a browser
  type or taken from the prototype they share), and `launchServer` on each
  browser type's own launcher (`_serverLauncher`), is checked as it is
  called: the environment; `Object.prototype`; and the options it starts
  from, the worker's defaults (read as the launch will read them) and its
  own, which must not hold `ignoreDefaultArgs`, `executablePath`, `proxy` or
  `env` (set to anything but undefined), a Playwright test hook, or any
  option under a getter or setter, or be a Proxy. A Chromium launch's args,
  its own over the worker's as Playwright merges them, must be one
  `--host-resolver-rules` switch whose list starts with the hands-off rules,
  or sends every host to 127.0.0.1 first (the hands-off spec's sentinels),
  and goes on only with `MAP` rules or an `EXCLUDE` of one named host that
  is not hands-off; any other arg is refused (a proxy switch, a debugging
  port). These hold however the options were built (`JSON.parse` given to
  `test.use`, say). The launch starts with a copy of the environment it was
  checked against and a frozen copy of the args, so a variable written after
  the call never reaches the browser; as it resolves, the environment and
  `Object.prototype` are checked again, and on a refusal what it launched is
  closed. A launched browser, and every browser of its class after it,
  refuses `newBrowserCDPSession`: a session on the whole browser can make a
  context with a proxy of its own. `connect`, `connectOverCDP`, `_connect`
  and `_connectToWorker` on the browser types, `_electron.launch`, and
  `_android`'s `connect`, `devices` and `launchServer` (its own launcher's
  too) are refused outright.
- Each worker's Node DNS lookups (Node's `fetch`, Playwright's API requests,
  `route.fetch()`) find no address for them.
- `e2e/handsOffScan.ts` reads every e2e source's syntax tree and fails the
  unit tests on: `test`, a browser type or `request` taken from Playwright
  directly (an import, a require, any call given its module name, a path into
  `node_modules`); a launch whose `args` are not `HANDS_OFF_LAUNCH_ARGS`, or a
  spread of it among string literals none of which is another rule list, a
  proxy switch or `--`; launch options (a launch's or `launchOptions`) that
  are not an object literal, or that hold a spread or a computed name anywhere,
  before the `args` too, since it cannot read what those carry; `launchOptions`
  that replace the args, or an `env` in launch options; `ignoreDefaultArgs` as
  a key or a member, and `executablePath` as a key; another browser
  (`browserName`, `defaultBrowserType`, a non-Chromium `devices[...]`, a
  `firefox` or `webkit` launch), a `proxy` or `connectOptions`;
  `launchServer`, `connect`, `connectOverCDP`, `_android`, `_electron`, or a
  launcher passed around uncalled; `_defaultLaunchOptions` or `_browserOptions`
  (Playwright's private holds on the options every launch in a worker starts
  from) written anywhere, as a name or a string; a private (underscore-named)
  fixture, or one under a computed name it cannot read, in the object literal
  written as `test.extend`'s or `test.use`'s first argument (read through
  `as`, `satisfies`, `!`, a type assertion and parentheses); a member of a
  Playwright object, or a destructured one, taken by a computed name; a
  context, page or API context that a guard does not take before its first
  use, on every path; a route that continues, fetches, or has a handler it
  cannot read; `unroute` or `unrouteAll` on anything but `page`. A key is one
  in an object literal or a class's member of that name. It reads syntax only,
  so it does not follow values through variables: context options, fixtures
  or a device held in a `const` (`test.use(fixtures)`), a name built at run
  time (a module, a member, a private hold), or code that reaches the options
  without naming them (such as a walk over the `playwright` object's values).

None of these covers: a connect variable (`SELENIUM_REMOTE_URL` and the rest
above) written after a launch is called and removed before it resolves,
which Playwright reads in between (a proxy variable cannot get in that way:
the browser starts with the environment checked at the call); a launch or
connection made through Playwright's other private members, such as a
browser type's `_channel` or `_connection`, which go round every check at
run time; `browser.bind`, which Playwright's dashboard calls
(`PLAYWRIGHT_DASHBOARD`) so that other clients can drive the browser; a
proxy given to a context in a form the scan cannot read (a variable given to
`test.use`, `newContext` options built at run time), since the run-time
checks read no context options; and Node code a spec runs itself (a socket,
a child process).

A spike page is therefore an HTML file in this repo, opened from a spec on
`e2e/fixtures.ts`. In any other browser `npm run dev` gives it the CSP only;
opened from disk or another server it has no guard at all. A browser other
than Chromium gets the route guard and the worker's DNS but no resolver rules
(that switch is Chromium's), and the hands-off spec's browser checks skip on
it: the `webkit` project, which a local `npm run test:e2e` runs (CI does not),
and any run given `--browser firefox` or `--browser webkit`.

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
