---
"@framelia/contracts": major
---

Rewrite `@framelia/contracts` (v2 rewrite plan, Package 1): reorganizes the
package internals, adds a test suite, and makes two breaking changes to the
public API.

**Breaking changes:**

- `ContractDefaults` / `contractDefaultsSchema` are renamed to
  `CaptureDefaults` / `captureDefaultsSchema`. The old name was actively
  misleading -- this schema is Framelia's project-wide capture-tuning
  defaults, not a per-contract default. Consumers (`@framelia/cli`,
  `@framelia/verify`) need to update their imports; that follow-up is
  tracked separately and is not part of this change.
- 11 confirmed zero-consumer exports are removed from the public surface
  (verified via a full-monorepo grep, including the sibling test suites,
  before removal): `AUTH_STATE_RELATIVE_PATH`, `MAX_COOKIES`,
  `MAX_NAVIGATION_ACTIONS`, `componentProfileSchema`, `styleCheckPointSchema`,
  `VerificationPhase`, `DashboardPhase`, `ComparisonSummaryInput`,
  `ProjectCaptureInput`, `DashboardVerdictInput`, and
  `ContractResultAssemblyInput`. (The rewrite plan's prose named a 12th
  export, a 5th `*Input` parameter type, that does not actually exist in the
  source -- only 4 `*Input` types were found and removed.) None of these had
  any consumer anywhere in the monorepo; they remain as unexported internals
  in their source module where still used there. `StyleCheckPoint` (the
  inferred type) is **not** removed -- it has real external consumers in
  `@framelia/cli` and `@framelia/playwright`, even though the underlying
  `styleCheckPointSchema` runtime schema itself was unused and is removed.

**Non-breaking:**

- `index.ts` is now a curated named-export barrel instead of `export *`,
  which is the enforcement mechanism for the above: only names actually
  re-exported from `index.ts` are part of the public API going forward.
- Internal reorganization only, invisible to consumers since
  `package.json`'s `exports` field has no subpaths: `contract.ts` ->
  `visual-contract.ts` (identifiers unchanged), `contract-defaults.ts` ->
  `capture-defaults.ts`, `dashboard.ts` split into `dashboard/types.ts` +
  `dashboard/projections.ts`.
- New `src/shared/unique-ids.ts` (`assertUniqueIds`) replaces duplicated
  array-uniqueness refinement logic previously inlined in both
  `request.ts` and `artifact.ts`.
- New `src/schema-version.ts`: `MIN_SUPPORTED_SCHEMA_VERSION`,
  `checkSchemaVersionSupport`, `migrateToCurrentSchema` + an empty
  `MIGRATIONS` registry (scaffolding for the next schema version bump, a
  no-op today), and additive `dashboardRunSchema` / `dashboardEventSchema`
  (currently inert -- `@framelia/dashboard-server` opting in is future work).
- New `scripts/check-zero-deps.mjs`, wired into `prepublishOnly`, fails the
  build if `package.json`'s `dependencies` ever contains anything but `zod`.
- Added a `vitest` test suite (239 tests) covering every schema's
  `superRefine` invariants, every regex pattern, round-trip parse/serialize,
  `toJsonSchema`'s `io: "input"` pinning, every `score.ts` `.catch()`
  degradation branch, the `dashboard/` module's pure projection functions,
  and a `tests/public-api.test.ts` export-set snapshot.
