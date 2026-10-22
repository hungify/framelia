# Packages are deep modules

Each workspace package here hides a lot of behaviour behind a small interface. Its **entry points**
are the files its `package.json` `exports` map points at; everything else in the package is private.
`pnpm lint:boundaries` (dependency-cruiser, `.dependency-cruiser.cjs`, part of `pnpm validate`)
enforces it.

```text
packages/<name>/
  package.json        "exports": { ".": { "framelia-dev": "./src/index.ts", ... } }
  src/index.ts        ← entry point (public). A package may expose several: src/client.ts, ...
  src/lib/…           ← implementation: private, free to import each other.
  tests/…             ← tests and fixtures: private to tests.
```

Copy `packages/example/` to start a new package: one entry point (`src/index.ts`) delegating to
private code (`src/lib/slug.ts`), and a test that drives the entry point.

**Expose several small entry points, not a barrel.** Add an entry point by adding a file and its
`exports` entry (plus the `tsup.config.ts` entry and a `tests/public-api.test.ts` assertion for a
published package). Re-exporting a whole subtree through one `index.ts` makes the interface as wide
as the implementation.

## The rules

**Entry-point boundary.** Code outside `packages/` (the dashboard app, scripts) and every other
package import a package only through its entry points, by package name (`@framelia/verify/run-bundle`),
never a path into its files.

**Intra-package freedom.** A package's own files, tests included, import each other freely.
Unlike the upstream `setup-ts-deep-modules` convention, tests may unit-test their own package's
private modules (as Nx and Turborepo boundaries allow); prefer the entry point when it already
exports what the test needs.

**Tests stay private.** Only tests import from a package's `tests/` folder.

**No cycles.** No dependency cycles, type-only imports included.

Which package may depend on which (`contracts -> verify -> dashboard-server -> playwright / cli`)
is a separate rule: see `.agents/rules/package-boundaries.md`.
