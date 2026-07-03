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

## Project conventions

- Preact with `preact/compat` aliases (do not introduce React).
- Styling: scoped `<style>` blocks + CSS custom properties from
  `src/styles/tokens.css`. No external UI frameworks.
- State: `@tanstack/react-query` for server state, `zustand` for auth,
  `@preact/signals` for lightweight global values (online status, toast).
