---
"framelia": minor
---

Add `framelia runs finalize --run <id>` for sharded runs whose shards ran on separate machines.

After every shard's `.framelia/runs/<run>` directory is collected into one checkout, it composes and finalizes the run and emits a `framelia.runs-finalize-outcome`. It exits `2` with `RUN_SHARDS_MISSING` and lists the missing shards while any shard is absent or unfinished. A finalized run is left unchanged. `done-gate`, `open` and `report` report an un-composed sharded run as `RUN_BUNDLE_SHARDS_PENDING`, pointing at `framelia runs list`.
