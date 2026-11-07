---
"@framelia/playwright": minor
"@framelia/verify": minor
---

Harden the Playwright reporter and matchers.

- Attach matcher images as bytes so run-bundle and HTML-report evidence survives `preserveOutput: "failures-only"`/`"never"`; remove stale diff/score files before writing durable evidence.
- Fail direct `playwright test` runs whose annotated tests cannot be recorded (missing `framelia.config.*`, attempt publication or finalization failures). Pass the runner's result status and global error messages to finalization so interrupted/timed-out runs seal `incomplete`; `finalizeRunRecord` gains an additive `resultStatus` option.
- Plan only contract/project pairs a contract (or policy `playwright.projects`) applies to; record sharded direct runs as per-shard bundles (`<run-id>-shard-N-of-M`).
- Key low-level `contractId` evidence by project (multi-project configs) and repeat index; show low-level matcher results alongside the selected run on the live dashboard.
- Execute mode: decide setup/teardown failures from the final test outcome (flaky setup is not a failure) and keep global error text.
- Matchers: per-call `timeout` option; `.not` throws on operational failures instead of passing; unique per-call `toMatchFigma` attachments; failure messages list metrics against thresholds, cluster/area gap and the first blocking issue; `toMatchPageBaseline` honours `--update-snapshots`.
- `defineFigmaTests` derives its capture deadline from the remaining test budget.
