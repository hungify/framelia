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
- `FIGMA_ACCESS_TOKEN` for any command touching a Figma node (`contract create`, `fetch-gold`).

## Install

Package is published as `framelia`. During repository development, run from repository root with `pnpm framelia`.

```bash
npm install --save-dev framelia
npx framelia status --project-root "$PWD"
```

## Commands

| Command                    | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `framelia init`            | Initialize project config and an ignored auth-state directory.                             |
| `framelia auth`            | Record Playwright storage state through a headed login browser.                            |
| `framelia contract create` | Interactively author a schema-v4, Figma-baselined visual contract.                         |
| `framelia status`          | Show CLI version, project root, and Figma token availability.                              |
| `framelia schema`          | Print the live JSON Schema for a contract or verification artifact.                        |
| `framelia` (no arguments)  | Open a dashboard aggregating every artifact found under `.framelia/visual-verifications/`. |
| `framelia dashboard`       | Same aggregated dashboard, explicit form; supports `--project-root` and `--no-open`.       |
| `framelia open`            | Open one archived artifact in the dashboard without rerunning.                             |
| `framelia report`          | Export a portable static dashboard for CI artifacts.                                       |
| `framelia done-gate`       | Revalidate a persisted artifact's identity, freshness, and evidence integrity.             |
| `framelia fetch-gold`      | Fetch one Figma PNG for diagnosis.                                                         |
| `framelia compare`         | Compare two existing PNG files without source provenance gates.                            |

`verify`, `doctor`, and `discover` — plus the navigation action DSL underneath them — are retired.
There is no CLI command that captures a browser or executes navigation; that ownership moved
entirely to `@framelia/playwright`'s matchers, called from your own test.

## Setup

```bash
npx framelia init
```

Writes `framelia.config.ts` with the full project-wide config surface as commented examples. Project
initialization does not ask about Figma, routes, selectors, or individual screens — those live in
your own Playwright test and in whatever contract you author separately.

```ts
import { defineConfig } from "framelia";

export default defineConfig({
  // envFile: ".env.playwright",
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

Set the Figma token used by `contract create` and `fetch-gold`:

```bash
export FIGMA_ACCESS_TOKEN="your-token"
```

## Authoring a contract

```bash
npx framelia contract create
```

An interactive wizard asks for a target URL (identity only — recorded for evidence, not
navigated by this command), contract ID, Figma `fileKey`/`nodeId`, viewport, and capture scope. It
writes `.framelia/visual-verifications/<feature>/visual-contract.json`, where `<feature>` is the
first segment of the contract ID. Use `--output <path>` for another location; an existing file
requires `--force`.

```json
{
  "schemaVersion": 4,
  "target": { "kind": "web", "url": "http://127.0.0.1:3000/login" },
  "contracts": [
    {
      "id": "login.desktop",
      "baseline": { "kind": "figma", "fileKey": "abc123", "nodeId": "153:5181" },
      "viewport": { "name": "desktop", "width": 1440, "height": 1024 },
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

Print the live JSON Schema for either shape:

```bash
npx framelia schema --target contract
npx framelia schema --target artifact
```

## Browsing and gating evidence

Run your Playwright suite with `@framelia/playwright`'s Reporter registered (see
[`@framelia/playwright`](../playwright/README.md)) to produce `visual-verification.json` artifacts
under `.framelia/visual-verifications/<test-id>/`. Then, from this CLI:

```bash
npx framelia open \
  --artifact .framelia/visual-verifications/login/visual-verification.json
```

Export a portable static report into an empty directory:

```bash
npx framelia report \
  --artifact .framelia/visual-verifications/login/visual-verification.json \
  --output ./framelia-report
```

Serve the exported directory over HTTP — browsers block report JSON loading through `file://`.

Or browse every artifact under `.framelia/visual-verifications/` at once:

```bash
npx framelia dashboard --project-root "$PWD"
```

Inspect every `actual.png`, `diff.png`, `visual-score.json` for each artifact. A passing artifact
does not replace image inspection.

Then run the independent integrity gate:

```bash
npx framelia done-gate \
  --artifact .framelia/visual-verifications/login/visual-verification.json
```

`done-gate` reparses the persisted artifact from disk and never trusts an in-memory verdict — it
checks evidence freshness, hash integrity, and that every contract's result actually passed.

## Diagnosis commands

```bash
npx framelia fetch-gold --file-key abc123 --node-id 153:5181 --out figma-gold.png
npx framelia compare --gold figma-gold.png --actual actual.png --out-dir ./diff
```

`fetch-gold` captures one Figma node render for inspection. `compare` diffs two existing PNGs
directly with framelia's compare engine, without resolving a baseline or checking provenance.

## Evidence layout

```text
figma-gold.png
figma-gold.meta.json
actual.png
diff.png
visual-score.json
```

`visual-verification.json` records the exact request, resolved project root, per-contract result,
and output directories.

## Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Command completed and visual verdict passed.                     |
| `1`  | Verification completed, but one or more visual contracts failed. |
| `2`  | Usage, schema, environment, or execution error.                  |

Exit `1` is a valid comparison result, not an infrastructure failure.

## CI example

```yaml
- name: Install Framelia browser
  run: npx playwright install --with-deps chromium

- name: Run Playwright visual matchers
  env:
    FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
    FRAMELIA_FIGMA_FILE_KEY: abc123
  run: npx playwright test # your suite calls toMatchFigma/toMatchPage/toMatchUrl

- name: Gate on persisted evidence
  run: |
    npx framelia done-gate \
      --artifact .framelia/visual-verifications/login/visual-verification.json
```

Upload `.framelia/visual-verifications/` as a CI artifact on failure.

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
