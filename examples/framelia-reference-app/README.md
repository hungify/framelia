# Framelia reference app

Standalone TanStack Start consumer app showing Framelia around a real Better Auth flow: login/signup (email/password + GitHub/Google OAuth), protected dashboard, profile settings, logout, deterministic auth fixtures, contract-driven Figma checks through `defineFigmaTests`, and the web-to-web matchers.

This example is a member of the root pnpm workspace (`framelia`/`@framelia/playwright`/`@framelia/dashboard-server` resolve via `workspace:*`, not `link:`) -- required so its own Playwright test process and `packages/playwright`'s matchers share exactly one `@playwright/test` install; a `link:` reference resolved from outside the workspace pulls in a second, physically distinct copy, which Playwright refuses to load ("Requiring @playwright/test second time"). It otherwise keeps the generated Mugnavo architecture: TanStack Start, shadcn/ui, Better Auth, Drizzle/PostgreSQL, Vite+, Nitro, and Playwright. The root `pnpm-workspace.yaml` scopes this app's `vite` → `vite-plus` alias override to `"framelia-reference-app>vite"` so it doesn't also hijack `apps/dashboard`'s own real `vite` dependency.

## Requirements

- Node.js >= 24
- pnpm >= 11
- Docker, for local PostgreSQL
- Chromium, via `pnpm exec playwright install chromium`

## Local setup

```bash
cd examples/framelia-reference-app
cp .env.example .env
cp .env.e2e.example .env.e2e
pnpm install
pnpm framelia:build   # the workspace packages export built dist output
# Set BETTER_AUTH_SECRET in .env; `pnpm auth:secret` can generate one.
docker compose up -d
pnpm db:setup
pnpm dev
```

Open `http://localhost:8888/login` and create an account through the real signup flow. Runtime app uses `.env`. Playwright loads `.env.e2e` for test-only values, then exercises the same app server and `framelia_reference_app` database from `.env`.

Playwright auth setup logs into the demo account through the real login UI, falling back to signup only to bootstrap a fresh database. Deterministic test credentials come from `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` in `.env.e2e` (see `.env.e2e.example`):

```text
Email: demo@framelia.local
Password: framelia-demo-password
```

Auth uses Better Auth with Drizzle/PostgreSQL (`src/lib/auth/auth.ts`, schema in `src/lib/db/schema/auth.schema.ts`). Protected routes live under `src/routes/_auth`; unauthenticated access redirects to `/login`. Successful email login/signup, or OAuth callback, redirects to `/app`. `BETTER_AUTH_SECRET`, `VITE_BASE_URL`, `DATABASE_URL`, and OAuth client secrets stay server-side.

### OAuth (GitHub/Google)

Optional. Set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and/or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`. In each provider's OAuth app settings, set the callback/redirect URI to `http://localhost:8888/api/auth/callback/<provider>` (e.g. `http://localhost:8888/api/auth/callback/github`). Without credentials, email/password sign-in still works; the corresponding social button will error until configured.

## Tests

Playwright config creates `playwright/.auth/user.json` through a real signup/login flow. Auth state is ignored by Git. `.env.e2e` contains `PORT` and `E2E_*` credentials; app secrets and database URL remain in `.env`. `FIGMA_ACCESS_TOKEN` is only needed once, locally, to pin or refresh a Figma baseline (see "Figma-to-web" below) -- never at test-run time. Projects are separate:

