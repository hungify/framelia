---
"framelia": patch
"@framelia/contracts": patch
"@framelia/verify": patch
"@framelia/dashboard-server": patch
"@framelia/playwright": patch
---

The reporter's `runId` option is now trimmed, and a blank value counts as unset: the run falls back to `FRAMELIA_RUN_ID`, then a fresh ID, and a sharded run without either records one bundle per shard instead of sharing a whitespace run ID.

A run ID that starts with `-` after trimming, from either the `runId` option or `FRAMELIA_RUN_ID`, is now rejected when the reporter starts, with an error naming the source and the value. Before, it was accepted and then read as a flag by `framelia ... --run <run-id>`.
