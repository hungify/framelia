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
├── index.vue                 # /
└── contracts/
    └── [...id].vue           # /contracts/:id(.*)
```

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

For real artifact/API integration, start archived dashboard backend from repository root:

```bash
pnpm build
pnpm framelia open \
  --artifact /absolute/path/to/visual-verification.json \
  --no-open
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

Use CLI's `open` when testing the bundled production dashboard against an existing artifact:

```bash
pnpm build
pnpm framelia open \
  --artifact /absolute/path/to/visual-verification.json
```

Add `--no-open` to prevent browser auto-open. Process keeps dashboard available until `Ctrl+C`.

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

Production build writes into `packages/cli/dist/dashboard`. CLI npm package ships generated directory.

## Data flow

```text
GET /api/run       -> current DashboardRun snapshot
GET /api/meta      -> live/archive mode
GET /artifacts/*   -> baseline, actual, and diff images
GET /events        -> live SSE progress events
```

Portable static reports load `./data/visual-verification.json` and `./data/*` instead. Dashboard contains no database, cloud client, or verification-engine dependency.