> **Fresh checkout:** `e2e/specs/figma.spec.ts` belongs to the `unauthenticated` project, so
> `pnpm test`, `pnpm test:unauth` and `pnpm test:e2e` include it. Pinned baselines live under
> the gitignored `.framelia/baselines/`, so until you pin them once (see "Pin the baseline
> once" below) those two Figma tests fail with `PINNED_BASELINE_MISSING`. That is intentional:
> a missing baseline fails loudly instead of being skipped. `pnpm test:web` and `pnpm test:auth`
> do not depend on it. Playwright runs headed (`headless: false`), so a display-less CI runner
> needs a virtual display.

```bash
pnpm test:unauth
pnpm test:auth
pnpm test:e2e
pnpm test:web
pnpm test
```

`e2e/specs/public.spec.ts` checks login/signup availability and protected-route redirects. `e2e/specs/authenticated.spec.ts` uses `storageState` for dashboard/settings/logout checks. Page objects live under `e2e/pages`; fixtures own their construction under `e2e/fixtures`. Stable `data-testid` hooks target login, dashboard, and settings proof surfaces.

## Framelia matchers

`playwright.config.ts` registers `@framelia/playwright/reporter`. It starts the dashboard integration and writes durable Figma evidence under `.framelia/runs/` whenever `defineFigmaTests` runs. `e2e/fixtures/auth.setup.ts` logs into the demo account through the real login UI, falling back to signup only to bootstrap a fresh database -- no fake seed path exists.

| API / matcher      | Spec                                | Needs `FIGMA_ACCESS_TOKEN`?    | Persists durable evidence?                                                             |
| ------------------ | ----------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| `defineFigmaTests` | `e2e/specs/figma.spec.ts`           | No -- only to pin/refresh once | Yes -- under `.framelia/runs/`, the only one `framelia dashboard`/`open`/`report` read |
| `toMatchPage`      | `e2e/specs/web-to-web-page.spec.ts` | No                             | No (Playwright attachments only)                                                       |
| `toMatchUrl`       | `e2e/specs/web-to-web-url.spec.ts`  | No                             | No (Playwright attachments only)                                                       |

## Figma-to-web: one contract-driven flow

`.framelia/contracts/login.desktop/visual-contract.json` and
`.framelia/contracts/login.mobile/visual-contract.json` are the authored contracts for
the login page: one file per contract id (the current one-contract-per-file
convention), each holding its target route, Figma baseline, viewport, render scale,
scope, and comparison thresholds. Edit these files -- or re-author with
`framelia contract create`/`refresh-baseline` -- when the design changes; no package
script or test duplicates their Figma IDs. `framelia.config.ts`'s `contracts` glob
(`.framelia/contracts/**/visual-contract.json`) is how every `framelia` command
(`contract list`, `check`, `done-gate`) discovers them; `figma.spec.ts` lists the same two files explicitly.

`e2e/specs/figma.spec.ts` calls `defineFigmaTests` once, passing both contract files.
It registers one Playwright test per contract, fanned across every configured project;
each test reconciles the contract's own viewport/deviceScaleFactor against the page,
runs `prepare()` (navigates to the contract's target), then captures, compares, and
attaches evidence -- all against an **already-pinned, offline baseline snapshot**. No
Figma network access or credentials are reachable anywhere in that path -- see
`@framelia/playwright`'s own `defineFigmaTests` doc comment. There is no separate
capture/compare CLI step, synthetic artifact fixture, or command-by-command CLI suite
in this example.

### Consumer workflow

> **Release status:** the packages currently on npm (`0.0.5`) predate `defineFigmaTests`,
> `framelia check`, `contract list` and `contract refresh-baseline`. These steps work once a
> release that includes the pending changesets in `.changeset/` is published. Until then,
> run them through the workspace (see "Workspace development") with `pnpm framelia` in place
> of `npx framelia`.

This is the path an application follows after installing the published packages. The
same two identities, `login.desktop` and `login.mobile`, are used in every step -- from
authoring to the full CI selection -- and viewport, scale, and expected Figma values
are read from each contract, never repeated in a spec option or CLI flag.

```bash
# 1. Install (published release; npm, pnpm, or yarn all work)
npm install --save-dev framelia @framelia/playwright @playwright/test

# 2. Preview, then apply, project integration (never rewrites existing config)
npx framelia init --dry-run
npx framelia init

# 3. Author + pin a contract once (needs FIGMA_ACCESS_TOKEN; see "Pin the baseline once")
npx framelia contract create ...

# 4. Register it: call defineFigmaTests with the contract file (e2e/specs/figma.spec.ts)

# 5. Check which contracts are authored, bound to a spec, or unbound (no visual run)
npx framelia contract list

# 6. Run exactly the contracts you are working on
npx framelia check --contract login.desktop --contract login.mobile

# 7. Inspect the run that check reported, using its runId
npx framelia dashboard --run <run-id>

# 8. Fix the UI (never loosen a threshold), then run step 6 again

# 9. Run the full required matrix (the authoritative CI verdict is the signed done-gate)
npx framelia check --all
```

Three different states are easy to confuse; this example keeps them separate:

| State                 | Meaning                                                                   | Where to see it                             |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Authored / unbound    | A contract file exists and pins a baseline, but no spec executes it yet.  | `framelia contract list` (`unbound`)        |
| Comparison result     | One selected run compared the real page against the pinned baseline.      | `framelia check` JSON output, run dashboard |
| Authoritative CI gate | The full required matrix passed, attested by a protected signed envelope. | `framelia done-gate` (see the CLI README)   |

An authored contract is a specification, not a passing result, and a subset run
(`--contract ...`) never stands in for the full `--all` matrix.

### Pin the baseline once (needs `FIGMA_ACCESS_TOKEN`)

Pinning is the one step that talks to Figma, and it is decoupled from running the
tests: it writes into `.framelia/baselines/<digest>/`, which is gitignored and
regenerated per checkout, never committed. Set `FIGMA_ACCESS_TOKEN` in `.env.e2e` (a
token with access to `q2MZbYDBibNKYDm7ESfvKF`).

**First time on a fresh checkout**, `.framelia/baselines/` doesn't exist yet, and
`contract refresh-baseline` can't bootstrap one from scratch -- it only re-fetches
against whichever Figma node the _last locally pinned_ snapshot already points to (see
`contract-refresh-baseline.ts`'s own `readPinnedBaseline` call), which is exactly the
thing missing on a fresh clone. Use `contract create --force` instead, passing the same
file key and node ids these two contracts were originally authored against (also
recorded in `scripts/consumer-smoke/visual-contract.json`'s legacy-format fixture):

```bash
FIGMA_ACCESS_TOKEN=... pnpm framelia contract create \
  --contract-id login.desktop --force --name Desktop --target-path /login \
  --file-key q2MZbYDBibNKYDm7ESfvKF --node-id 6006:1025 \
  --viewport custom --viewport-name desktop --viewport-width 1196 --viewport-height 796 \
  --scope page --page-reason "Baseline node represents complete page."

FIGMA_ACCESS_TOKEN=... pnpm framelia contract create \
  --contract-id login.mobile --force --name Mobile --target-path /login \
  --file-key q2MZbYDBibNKYDm7ESfvKF --node-id 6007:4421 \
  --viewport custom --viewport-name mobile --viewport-width 356 --viewport-height 728 \
  --scope page --page-reason "Baseline node represents complete page."
```

`--force` rewrites `name`, `target`, `viewport`, `scope` and the baseline from the flags and
bumps `revision`, but keeps the existing `profileOverrides` and `projects`. The
`snapshotDigest` only changes if the Figma content changed.

**After that first pin exists locally**, re-run the same design later with the
lighter-weight `contract refresh-baseline` instead -- it reuses the file key/node id
already pinned, so it needs no `--file-key`/`--node-id`:

```bash
FIGMA_ACCESS_TOKEN=... pnpm framelia contract refresh-baseline --contract login.desktop
FIGMA_ACCESS_TOKEN=... pnpm framelia contract refresh-baseline --contract login.mobile
```

Do this whenever the Figma design changes.

### Run the example

```bash
pnpm test:visual
```

Once pinned, this needs no token or network access: it captures the real login page and
compares it against the pinned snapshot, persisting durable evidence through
`@framelia/playwright/reporter`. Every invocation reruns the comparison, including
uncommitted UI changes. A baseline that was never pinned locally fails the test
explicitly rather than silently skipping it.

The thresholds are `minMatch: 0.999` and `minSSIM:
0.995`, stored in each contract. A visual mismatch fails the test while still producing
expected/actual/diff evidence. Inspect that evidence and fix the UI; do not loosen
thresholds just to pass.

### Inspect the same run

The reporter prints a live dashboard URL during the test run, and `framelia check`
reports the `runId` of the run it executed. To inspect that run's persisted evidence
after Playwright exits, name it explicitly -- no command picks a "latest" run:

```bash
pnpm framelia dashboard --run <run-id> --no-open
pnpm framelia report --run <run-id> --output ./framelia-report
```

Durable evidence for every run lives under `.framelia/runs/<runId>/` (gitignored,
regenerated per run), keyed by contract id, not by test file layout.

An empty `.framelia/runs/` means no run has been published yet -- the contract itself
is a specification, not a completed comparison. This example demonstrates one consumer
workflow, not exhaustive coverage of every CLI command or flag. Command-level tests
belong in `packages/cli/tests`.

### Workspace development

The steps above assume a published release that includes the pending changesets. Inside this repository the example
instead resolves `framelia`, `@framelia/playwright`, `@framelia/contracts`, and
`@framelia/dashboard-server` through `workspace:*`, and imports their built `dist`
output. After changing any package implementation, run `pnpm framelia:build` (it builds
`@framelia/playwright` along with the CLI and bundled dashboard) before running the
example's tests.

Running the example this way exercises the workspace sources. It is **not** evidence
about a packed or published release; that is what the repository's packed-consumer
gate (`scripts/consumer-smoke.mjs`) is for.

## Verification gates

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test:unauth
pnpm test:auth
pnpm test:web
```

`pnpm check` runs Vite+ format/lint checks. Database gates require PostgreSQL (`docker compose up -d`). Pinning a Figma baseline requires `FIGMA_ACCESS_TOKEN` and a real node ID; running `pnpm test:visual` does not.

These gates are run from _this_ directory, not the repo root: `pnpm build` (which
generates `src/routeTree.gen.ts`) has to run before `pnpm typecheck` can succeed, and
neither Docker/Postgres nor a live app server exist in the root CI `validate` job. The
root `typecheck` script excludes `examples/**` for exactly this reason -- this example
validates itself, on its own infrastructure, not through the repo-wide recursive gates.

## Deployment

Nitro is configured by the generated Vite+ setup and supports Netlify, Vercel, Node, and other Nitro presets. Choose provider through its official TanStack Start/Nitro deployment path; set `NITRO_PRESET` when provider requires it.

Required deployment variables:

```text
DATABASE_URL
BETTER_AUTH_SECRET
VITE_BASE_URL
```

OAuth client id/secret pairs (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are optional; set them only if that provider is enabled in production, with redirect URIs updated to the deployed origin. Figma credentials are not part of the app env contract. Provide them only when pinning or refreshing a Figma baseline, using local shell variables or CI secrets. Never expose server secrets through `VITE_*` variables. Run `pnpm db:setup` (or `drizzle-kit push`/`migrate` against the production database), deploy, then smoke-test `/`, `/login`, `/app`, and `/app/settings` with a real account.

Deployed URL: not configured yet. Set after provider deployment and record it here.
