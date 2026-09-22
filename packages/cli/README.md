# framelia

CLI companion to [`@framelia/playwright`](../playwright/README.md). It does not run visual
verification itself — that happens inside your own `@playwright/test` suite via
`toMatchFigma`/`toMatchPage`/`toMatchUrl`. This CLI covers project setup, contract authoring, and
browsing/gating the evidence a matcher-driven Playwright run produces.

If you're looking for "how do I run a visual check," start at
[`@framelia/playwright`](../playwright/README.md) — this README documents the CLI surface around
that, not the matchers themselves.

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

| Command                           | Purpose                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `framelia init`                   | Initialize project config and an ignored auth-state directory.                       |
| `framelia auth`                   | Record Playwright storage state through a headed login browser.                      |
| `framelia contract create`        | Interactively author a schema-v5, Figma-baselined visual contract.                   |
| `framelia contract suggest-masks` | Scan a live page and propose mask selectors without modifying a contract.            |
| `framelia baseline promote`       | Capture a target URL and accept it as a `toMatchPageBaseline` baseline.              |
| `framelia status`                 | Show CLI version, project root, and Figma token availability.                        |
| `framelia schema`                 | Print the live JSON Schema for an authored contract or signed requirements envelope. |
| `framelia` (no arguments)         | Open the dashboard for one explicit durable run.                                     |
| `framelia dashboard`              | Serve one selected durable run; requires `--run`.                                    |
| `framelia open`                   | Alias for opening one selected durable run without rerunning.                        |
| `framelia report`                 | Export one selected run as a relocatable static dashboard.                           |
| `framelia done-gate`              | Evaluate one selected run against protected signed requirements.                     |
| `framelia capture`                | Fetch one Figma PNG for diagnosis (`fetch-gold` alias).                              |
| `framelia compare`                | Compare two existing PNG files without source provenance gates.                      |

`verify`, `doctor`, and `discover` — plus the navigation action DSL underneath them — are retired.
Visual verification runs in `@framelia/playwright`'s matchers, called from your own test.
The CLI still launches standalone browsers for `auth`, `contract suggest-masks`, and
`baseline promote`; these helpers do not run visual verification.

## Setup

```bash
npx framelia init
```

Writes `framelia.config.ts` with the project-wide config surface as commented examples. Project
initialization does not ask about Figma, routes, selectors, or individual screens — those live in
authored contracts and the application's own Playwright fixtures.

```ts
import { defineConfig } from "framelia";

export default defineConfig({
  // playwright: {
  //   config: "playwright.config.ts",
  //   projects: ["chromium"], // use [""] for Playwright's unnamed project
  // },
  // contracts: [".framelia/contracts/**/visual-contract.json"],
  // retryAcceptance: "require-first-attempt",
  // envFile: ".env.e2e",
  // storageStatePath: ".framelia/auth/user.json",
  // Project-wide capture defaults:
  // stabilitySamples: 3,
  // timeoutMs: 60_000,
  // devtoolsSelector: true,
  // deviceScaleFactor: 1,
  // fontPolicy: "required",
  // animationPolicy: "freeze",
  // retry: { attempts: 2, delayMs: 1_000 },
  // maxMaskedAreaRatio: 0.15,
});
```

Workflow policy resolution starts at `--project-root`, or discovers the nearest config ancestor
without crossing the enclosing Git root. It loads `.env`, `.env.local`, then configured `envFile`
entries; later files win while values already present in the process environment remain
authoritative. Resolved paths are relative to the selected application root.

Set the Figma token used by `contract create` and `capture` (alias `fetch-gold`):

```bash
export FIGMA_ACCESS_TOKEN="your-token"
```

## Authoring a contract

```bash
npx framelia contract create
```

An interactive wizard asks for a target URL (identity only — recorded for evidence, not
navigated by this command), contract ID, display name, Figma `fileKey`/`nodeId`, viewport, and
capture scope. It writes `.framelia/visual-verifications/<feature>/visual-contract.json`, where
`<feature>` is the first segment of the contract ID. Use `--output <path>` for another location.
New contract IDs merge into an existing file without `--force`; replacing an existing ID requires
`--force` and preserves the other contracts. All contracts in one file share `target.url`: a
different target URL errors even with `--force`, so use a separate output file for another target.

```json
{
  "schemaVersion": 5,
  "target": { "kind": "web", "url": "http://127.0.0.1:3000/login" },
  "contracts": [
    {
      "id": "login.desktop",
      "name": "Desktop",
      "baseline": { "kind": "figma", "fileKey": "abc123", "nodeId": "153:5181" },
      "viewport": { "preset": "desktop", "width": 1440, "height": 1024 },
      "outDir": ".framelia/visual-verifications/login/desktop",
      "scope": {
        "kind": "page",
        "pageReason": "Supplied node represents complete login screen."
      }
    }
  ]
}
```

A contract only ever describes a Figma baseline pointer — there is no `web` baseline kind and no
`navigation`/`auth`/`cookies`/`extraHeaders` fields; those belonged to the retired CLI-owned
capture engine. Region scope adds a `selector` and `expectSize`; for a region scope,
`contract create` best-effort bakes an `expectStyle` (font weight/size/line-height/letter-spacing/
color) into the contract from the Figma node at authoring time.

```json
{
  "kind": "region",
  "selector": "[data-testid='login-form']",
  "expectSize": { "width": 480, "height": 560 }
}
```

A page contract can also declare one or more `styleChecks` — CSS selectors inside the page, each
paired with its own Figma node (distinct from the page's own baseline node), for comparing
individual elements' style. `contract create` offers to add these interactively when scope is
`page` (or accepts one via `--style-check-selector`/`--style-check-node-id` non-interactively);
each check-point's `expectStyle` is best-effort baked in the same way region scope's is.

```json
{
  "kind": "page",
  "pageReason": "Supplied node represents complete login screen.",
  "styleChecks": [{ "selector": "[data-testid='login-form']", "nodeId": "200:10" }]
}
```

Print the live JSON Schema for either input shape:

```bash
npx framelia schema --target contract
npx framelia schema --target requirements
```

## Browsing and gating evidence

Run your Playwright suite with `@framelia/playwright`'s Reporter registered (see
[`@framelia/playwright`](../playwright/README.md)). It publishes immutable selected-run evidence
under `.framelia/runs/<run-id>/`.

```bash
npx framelia open --project-root "$PWD" --run <run-id>
npx framelia dashboard --project-root "$PWD" --run <run-id>
npx framelia report --project-root "$PWD" --run <run-id> --output ./framelia-report
```

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
