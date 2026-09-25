# framelia

CLI companion to [`@framelia/playwright`](../playwright/README.md). Matchers still run inside
your own `@playwright/test` suite. `framelia check` coordinates exact contract selection through
that project's locally installed Playwright; the remaining commands cover setup, authoring, and
browsing/gating the durable evidence Playwright publishes.

## Requirements

- Node.js 22.13 or newer.
- `FIGMA_ACCESS_TOKEN` for any command touching a Figma node (`contract create`, `capture`).

## Install

Package is published as `framelia`. During repository development, run from repository root with `pnpm framelia`.

```bash
npm install --save-dev framelia
npx framelia status --project-root "$PWD"
```

## Commands

| Command                              | Purpose                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `framelia init`                      | Preview/apply idempotent, non-destructive project integration.                         |
| `framelia check`                     | Collect and run an exact authored contract/project selection through local Playwright. |
| `framelia auth`                      | Record Playwright storage state through a headed login browser.                        |
| `framelia contract create`           | Author one pinned Figma contract object and immutable snapshot.                        |
| `framelia contract list`             | Reconcile authored contract/project cases with executable Playwright bindings.         |
| `framelia contract refresh-baseline` | Explicitly reacquire and atomically repin one exact contract.                          |
| `framelia contract suggest-masks`    | Scan a live page and propose mask selectors without modifying a contract.              |
| `framelia baseline promote`          | Capture a target URL and accept it as a `toMatchPageBaseline` baseline.                |
| `framelia status`                    | Show CLI version, project root, and Figma token availability.                          |
| `framelia schema`                    | Print the live JSON Schema for an authored contract or signed requirements envelope.   |
| `framelia` (no arguments)            | Open the dashboard for one explicit durable run.                                       |
| `framelia dashboard`                 | Serve one selected durable run; requires `--run`.                                      |
| `framelia open`                      | Alias for opening one selected durable run without rerunning.                          |
| `framelia report`                    | Export one selected run as a relocatable static dashboard.                             |
| `framelia done-gate`                 | Evaluate one selected run against protected signed requirements.                       |
| `framelia capture`                   | Fetch one Figma PNG for diagnosis (`fetch-gold` alias).                                |
| `framelia compare`                   | Compare two existing PNG files without source provenance gates.                        |

`verify`, `doctor`, and `discover` — plus the navigation action DSL underneath them — are retired.
Visual capture remains in `@framelia/playwright`; `check` only coordinates collection, immutable
planning, and exact execution while Playwright retains scheduling, fixtures, web servers,
dependencies, teardowns, and retries. The CLI still launches standalone browsers for `auth`,
`contract suggest-masks`, and `baseline promote`.

## Setup

Preview the complete change set without writing:

```bash
npx framelia init --project-root "$PWD" --dry-run
```

Apply the same plan:

```bash
npx framelia init --project-root "$PWD"
```

Initialization is idempotent and never rewrites an existing Framelia or Playwright
configuration, even with the compatibility `--force` flag. With no Playwright config it creates a
minimal unnamed-project config containing the list and Framelia reporters. When a Playwright
config already exists, the JSON outcome marks reporter registration `manual`, preserves the file
byte-for-byte, and gives an exact verify/add recipe. It does not change `package.json`, package
manager files, module format, scripts, projects, fixtures, `webServer`, browsers, or dependencies.

The generated Framelia policy discovers one authored object per file:

```ts
import { defineConfig } from "framelia";

export default defineConfig({
  playwright: {
    config: "playwright.config.ts",
    projects: ["chromium"], // use [""] for Playwright's unnamed project
  },
  contracts: [".framelia/contracts/**/visual-contract.json"],
});
```

Project resolution starts at explicit `--project-root`, otherwise at the nearest config ancestor
without crossing the enclosing Git root. Environment files are loaded from that selected
application root, never from an unrelated invocation directory: `.env`, `.env.local`, then
configured `envFile` entries; later files win while preexisting process values remain
authoritative.

