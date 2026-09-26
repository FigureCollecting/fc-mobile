# Local full stack for fc-mobile e2e

One command brings up everything the PWA talks to, on loopback, with no cluster
and no manual steps:

```
npm --prefix e2e/stack ci        # once (needs NODE_AUTH_TOKEN for @figurecollecting packages)
npm run build                    # the production build nginx serves
npm run stack:up -- --detach     # or without --detach to run in the foreground (Ctrl-C stops it)
npm run stack:down
```

`stack:up -- --build` runs the root build first. The first `up` clones and
installs fc-coordinator, so `NODE_AUTH_TOKEN` must be set then;
`npm --prefix e2e/stack run checkout` does only that step.

The coordinator runs in its own process group, recorded in
`.state/coordinator.pid` with its kernel start time and checkout directory. If
the stack dies without its teardown (SIGKILL, OOM), the coordinator keeps
listening; the next `up` refuses its port and names the process and the checkout
to run `stack:down` in, and `stack:down` stops it. `stack:down` signals only a
group it can still prove is this checkout's coordinator, including one whose
leader died and left tsx's forked node holding the port. Ctrl-C during startup
stops the stack once it is up; a second Ctrl-C exits at once (status 130)
without teardown: `stack:down` stops the coordinator, and testcontainers' Ryuk
removes the containers once no testcontainers client remains.

Process identity reads `/proc`, so it is Linux-only. Elsewhere `up` warns that
it cannot record the coordinator, and `stack:down` cannot stop one a crashed
stack left behind.

## What runs

| Piece | Where | What it is |
|---|---|---|
| edge | `http://localhost:8480` | the fc-app tunnel rule: `^/api(/.*)?$` to the coordinator, unrewritten; everything else to nginx |
| web | container | `nginxinc/nginx-unprivileged` serving `dist/` with `nginx/default.conf` (a stand-in until WK-09 ships the fc-mobile-web image; set `FC_STACK_WEB_IMAGE` to use that image) |
| coordinator | `127.0.0.1:8482` | the real fc-coordinator via tsx, `COORDINATOR_PUBLIC_ORIGIN` = the edge origin, route prefix `/api` |
| mock issuer | `127.0.0.1:8481` | Authentik's `fc-coordinator` provider layout: auth code + PKCE (S256 only), strict redirect URIs, 1-min codes, 10-min access tokens, rotating 30-day refresh tokens; login auto-completes |
| fake SpineRead | `127.0.0.1:8483` gRPC/h2c, `:8484` Connect/h1 | read.v1 Compare, GetProducts (paged, redirect-resolving), GetProductImages (empty), over a seeded catalog of 1,200 products |
| fake OpenFGA | `127.0.0.1:8485` | gRPC Check on h2c, preshared key; user A holds `inventory_levels`, user B does not |
| Postgres | container | `postgres:17.11-trixie`, locale pinned at initdb, migrated with the coordinator's own `scripts/migrate.sh` |
| control API | `127.0.0.1:8489` | outages, edge faults, issuer state, what the fakes saw |

`FC_STACK_PORT_BASE` moves every port (edge = base, control = base + 9).

## Users

| | sub | login_hint |
|---|---|---|
| A (entitled) | `11111111-1111-4111-8111-111111111111` | `collector-a@stack.test` |
| B (not entitled) | `22222222-2222-4222-8222-222222222222` | `collector-b@stack.test` |

`/authorize` signs in the `login_hint` user, or the one set with
`POST /issuer/login-as`, default A. Registered redirect URIs are
`http://localhost:8480/callback` and `http://localhost:5173/callback`.

## Catalog

1,200 active heads (about a third with Japanese titles, a tenth statues with no
JAN), 63 merged records redirecting to 60 heads including three two-hop chains,
an original-image `image` claim on every head (host
`static.myfigurecollection.invalid`, so a hotlink is caught and never leaves the
machine), unmapped keys, and a gated `stockOnHand` on 400 heads. It is
deterministic; `.state/catalog.json` lists head ids, GTIN-14s, MFC ids, merges
and a suggested holding status per head.

## Choosing the coordinator

- default: the pinned develop sha in `src/coordinator.ts`, cloned under `node_modules/.cache/fc-mobile-stack/`
- `FC_COORDINATOR_REF=<branch|sha>` (and `FC_COORDINATOR_REPO` for a fork)
- `FC_COORDINATOR_DIR=<worktree>` to run a local branch as it is

The spine wire follows the coordinator: h2c once its spine client imports
`createGrpcTransport` (R4d), Connect over HTTP/1.1 before. `FC_STACK_SPINE_WIRE`
forces it. Every spine call records the wire and protocol it arrived on.

## Postgres locale

The default is `en_US.UTF-8` on glibc, a linguistic collation, so SQL that
orders version strings without `COLLATE "C"` misbehaves here rather than passing
by accident. `FC_STACK_PG_LOCALE=C.UTF-8` mirrors prod pg-spine. Start-up
refuses a database whose comparison does not match the requested locale; the
musl-based `postgres:*-alpine` images report `en_US.UTF-8` but compare bytewise.

## From Playwright

`globalSetup: './e2e/stack/src/playwright.ts'` reuses a stack that
`stack:up -- --detach` left running, or starts one for the run and stops it
afterwards. A recorded stack that answers but has its edge or coordinator down
is an error, not reused. Workers read everything else from the state file:

```ts
import { readStackState, stackClient } from './stack/src/client.js';

const state = readStackState()!;                           // URLs, users, DATABASE_URL, catalog file
const stack = stackClient(state.controlUrl);
await stack.edge.stop();                                   // true outage: connection refused
await stack.edge.fault({ match: '^/api/coordinator\\.v1\\.SyncService/Push$', action: 'drop-response' });
await stack.coordinator.restart();                         // new nonce epoch
await stack.issuer.configure({ accessTokenTtlSeconds: 5 });
await stack.issuer.revokeUser(state.users[0].sub);         // next refresh is invalid_grant
```

`src/device.ts` signs a Node-side device in, enrols it and makes DPoP calls, for
seeding or for a second device in a sync test.

The browser auth suite (`e2e/auth`) needs the OIDC build, whose issuer is the
mock on the default ports: `npm run build:stack && npm run test:e2e:stack`.

Edge faults: `drop-response` forwards the request and cuts the reply after the
upstream has answered; `hang` holds it until `releaseHung`; `status` answers at
the edge. Each applies once unless `times` says otherwise (`0` = until cleared).

## Tests

`npm --prefix e2e/stack test` runs the harness suite, including the acceptance
in `test/stack.vitest.ts` (Docker and a built `dist/` required). Harness tests
are `*.vitest.ts` so the root Playwright run never collects them.
