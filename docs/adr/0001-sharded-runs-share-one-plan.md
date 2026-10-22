---
status: accepted
---

# Sharded direct runs share one plan and finalize once

A sharded direct run (`npx playwright test --shard=N/M` with the Framelia Reporter) records into
one run bundle when every shard gets the same run ID (`FRAMELIA_RUN_ID` or the reporter's `runId`
option). No shard knows the whole plan: in Playwright 1.62 the reporter's `onBegin` suite holds only
the current shard's tests, and `config.shard` is `{ current, total }`. So each shard publishes its
case plans as an immutable **plan fragment** (`shards/<N>-of-<M>/plan/fragment.json`) and its
attempts as usual. When it ends, it publishes a **shard completion** marker
(`shards/<N>-of-<M>/completion/completion.json`) with its `FullResult` status, global errors,
publication diagnostics and the digest of its fragment. Under the run lock, the shard that finds
all `M` fragments and completion markers composes the frozen plan (the union of the fragments in
case-ID order) and finalizes the run once, with the worst shard result status. Otherwise it leaves
the run open and says which shards it waits for. When shards run on separate machines,
`framelia runs finalize --run <id>` runs the same step after the shards' run directories have been
merged into one checkout.

We chose this over merging per-shard bundles afterwards (`framelia runs merge`). Each shard's bundle
would freeze its own `RunPlan`, finalize its own `run.json`, and stamp its own run ID into every
case plan and attempt. A merge would have to rewrite those immutable, digest-bound records, or add a
second kind of run that every reader and `done-gate` would have to handle. With one shared run ID
from the start, the composed bundle is an ordinary run: the plan and run formats are unchanged,
readers need no merge logic, and `done-gate` keeps its digest checks.

## Consequences

- Until it is composed, a sharded run has no `plan/` or `run.json`. Readers report it as in
  progress: `readRunPlan` throws `RUN_BUNDLE_SHARDS_PENDING`, and `runs list` shows it as `running`
  with per-shard progress. Once composed it reads like any direct run (`selection.mode: "subset"`).
- The run ID must be unique per CI run, including re-runs. Published units are immutable, so a
  reused ID is refused rather than merged.
- Composition rejects shards that disagree on the shard total, policy or retry policy, or that
  planned the same case (`RUN_BUNDLE_SHARD_CONFLICT`). It also rejects a fragment that changed
  after its shard completed (`RUN_BUNDLE_DIGEST_MISMATCH`).
- A shard with no applicable contract case still publishes an empty fragment, so a shard that never
  ran is never mistaken for an empty one. If no shard planned a case, nothing is recorded.
- A shard that crashes before its completion marker leaves the run waiting. It is never finalized
  from partial shards.
- Sharded runs without a shared run ID keep the old behaviour: one bundle per shard, with a
  `-shard-<N>-of-<M>` suffix and a warning. `framelia check` is not sharded.
- Playwright 1.62 added `Reporter.preprocess`, which sees the un-sharded suite. It could later let
  each fragment also record the full expected case list. We don't rely on it because the supported
  peer range starts at 1.61.
