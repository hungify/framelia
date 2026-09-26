---
"@framelia/contracts": minor
"@framelia/verify": minor
"framelia": minor
---

Add explicit, transactional migration from legacy `verificationRequestSchema` contracts and their Figma baseline references to the current authored contract schema.

- `framelia contract migrate --dry-run` previews every legacy contract's proposed target route (derived from the legacy request URL, with the removed origin reported separately), required project matrix, and baseline resolution, reporting every blocker -- missing route, unresolved projects, unresolved baseline -- without any write or Figma fetch.
- The same command without `--dry-run` performs the migration: it preserves contract IDs, names, masks, and reviewed threshold/style-tolerance overrides; drops the legacy per-contract `outDir` now owned by runs; and requires either an already-published pinned snapshot digest or an explicit Figma baseline refresh -- legacy cached PNGs are never auto-approved.
- An explicit `--map` JSON file (or interactive prompts on a TTY) supplies target path, project matrix, and baseline resolution per legacy contract id; machine mode reports every unresolved field instead of guessing.
- Multi-file replacement (new contract files, published snapshots, and legacy file cleanup) is staged behind a `.framelia/migration.transaction` marker and one project authoring lock, with concurrent-edit detection reusing the existing CAS/`withAuthoringLock` machinery. `contract migrate --recover` deterministically finishes or clears an interrupted transaction; `check` and `contract list` refuse to run while one is pending.
- No implicit migration during `check` -- this is a standalone, previewable command only.
