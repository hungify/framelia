---
"@framelia/verify": major
---

Rewrite `@framelia/verify` (v2 rewrite plan, Package 2): gives `AppError` a
real job, replaces the hand-rolled `.env` parser with `dotenv`, reorganizes
`baseline`/`masks` file groups, adds an always-run architecture-boundary
test, and closes six test gaps.

**Breaking changes:**

- Re-exports `CaptureDefaults` instead of `ContractDefaults` from the root
  barrel (`.`), consuming `@framelia/contracts`' Package 1 rename of the
  same name. This is forced by that upstream rename (contracts no longer
  exports the old name at all) but is still a real breaking rename of
  `@framelia/verify`'s own public surface for any consumer that imported
  the `ContractDefaults` type from `@framelia/verify` directly (as opposed
  to re-exporting it from `@framelia/contracts`). Known affected consumers:
  `@framelia/dashboard-server`'s `src/model.ts` and `@framelia/cli`'s
  `src/config.ts` / `src/internal/project-init.ts` / `src/dashboard/
report.ts`; fixing those is tracked as separate downstream work (not part
  of this change), matching how contracts' own changeset treated the same
  situation for its side of the rename.
- `AppError.code` narrows from `string` to a closed `AppErrorCode` union
  (`MISSING_PROJECT_ROOT`, `INVALID_PROJECT_RELATIVE_PATH`,
  `PATH_ESCAPES_PROJECT_ROOT`, `ENV_FILE_ENTRY_INVALID`,
  `ENV_FILE_NOT_FOUND`, `INVALID_HEX_COLOR`, `DIMENSION_MISMATCH`).
  Verified non-breaking in practice: `AppError` was never constructed
  anywhere in this monorepo before this rewrite (confirmed via a full grep
  across `packages/cli`, `packages/dashboard-server`, and
  `packages/playwright`), so no real consumer constructs one with a
  string outside this closed set.

**Non-breaking:**

- The 8 bare `throw new Error(string)` sites (`paths.ts`; `load-env.ts` x5;
  `compare/delta-e.ts`; `compare/png.ts`) now `throw new AppError(code,
message)` instead, with every message preserved verbatim. The dominant
  `FidelityErrorCode`-tagged Result-object convention (`RejectResult`,
  `*Outcome` types) is completely untouched everywhere it already
  applies -- this is not a project to unify the two conventions, which
  represent genuinely different situations (a classifiable domain outcome
  discovered during verification work vs. a precondition violation before
  any verification work started).
- `load-env.ts`'s `applyEnvFile` now delegates value-parsing to
  `dotenv.parse(text)` (parse-only, never `dotenv.config()`, confirmed
  side-effect-free at this call site) instead of a hand-rolled line
  splitter. The existing key-name filter and "never overwrite an
  already-set key" precedence are unchanged. This is a pure widening:
  `.env` files with an `export` prefix, backtick-quoted values, multiline
  double-quoted values, or backslash escape expansion now parse correctly
  where they were previously silently mishandled -- pinned with new
  fixture tests. `dotenv` is the one new real dependency this rewrite adds.
- File reorganization, invisible to consumers since `package.json`'s
  `exports` field has no subpaths into these files (only `.`, `./cli`,
  `./internal`, whose re-exported names are unchanged): `baseline.ts` ->
  `baseline/provider.ts`, `fetch-baseline.ts` -> `baseline/figma-fetch.ts`,
  `page-baseline.ts` -> `baseline/page.ts`, `promote-page-baseline.ts` ->
  `baseline/promote-page.ts`, `mask-suggest.ts` -> `masks/heuristics.ts`,
  `suggest-masks.ts` -> `masks/suggest-for-url.ts`.
- New `tests/architecture-boundary.test.ts`, using the TypeScript compiler
  API to inspect real `ImportDeclaration`/`ExportDeclaration` nodes'
  `isTypeOnly` flags (a source-level fact, independent of the
  `verbatimModuleSyntax` tsconfig flag). Enforces that nothing reachable
  from the safe root barrel (`.`) has a real `@playwright/test` import,
  that nothing under `capture/domain/` mentions `@playwright/test` at all
  (folds in the old `scripts/check-domain-boundary.mjs`, now deleted), and
  that nothing under `src/` imports `@framelia/cli`, `@framelia/
dashboard-server`, or `@framelia/playwright`. Runs unconditionally as
  part of `pnpm test`, tightening enforcement versus the old script (which
  only ran via `prepublishOnly`).
- New tests closing six previously-uncovered files: `capture/settle.ts`,
  `capture/readiness.ts`, `capture/reject.ts`, `compare/issues.ts`,
  `artifacts.ts`, `hash.ts`.
