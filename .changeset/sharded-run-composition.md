---
"@framelia/verify": minor
---

Compose sharded direct runs into one run bundle and finalize them once.

- `publishPlanFragment` and `publishShardCompletion` publish a shard's immutable plan fragment and completion marker under `.framelia/runs/<run>/shards/<N>-of-<M>/`. `publishAttempt` accepts `{ shard }` to check an attempt against that shard's fragment before the plan is composed.
- `finalizeShardedRun` waits until every shard completed, then under the run lock composes the frozen plan from the union of the fragments in case-ID order and finalizes the run once with the worst shard result status. It is a no-op for a run that is already finalized. Shards that disagree on the shard total, policy or retry policy, or that planned the same case, fail with `RUN_BUNDLE_SHARD_CONFLICT`. A fragment changed after its shard completed fails with `RUN_BUNDLE_DIGEST_MISMATCH`.
- Readers treat an un-composed sharded run as in progress: `readRunPlan` (and so `readSelectedRun`, `readRunBundle` and `evaluateAuthoritativeRun`) throws `RUN_BUNDLE_SHARDS_PENDING`, and `listRuns` lists it as `running` with per-shard progress.
- `buildDirectRunPlan` builds a direct run's subset plan; `inspectShardedRun` reports each shard's records.
