---
"@framelia/verify": patch
"framelia": patch
---

`framelia runs prune` removes the shard records of a sharded run whose every shard completed without a framelia.contract case (once old enough for `--older-than`, never while locked); `listRuns` marks such entries with `emptyShardedRun`.
