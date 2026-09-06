---
"@framelia/contracts": minor
"@framelia/verify": minor
"@framelia/playwright": minor
"framelia": minor
---

Clarify package boundaries and migrate consumers to the owning interfaces:

- In `@framelia/contracts`, replace `contractDefaultsSchema` / `ContractDefaults` with `captureDefaultsSchema` / `CaptureDefaults`. Import schemas such as `verificationRequestSchema`, `verificationArtifactSchema`, and `visualScoreArtifactSchema` directly from `@framelia/contracts`, not `@framelia/verify` or `framelia`.
- Import `recordStorageState` from `@framelia/verify/cli`. That entry point also owns the browser-launching `captureAndPromotePageBaseline` and `suggestMasksForUrl` helpers; the Node-only root engine does not load a real `@playwright/test` instance.
- Use the `@framelia/verify/env` leaf export for `loadProjectEnv`, `loadEnvFiles`, and `assertProjectRelativePath` without loading the full verification engine.
- The `framelia` library now exports only configuration and dashboard APIs. Import verification primitives directly from `@framelia/verify` and schemas directly from `@framelia/contracts` instead of relying on CLI re-exports.
- Use `createFrameliaMatchers` from `@framelia/playwright/create-matchers` with the caller's Playwright `test` handle: `baseExpect.extend(createFrameliaMatchers(test))`. This factory avoids resolving a second runtime copy of `@playwright/test`; the root and `/register` entry points remain the zero-config alternatives.
- `framelia contract create` merges new contract IDs into an existing file. `--force` is required only to replace an existing ID, preserving its siblings. A different `target.url` always errors, including with `--force`; use a separate output file for another target.
- Migrate contract viewport objects from `viewport.name` to `viewport.preset`, retaining `width` and `height`.
