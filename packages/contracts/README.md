# @framelia/contracts

Versioned Zod schemas and shared wire types for authored contracts, pinned snapshots, collection,
case/run plans, attempts, finite command outcomes, legacy verification artifacts, dashboard
projections, and live progress events.

```ts
import {
  authoredContractSchema,
  baselineSnapshotSchema,
  collectionManifestSchema,
  runPlanSchema,
} from "@framelia/contracts/workflow";
```

This package has no dependency on capture, comparison, server, or UI code.

Workflow records use independent `formatVersion` constants. Digest fields are algorithm-tagged
`sha256:<lowercase-hex>` values; `@framelia/verify` provides canonical JSON serialization and
digesting with recursively sorted object keys and preserved array order.
