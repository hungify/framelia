---
"@framelia/verify": minor
"@framelia/playwright": patch
"framelia": patch
---

Compute the dashboard's selected-run projection once per run change.

- `@framelia/verify/run-bundle` exports `cacheSelectedRunProjection(root, runId, project)`. It reruns `readSelectedRun` (which reads and hashes every evidence file) and `project` only when the run changes: run.json is rewritten, or, while the run is still running, a new attempt is published. A terminal run with an unchanged run.json is served from the cache after one `stat`.
- The CLI dashboard source (`selectedDashboardSource`) and the Reporter's dashboard source use it, so `snapshot()` and `files()` share one projection instead of each reading the whole run on every call. A newly published attempt still shows up on the next call.