Set the token only for explicit Figma acquisition (`contract create`, `contract
refresh-baseline`, or low-level `capture`). Checks use reviewed pinned snapshots and need no Figma
credentials:

```bash
export FIGMA_ACCESS_TOKEN="your-token"
```

## Authoring a contract

Interactive use asks for the same inputs accepted by flags:

```bash
npx framelia contract create --project-root "$PWD"
```

For automation, supply every required value. `--figma-url` accepts the proven Figma design URL
form and normalizes its `node-id` from `6006-1028` to `6006:1028`:

```bash
npx framelia contract create \
  --project-root "$PWD" \
  --target-path "/login?state=error" \
  --contract-id login.error.desktop \
  --name "Login error — desktop" \
  --figma-url "https://www.figma.com/design/abc123/Login?node-id=6006-1028" \
  --viewport desktop \
  --scope page \
  --page-reason "The selected frame represents the complete page."
```

A URL without `node-id`, a conflicting `--file-key`/`--node-id`, or an unproven Figma URL shape is
an actionable error. When stdin is not a TTY, missing fields produce one structured JSON result
and never open a prompt.

The default path is
`.framelia/contracts/<full-contract-id>/visual-contract.json`. Each file contains exactly one
versioned `AuthoredContract`; IDs are globally unique across every configured discovery root:

```json
{
  "formatVersion": 1,
  "kind": "framelia.contract",
  "id": "login.error.desktop",
  "name": "Login error — desktop",
  "revision": 1,
  "target": { "path": "/login?state=error" },
  "viewport": { "preset": "desktop", "width": 1440, "height": 1024 },
  "scope": {
    "kind": "page",
    "pageReason": "The selected frame represents the complete page."
  },
  "baseline": {
    "snapshotDigest": "sha256:<reviewed-content-digest>"
  },
  "required": true
}
```

Authoring first acquires and validates the complete Figma PNG/style snapshot in private staging.
Under one project authoring lock it rechecks the original contract bytes and global ID ownership,
publishes `.framelia/baselines/<snapshot-digest>/` immutably, then durably replaces the contract
pointer. A failure never exposes a torn pointer. `--force` replaces only the exact existing global
ID and never clobbers a foreign file or moves that ID through `--output`.

Creation reports authoring and runnable registration separately. An authored but unbound contract
is success with `CONTRACT_UNBOUND` (or a collection-blocked diagnostic) plus an exact
`defineFigmaTests` recipe; it never claims the application scenario is executable.

```bash
npx framelia contract list --project-root "$PWD"
npx framelia contract refresh-baseline \
  --project-root "$PWD" \
  --contract login.error.desktop
```

`contract list` safely collects through the configured local Playwright/Framelia reporter and
classifies every contract/project pair as `configured`, `executable`, `unbound`, or `invalid`.
It performs no visual run. Duplicate IDs and malformed files are all reported rather than hidden.
`refresh-baseline` is the only automatic way to reacquire an authored Figma snapshot: it selects
one exact ID, increments its revision, uses the same publish-before-pointer transaction, and leaves
the old pinned baseline usable on every failure.

Region scope adds a CSS selector and expected size. Page scope can add style check-points, each
pairing a selector with a separate Figma node:

```json
{
  "kind": "region",
  "selector": "[data-testid='login-form']",
  "expectSize": { "width": 480, "height": 560 }
}
```

```json
{
  "kind": "page",
  "pageReason": "The selected frame represents the complete page.",
  "styleChecks": [{ "selector": "[data-testid='login-form']", "nodeId": "200:10" }]
}
```

Print the live input schemas with:

```bash
npx framelia schema --target contract
npx framelia schema --target requirements
```

## Running exact authored checks

Configure the Playwright config and visual project names that own authored contracts:

```ts
export default defineConfig({
  playwright: {
    config: "playwright.config.ts",
    projects: ["chromium"], // use [""] for Playwright's unnamed project
  },
  contracts: ["contracts/**/*.json"],
});
```

