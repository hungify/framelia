# Framelia reference app

Standalone TanStack Start consumer app showing Framelia around a real Better Auth flow: login/signup (email/password + GitHub/Google OAuth), protected dashboard, profile settings, logout, deterministic auth fixtures, and all three Framelia Playwright matchers.

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

Playwright config creates `playwright/.auth/user.json` through a real signup/login flow. Auth state is ignored by Git. `.env.e2e` contains only `PORT` and `E2E_*` credentials; app secrets and database URL remain in `.env`. Projects are separate:

```bash
pnpm test:unauth
pnpm test:auth
pnpm test:e2e
pnpm test:e2e:real-flow
pnpm test:web
pnpm test
```

`e2e/specs/public.spec.ts` checks login/signup availability and protected-route redirects. `e2e/specs/authenticated.spec.ts` uses `storageState` for dashboard/settings/logout checks. Page objects live under `e2e/pages`; fixtures own their construction under `e2e/fixtures`. Stable `data-testid` hooks target login, dashboard, and settings proof surfaces.

## Framelia matchers

`playwright.config.ts` registers `@framelia/playwright/reporter`. It starts the dashboard integration and writes durable Figma evidence under `.framelia/visual-verifications/` whenever a Figma matcher runs. `e2e/fixtures/auth.setup.ts` logs into the demo account through the real login UI, falling back to signup only to bootstrap a fresh database -- no fake seed path exists.

| Matcher         | Spec                                | Needs `FIGMA_ACCESS_TOKEN`? | Persists durable evidence?                                |
| --------------- | ------------------------------------ | ---------------------------- | ---------------------------------------------------------- |
| `toMatchFigma`  | `e2e/specs/figma.spec.ts`            | Yes                           | Yes -- the only one `framelia dashboard`/`open`/`report` read |
| `toMatchPage`   | `e2e/specs/web-to-web-page.spec.ts`  | No                            | No (Playwright attachments only)                            |
| `toMatchUrl`    | `e2e/specs/web-to-web-url.spec.ts`   | No                            | No (Playwright attachments only)                            |

`toMatchFigma`'s contract owns route, file key, node ID, viewport, and scope -- authoring one is step 3 of the "CLI quickstart" below. `FIGMA_ACCESS_TOKEN` is the one exception to "everything in `.env.e2e` is app-level test config": it lives there purely because `playwright.config.ts` already loads that file, not because it's an app credential. Raw CLI commands run outside Playwright (`pnpm cli:contract:login`, `pnpm cli:capture`) don't read `.env.e2e` -- pass the token inline instead: `FIGMA_ACCESS_TOKEN=... pnpm cli:contract:login`.

If the dashboard looks empty, it's almost always because `pnpm test:visual` hasn't run yet with a valid token -- authoring a contract (`cli:contract:login`) only writes the _spec_ (`visual-contract.json`), not evidence.

### Scaling this pattern to many pages

`e2e/specs/figma.spec.ts` also doubles as the reference for two small `@framelia/playwright`
helpers meant for exactly this: one spec file per page, at scale. `readContractEntry` reads a
single contract (`login.desktop`, `login.mobile`) out of `visual-contract.json` schema-validated,
so nothing here hand-rolls `existsSync`/`JSON.parse`/`.find()`. `isContractFresh`/
`writeContractFreshness` record, per contract `outDir`, whether the last check under a given
fingerprint (this app uses `git rev-parse HEAD`) passed -- `test.skip`s the next check entirely
when nothing has changed since. See `@framelia/playwright`'s README ("Scaling to many pages") for
the full explanation of what this can and can't safely skip.

## CLI quickstart

This is the **Figma-to-web dev loop** end to end -- the same steps you'd follow the
first time you drop `framelia` into any web app, not just this one. The mental model:
the CLI only sets up, authors, and inspects; the actual pixel comparison always runs
inside *your own* Playwright test via a matcher from `@framelia/playwright` (step 5).
`e2e/specs/cli.spec.ts` is executable proof every command below works exactly as
documented, run through the installed `framelia` bin the way a real user would --
`pnpm test:cli` runs that whole spec at once.

**0. Install** (in your own app; already done here via the workspace):

```bash
npm install --save-dev framelia @framelia/playwright @playwright/test
```

**1. Initialize a project config.**

```bash
pnpm cli:init
```

Writes `framelia.config.ts` with the full project-wide config surface as commented
examples. It doesn't ask about Figma, routes, or selectors yet -- those are steps 3+,
scoped per contract or per test, not global.

**2. Sanity-check the install.**

```bash
pnpm cli:status   # CLI version, project root, whether FIGMA_ACCESS_TOKEN is visible
pnpm cli:schema   # the live JSON Schema for a contract/artifact
```

**3. Author a contract against a Figma baseline.**

```bash
pnpm cli:contract:login -- --file-key <figmaFileKey> --node-id <figmaNodeId>
```

Interactive wizard when run without flags; every field here except `--file-key`/
`--node-id` is pre-filled by the script (only the Figma values are something only you
know). Writes `.framelia/visual-verifications/login/visual-contract.json`. Adding a new
`--contract-id` merges into that file; replacing an existing one needs `--force`.
`(Optional)` scan the live page for dynamic content worth masking first --
`pnpm cli:contract:suggest-masks` only proposes selectors, it never writes to a contract.

It's a plain JSON file underneath, so you can also hand-write or hand-edit it directly
(`framelia schema --target contract` prints the full field list -- regions, style
checks, masks, custom viewports):

