---
"@framelia/contracts": minor
---

Add the records a sharded direct run is composed from.

- `runPlanFragmentSchema` (`framelia.run-plan-fragment`): the case plans one `--shard=N/M` contributes to a shared run, which may be empty.
- `shardCompletionSchema` (`framelia.shard-completion`): a shard's Playwright result status, global errors, publication diagnostics and the digest of its fragment.
- `runShardSchema`, plus the `RunShard`, `RunPlanFragment` and `ShardCompletion` types.

The run plan, case plan, attempt and run record formats are unchanged.
