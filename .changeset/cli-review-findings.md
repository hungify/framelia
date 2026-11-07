---
"framelia": minor
"@framelia/verify": minor
---

Make every CLI failure a structured, actionable outcome, add run discovery, and tidy help.

- Exit codes: a non-ok result without an explicit code now exits `2` (operational), so only a completed visual mismatch exits `1`. `compare` exits `2` for a missing or unreadable PNG.
- Structured failures: `capture`, `contract suggest-masks`, `baseline promote`, `auth`, `dashboard`/`open` (before readiness), `init` and every contract command report input and operational failures as one JSON outcome (`formatVersion`, `kind`, `command`, `executionState: "error"`, `exitCode: 2`, `diagnostics`, `next`) instead of stderr. `suggest-masks`/`baseline promote` keep their previous top-level `error`/`message` fields.
- Error codes are preserved end to end: config errors keep `INVALID_PROJECT_CONFIG`/`MULTIPLE_PROJECT_CONFIGS`/..., `check` reports `UNKNOWN_CONTRACT_ID`, `CHECK_SELECTION_INVALID`, `FRAMELIA_REPORTER_MISSING`, `CHECK_CANCELLED`, ...; a Figma acquisition failure without a token is `FIGMA_TOKEN_MISSING`. Each code maps to a `next` command (`init`, `status`, `contract list`, `runs list`, ...) that keeps `--project-root`.
- `done-gate` emits `diagnostics` (`issues` stays as a deprecated alias with the same entries), includes the sanitized cause of an unreadable bundle, and no longer always suggests `check --all`.
- `schema --target contract` prints the authored contract schema (`formatVersion`, `kind`, `id`, ...), not the legacy verification request.
- `status` loads and validates the config and reports readiness checks (config, `playwright` block, the project's `@playwright/test/cli`, `FIGMA_ACCESS_TOKEN`); a failed check exits `2`.
- New `framelia runs list` and `framelia runs prune --keep <n> / --older-than <age> [--dry-run]` (never removes in-progress or locked runs). Bare `framelia` now lists runs instead of failing on a missing `--run`. `@framelia/verify/run-bundle` exports `listRuns()`.
- `check --run-id-file <path>` and, under GitHub Actions, the `run-id` step output expose the durable run ID as soon as the run starts.
- `check` Ctrl+C: the first press forwards `SIGINT`; the second sends `SIGTERM` and `SIGKILL`s only after a grace period (so Playwright can stop its `webServer`); with no child running it exits immediately. On Windows the console delivers Ctrl+C itself and a second press terminates Playwright.
- `init` writes a `playwright` block for an existing Playwright config (detected project names, or a `TODO`), adds `.framelia/runs/.gitignore`, and suggests `contract list`.
- `auth` emits a JSON outcome and fails fast without an interactive terminal. `baseline promote` and `contract suggest-masks` default `--storage-state` to the recorded `storageStatePath` (only for https or loopback URLs); `suggest-masks` gains `--project-root`.
- `report` builds into a sibling directory and swaps it in, so a failed export keeps the previous report. `dashboard`/`open` never open a browser when `CI` is set.
- `@framelia/verify`'s `recordStorageState` writes the session file `0600` and creates its directory `0700`.
- Help: every command has a description with examples, `-h` skips project `.env` loading like `--help`, and short aliases now have one meaning across the CLI. Removed conflicting aliases (use the long flags): `dashboard`/`open` `-H` (`--host`), `-o` (`--no-open`), `-p` (`--port`); `capture` `-s` (`--scale`), `-c` (`--canvas-fill`); `compare` `-p` (`--profile`); `schema` `-t` (`--target`); `contract create` `-s` (`--scope`); `baseline promote` `-k` (`--key`), `-c` (`--selector`), `-f` (`--full-page`), `-b` (`--promoted-by`), `-n` (`--note`).