```json
{
  "schemaVersion": 5,
  "target": { "kind": "web", "url": "http://localhost:8888/login" },
  "contracts": [
    {
      "id": "login.desktop",
      "baseline": { "kind": "figma", "fileKey": "<figmaFileKey>", "nodeId": "<figmaNodeId>" },
      "viewport": { "preset": "desktop", "width": 1440, "height": 1024 },
      "outDir": ".framelia/visual-verifications/login/desktop",
      "scope": { "kind": "page", "pageReason": "Baseline node represents complete page." }
    }
  ]
}
```

**4. (Optional) capture a login session** if the page you're contracting needs auth:

```bash
pnpm cli:auth
```

Opens a headed browser and blocks on an interactive terminal prompt while you log in by
hand, then saves Playwright storage state. It can't be scripted or asserted by
`cli.spec.ts` the way the JSON-output commands above can -- there's no hook for an
automated test to reach into that browser. Its capture/consume contract is instead
proven indirectly by `e2e/fixtures/auth.setup.ts` -> `e2e/specs/authenticated.spec.ts`,
which exercise the same mechanism for the demo account.

**5. Read the contract from your own Playwright test, and call the matcher.** This is
the one step the CLI deliberately doesn't own:

```ts
import { expect, readContractEntry } from "@framelia/playwright";
import { test } from "@playwright/test";

const entry = readContractEntry(
  ".framelia/visual-verifications/login/visual-contract.json",
  "login.desktop",
);

test("login matches Figma", async ({ page }) => {
  test.skip(!entry.ok, entry.ok ? "" : entry.message);
  const { contract } = entry as Extract<typeof entry, { ok: true }>;
  await page.setViewportSize(contract.viewport);
  await page.goto("/login");
  await expect(page).toMatchFigma(contract.baseline.nodeId, { fileKey: contract.baseline.fileKey });
});
```

See `e2e/specs/figma.spec.ts` for the full version (per-viewport loop, fingerprint-skip,
style checks) and "Framelia matchers" above for what each matcher persists.

**6. Run it, then inspect what it produced.**

```bash
pnpm test:visual     # needs FIGMA_ACCESS_TOKEN in .env.e2e -- the only step that
                      # persists durable evidence to .framelia/visual-verifications/
pnpm cli:dashboard    # aggregate every artifact under the project root
pnpm cli:open         # open one artifact without rerunning the test
```

**7. Gate it in CI**, once a merge gate is wired up:

```bash
pnpm done-gate   # revalidate one artifact's identity, freshness, and evidence integrity
pnpm report      # export a portable static dashboard for CI artifacts
```

Not covered by this loop -- different concern, different pass: `framelia baseline
promote` (the web-to-web page-to-page workflow behind `toMatchPage`/`toMatchUrl`; see
"Framelia matchers" above).

**Diagnostics**, for debugging one contract's Figma side by hand, outside a full test run:

```bash
FIGMA_ACCESS_TOKEN=... pnpm cli:capture   # fetch one Figma node as a PNG
pnpm cli:compare                          # diff two existing PNGs, no test run needed
```

`dashboard`, `open`, `capture`, and `compare` all consume artifacts a test run already
produced -- they're this loop's inspection tools, not a merge gate.

<details>
<summary>Monorepo-internal note: why these packages resolve the way they do here</summary>

`framelia`/`@framelia/dashboard-server`/`@framelia/playwright` resolve via `workspace:*`
straight to the monorepo's own `packages/*` (see `package.json`'s devDependencies and the
root `pnpm-workspace.yaml`, which lists `examples/*`) -- this app tracks Framelia's
development, not a released version, so there's nothing to publish-then-pin here.
`@framelia/verify` needs no dependency entry of its own: once `framelia`/
`@framelia/playwright`/`@framelia/dashboard-server` resolve to the real monorepo
packages, each already resolves its own `@framelia/verify` correctly through the
monorepo's own workspace. `@framelia/contracts` is declared directly, though --
`e2e/specs/cli.spec.ts` imports `SCHEMA_VERSION`/`VerificationArtifact` from it, since
the `framelia` package's library surface only covers config/dashboard APIs (see
`packages/cli/src/index.ts`). Run `pnpm run framelia:build` after changing anything
under `packages/*` so this app's `framelia` bin and `@framelia/dashboard-server`'s
bundled dashboard reflect it (`@framelia/playwright` needs no build -- its package.json
exports source directly). None of this applies to an app installing `framelia` from npm
-- step 0 above is the real path for that.

</details>

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

`pnpm check` runs Vite+ format/lint checks. Database gates require PostgreSQL (`docker compose up -d`). Figma gate requires valid credentials and a real node ID.

## Deployment

Nitro is configured by the generated Vite+ setup and supports Netlify, Vercel, Node, and other Nitro presets. Choose provider through its official TanStack Start/Nitro deployment path; set `NITRO_PRESET` when provider requires it.

Required deployment variables:

```text
DATABASE_URL
BETTER_AUTH_SECRET
VITE_BASE_URL
```

OAuth client id/secret pairs (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are optional; set them only if that provider is enabled in production, with redirect URIs updated to the deployed origin. Figma credentials are not part of the app env contract. Provide them only when running the optional Figma matcher, using local shell variables or CI secrets. Never expose server secrets through `VITE_*` variables. Run `pnpm db:setup` (or `drizzle-kit push`/`migrate` against the production database), deploy, then smoke-test `/`, `/login`, `/app`, and `/app/settings` with a real account.

Deployed URL: not configured yet. Set after provider deployment and record it here.