Register `@framelia/playwright/reporter` in that Playwright config, preserving your other
reporters. Then choose exactly one selection form:

```bash
npx framelia check --all
npx framelia check --contract login.desktop --contract settings.mobile
npx framelia check --all --project chromium
```

`--all` starts from the complete required authored contract/project matrix. Exact `--contract`
IDs may also select optional contracts; repeatable `--project` only narrows configured visual
projects and never changes the authored matrix. Pass `--project-root` to select an application
explicitly, or run from a nested directory beneath its Framelia config.

`check` resolves the consumer project's local `@playwright/test/cli`, performs documented
`--list` collection, freezes the selected case plans and setup/dependency/teardown graph, then
executes one exact Playwright `--test-list`. Playwright still owns fixtures, web servers, project
dependencies, teardown, repeat slots, and retries. Collection imports trusted project code and
can have the same side effects as ordinary Playwright collection; it is not a sandbox.

The Framelia transport is private and versioned. A missing/incompatible Reporter, duplicate or
missing binding, unknown project, changed contract/spec/policy/setup graph, zero selected cases,
or unexplained Playwright exit is an execution error. No path automatically fetches Figma,
repairs a baseline, refreshes a snapshot, or reuses a previous result.
Runner success/failure is reconciled against each case's latest complete retry, while
`retryAcceptance` independently selects the authoritative visual attempt. With
`require-first-attempt`, a first mismatch followed by a passing retry therefore remains a completed
visual mismatch (exit `1`), not an infrastructure error.

Standard output is one versioned JSON command outcome. Child and user-reporter output is forwarded
byte-for-byte to standard error, so noisy reporters cannot corrupt JSON automation. The result
contains exact coverage, every selected contract/project/repeat case, chosen attempt, retry
history, diagnostics, portable expected/actual/diff/score references, and the next explicit
operation. A completed match exits `0`, a completed visual mismatch exits `1`, and
preflight/transport/cancellation or other incomplete execution exits `2`. Once a durable run
starts, even cancellation or transport failure retains its `runId` and bundle path for inspection.

This JSON contract begins after successful CLI argument parsing. Unknown flags, malformed enum or
number values, duplicate options, and missing values for a flag are usage errors reported by
Stricli on stderr. Required semantic fields for the new finite workflows are parser-optional
intentionally, then validated together so noninteractive omission still returns one JSON result.

## Browsing and gating evidence

Run your Playwright suite with `@framelia/playwright`'s Reporter registered (see
[`@framelia/playwright`](../playwright/README.md)). It publishes immutable selected-run evidence
under `.framelia/runs/<run-id>/`.

```bash
npx framelia open --project-root "$PWD" --run <run-id>
npx framelia dashboard --project-root "$PWD" --run <run-id>
npx framelia report --project-root "$PWD" --run <run-id> --output ./framelia-report
```

`open` and `dashboard` are long-running readers: after the server is actually listening they emit
exactly one `framelia.open-ready` JSON record on stdout containing the selected run, bundle path,
and addresses. Operational URL/progress logs remain on stderr. `report` is finite and emits the
same deep selected-run projection as `check`/`done-gate`, plus its portable report path. It never
chooses a latest run implicitly.

Static report output is relocatable and contains only project-portable run identities and copied
evidence. Serve the exported directory over HTTP; browsers block report JSON loading through
`file://`.

The authoritative gate additionally requires a protected Ed25519-signed requirements envelope:

```bash
export FRAMELIA_TRUSTED_REQUIREMENTS_PUBLIC_KEY=/opt/framelia/trust/requirements-ed25519.pub.pem
export FRAMELIA_PROTECTED_JOB_IDENTITY=github:example/app:visual-gate
export FRAMELIA_AUTHORITY_AUDIENCE=framelia-done-gate
npx framelia done-gate \
  --project-root "$PWD" \
  --run <run-id> \
  --requirements ./ci/requirements.signed.json
```

