---
"framelia": patch
"@framelia/dashboard-server": patch
---

Rewrite `framelia` (v2 rewrite plan, Package 4): `commands/*.ts` are thin
Stricli declarations, all behavior lives in `src/internal/*.ts` behind one
seam per concern.

**New behavior (`framelia contract create`):**

- Prints a JSON result body (`{ contractId, outputPath, outcome }`) on
  stdout like every other command, and exits `1` when the interview is
  cancelled instead of exiting `0` after a bare `cancel` banner. Cancellation
  is now a returned result (`{ ok: false, body: { cancelled: true } }`), not a
  mutation of `runtime.exitCode` from inside the prompt loop.

**Consolidated seams (no user-visible change):**

- One `PromptAdapter` (`internal/prompts.ts`) for `auth`, `init`, and
  `contract create`, with `internal/clack-prompts.ts` as the only
  `@clack/prompts` callsite and `nonInteractivePrompts` for flag-only runs.
  Cancellation is a single `PROMPT_CANCELLED` sentinel instead of per-cluster
  `isCancel` adapters.
- One `Project` intake (`internal/project.ts`: `root`, `resolve`,
  `loadConfig`) replaces `project-root.ts`, `internal/config.ts`, and the
  scattered `path.resolve(runtime.cwd(), raw ?? ".")` repeats. Config-load
  failures are reclassified to `UsageError` at that one boundary.
- One browser-input rule set (`internal/browser-input.ts`): http(s) target
  URLs, the loopback-only exception for plaintext http when the run carries
  Playwright storage state, and the `--viewport-width`/`--viewport-height`
  pairing rule. `baseline promote` and `contract suggest-masks` now enforce
  the storage-state rule they previously only applied in `auth`, and still
  report every simultaneous flag violation in one message.
- One `CliResult<T>` (`{ ok, body }`) returned by every command; `emitResult`
  no longer takes a caller-computed success predicate, so per-command
  `result.ok && result.fetched` / `result.pass` / `result.done` logic moved
  next to the code that owns the outcome.
- `contract create`'s interview extracted to `internal/contract-interview.ts`
  with injectable `resolveNodeSpec`/`deriveExpectStyle`; `--viewport-name`,
  `--viewport-width`, `--viewport-height` now require `--viewport custom`, and
  `--selector`, `--region-width`, `--region-height` require `--scope region`,
  instead of being silently ignored.
- `framelia dashboard` and `framelia open` share one
  `dashboardDevserverCommand`; URL derivation moved to a pure
  `dashboard/urls.ts` (loopback/wildcard/IPv6 handling, plus the browser-open
  URL), and `DashboardHost` shrank to `startServer`, `networkContext`,
  `openBrowser`, `listenForInput`, `now`, `waitForShutdown`.
- `@framelia/dashboard-server` gains a dependency-free `./constants` entry
  (`DEFAULT_DASHBOARD_PORT`) and `startDashboardServer` now returns
  `hostname`/`port` alongside `url`, so the CLI no longer re-parses its own
  server URL or keeps a hand-synced copy of the default port.
