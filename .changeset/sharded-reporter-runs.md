---
"@framelia/playwright": minor
---

Record every shard of a sharded direct run into one run bundle.

With a shared run ID (`FRAMELIA_RUN_ID`, or the reporter's `runId` option), each `npx playwright test --shard=N/M` publishes its cases as a plan fragment, publishes its attempts, and on exit records its completion. The last shard to complete composes the plan and finalizes the run once. A shard with no contract test still records an empty fragment. Until then the live dashboard shows only low-level matcher results. Without a shared run ID, shards keep recording one bundle each, and the warning now says how to set `FRAMELIA_RUN_ID`.