The public key path must resolve outside the project checkout. Keep the corresponding private key
only in a protected CI/deployment signing service; never put it in the repository, expose it to a
pull-request job, or make product code a signing authority. Supply the expected job identity and
audience as protected job environment, not project config or CLI arguments. The signed payload
must name the same run, job identity, and audience; have a current validity window no longer than
15 minutes; and bind the observed HTTP(S) origin as well as the served build digest.

`done-gate` intentionally does not load project `.env` files; configure all three trust variables
in the protected runner environment.

The protected adapter signs canonical JSON only after it has observed the exact required case
matrix, source/build identity, served-build origin and proof, policy digest, binding and spec
identities, and retry policy. Branch protection should trust only that protected job. The
requirements envelope may be copied into the workspace, but it is not trusted unless its signature
verifies against the pinned external public key and all protected identity/time bindings match.

Legacy `visual-verification.json` input is deliberately unsupported as authority because it lacks
the frozen source/build and case-plan identities. Rerun the annotated Playwright suite to produce
a selected run bundle; there is no compatibility conversion or fallback.

## Diagnosis commands

```bash
npx framelia capture --file-key abc123 --node-id 153:5181 --out figma-gold.png
npx framelia compare --baseline figma-gold.png --actual actual.png --out-dir ./diff
```

`capture` (alias `fetch-gold`) captures one Figma node render for inspection. `compare` diffs two existing PNGs
directly with framelia's compare engine, without resolving a baseline or checking provenance.

## Evidence layout

```text
.framelia/runs/<run-id>/
├── plan.json
├── run.json
└── cases/<case-id>/
    ├── plan.json
    └── attempts/<attempt-id>/
        ├── attempt.json
        ├── expected.png
        ├── actual.png
        ├── diff.png
        └── score.json
```

Run and case plans freeze the exact selected matrix, policy, authored contract, baseline digest,
registration identity, retry policy, and stability sample count. Attempt records contain only
portable paths and hashes; private stability sample images are deleted after hashing.

## Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Command completed and visual verdict passed.                     |
| `1`  | Verification completed, but one or more visual contracts failed. |
| `2`  | Usage, schema, environment, or execution error.                  |

Exit `1` is a valid comparison result, not an infrastructure failure.

## CI example

```yaml
- name: Run Playwright visual contracts
  env:
    FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
  run: npx playwright test

- name: Gate selected run
  env:
    FRAMELIA_TRUSTED_REQUIREMENTS_PUBLIC_KEY: /opt/framelia/trust/requirements-ed25519.pub.pem
    FRAMELIA_PROTECTED_JOB_IDENTITY: github:example/app:visual-gate
    FRAMELIA_AUTHORITY_AUDIENCE: framelia-done-gate
  run: |
    npx framelia done-gate \
      --project-root "$PWD" \
      --run "$FRAMELIA_RUN_ID" \
      --requirements "$SIGNED_REQUIREMENTS_PATH"
```

Upload `.framelia/runs/<run-id>/` and the output of `framelia report --run <run-id>` as CI
artifacts when review evidence is needed.

## Troubleshooting

- Figma auth failure: run `framelia status`; confirm token access to the file.
- Chromium missing: run `npx playwright install chromium`.
- Selector failure: use a deterministic unique selector such as `data-testid`.
- Unstable result: check fonts, timers, random data, API responses, animations, browser, viewport
  in your own Playwright test — framelia no longer owns any of that setup.
- Exit `1`: inspect `diff.png`, then the score.

## Security and artifacts

- Keep `FIGMA_ACCESS_TOKEN` in ignored environment files or CI secrets.
- Treat Playwright storage state as a session credential; keep `.framelia/auth/` ignored and never upload it as an artifact.
- Never commit tokens or place them in contracts.
- Treat web screenshots and Figma metadata as potentially sensitive.
- Apply repository retention rules before sharing generated evidence.

## License

MIT
