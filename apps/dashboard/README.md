# Framelia Dashboard

Vue dashboard for live and archived Framelia visual-verification runs.

Stack:

- Vue 3
- Vite
- Nuxt UI
- Vue Router file-based routing
- CLI-provided HTTP API, artifact files, and SSE events

Dashboard renders verification state only. Capture, comparison, gates, artifact persistence, and server remain owned by `@framelia/verify` and `framelia`.

## Routes

Routes come from files under `pages/`:

```text
pages/
├── (dashboard).vue           # shared parent: renders the dashboard once
└── (dashboard)/
    ├── index.vue             # /
    └── contracts/
        └── [...id].vue       # /contracts/:id(.*)
```

Both routes share the `(dashboard)` parent, so changing selection only changes the route
param — the run is not refetched and the live connection is not reopened. Selection comes
from the URL alone; the rail's search (`?q=`) and status filter (`?status=`) are kept in the
URL query and never change or rewrite the selected contract.

Served by `@framelia/dashboard-server`, routes are real paths (`/contracts/<id>`): the server
injects `<base href="/">` and a `framelia-dashboard-host` marker into `index.html`. A static
`framelia report` has no such marker, so it uses hash routes (`index.html#/contracts/<id>`)
and resolves `data/` against the page's own directory — the report can be served from any
sub-path.

Keyboard: Alt + ← / → steps through contracts in the order the tree shows them; ↑ / ↓ do
the same while focus is in the tree; ←/→/Home/End move between the inspector's comparison
tabs; 1–5 pick a tab directly.

Vue Router generates `typed-router.d.ts`. Do not edit generated file manually.

## Quick preview

From repository root:

```bash
pnpm dev:dashboard
```

Open URL printed by Vite. Dashboard starts with mock evidence and HMR; no contract, artifact, or backend required.

Mock source lives in `mocks/dashboard.ts`. It covers:

- Passed, failed, and blocked states.
- Figma and web baselines.
- Viewport and element captures.
- Baseline, actual, scrub, diff, and split inspector modes.
- Missing evidence state.

## Run with HMR

For real selected-run/API integration, start the dashboard backend from repository root:

```bash
pnpm build
pnpm framelia open --project-root "$PWD" --run <run-id> --no-open
```

Backend prints URL such as:

```text
Dashboard: http://127.0.0.1:43127
```

Keep backend running. Start Vite in second terminal:

```bash
FRAMELIA_API_ORIGIN=http://127.0.0.1:43127 pnpm dev:dashboard
```

Equivalent command from this directory:

```bash
FRAMELIA_API_ORIGIN=http://127.0.0.1:43127 pnpm dev
```

Open URL printed by Vite, normally `http://localhost:5173`.

Vite proxies these endpoints to `FRAMELIA_API_ORIGIN`:

- `/api`
- `/artifacts`
- `/events`

Without `FRAMELIA_API_ORIGIN`, Vite serves mock API and artifact responses.

## Run full product

Use CLI's `open` when testing the bundled production dashboard against an existing selected run:

```bash
pnpm build
pnpm framelia open --project-root "$PWD" --run <run-id>
```

Add `--no-open` to prevent browser auto-open. The process keeps the dashboard available until
`Ctrl+C`.

For live job progress during an actual run, the dashboard is driven by
`@framelia/playwright`'s Reporter instead of a CLI command — register it in a Playwright
project's `playwright.config.ts` and run `npx playwright test`:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

See [`packages/playwright/README.md`](../../packages/playwright/README.md) for the full quickstart.

## Build and validate

From repository root:

```bash
pnpm --filter @framelia/dashboard typecheck
pnpm --filter @framelia/dashboard build
```

Or run complete workspace validation:

```bash
pnpm validate
```

Production build writes into `packages/dashboard-server/dist/dashboard` (see `build.outDir`
in `vite.config.ts`); the `@framelia/dashboard-server` npm package ships that directory, and
both the CLI and the Playwright Reporter serve it from there.

## Data flow

```text
GET /api/run       -> current DashboardRun snapshot
GET /api/meta      -> live/archive mode
GET /artifacts/*   -> baseline, actual, and diff images
GET /events        -> live SSE progress events
```

Portable static reports load `data/selected-run.json` and `data/*` (relative to the report's
`index.html`) instead. The dashboard contains no database, cloud client, or
verification-engine dependency.

Artifact URLs carry the evidence digest as `?v=<hash>`, and the server answers `/artifacts/*`
with `Cache-Control: no-cache` plus an `ETag`, so a retry or re-run that rewrites a
same-named screenshot is never shown stale. Live events are coalesced into one refresh; an
event (or reconnect `sync`) for a different run reloads it. While `/events` is down the
header shows "Reconnecting…", and a failed refresh keeps the last good run on screen behind
a banner.

The backend only answers loopback `Host` names on its own port when bound to loopback (a
DNS-rebinding guard); the Vite proxy above uses `changeOrigin` for that reason.
