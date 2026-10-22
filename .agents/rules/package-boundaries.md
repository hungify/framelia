---
paths:
  - "packages/*/src/**"
  - "packages/*/package.json"
  - "packages/*/tsup.config.ts"
  - "apps/dashboard/**/*.ts"
  - "apps/dashboard/**/*.vue"
  - "apps/dashboard/package.json"
---

# Package boundaries

The dependency graph points one way: `contracts -> verify -> dashboard-server -> playwright / cli`, and `contracts -> dashboard`. A change that needs an import against that direction belongs in a lower package, or behind an interface the lower package defines.

| Package                      | May depend on (workspace)                                                                            | Guarded by                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@framelia/contracts`        | nothing; `zod` is its only runtime dependency                                                        | `pnpm --filter @framelia/contracts check:zero-deps`                                                                                          |
| `@framelia/verify`           | `contracts`; never `hono`, `cli`, `playwright`                                                       | `packages/verify/tests/architecture-boundary.test.ts` (also: `capture/domain/**` never imports `@playwright/test`)                           |
| `@framelia/dashboard-server` | `contracts`, `verify`; owns `hono` / SSE                                                             |                                                                                                                                              |
| `@framelia/playwright`       | `contracts`, `verify`; `@playwright/test` and `dashboard-server` are **peer** deps (consumer's copy) | `public-api.test.ts`                                                                                                                         |
| `framelia` (cli)             | `contracts`, `verify`, `dashboard-server`                                                            | `packages/cli/tests/architecture.test.ts`: heavy modules (`playwright`, `dashboard-server`, `@clack/prompts`) load lazily through `import()` |
| `@framelia/dashboard`        | `contracts` only (schemas and types)                                                                 |                                                                                                                                              |

When a boundary test fails, move the code; extend the test's allow-list only when the new edge is a deliberate architecture decision (record it as an ADR in `docs/adr/`).

## Public surface

Each package exposes curated subpath exports; everything else is internal.

- Adding a subpath takes three edits together: the `exports` entry in `package.json` (`"framelia-dev": "./src/<file>.ts"`, then `types`, then `default` from `dist/`), the matching `entry` in `tsup.config.ts`, and an assertion in the package's `tests/public-api.test.ts`.
- `framelia-dev` is a custom condition (tsconfig `customConditions`, vitest `resolve.conditions`) that resolves workspace siblings to source, so tests and typecheck never need a sibling build. Published consumers get `dist/`.
- `framelia` re-exports `@framelia/contracts` and `@framelia/verify` as the compatibility package; keep its re-exports in step when those surfaces change.
- `@framelia/verify/testing` is published test support for downstream packages, not production API.
