---
"@framelia/playwright": minor
---

Rewrite `@framelia/playwright` (v2 rewrite plan, Package 4): consolidates
duplicated attach/attachJson closure construction, converts the four
registered matcher wrappers to a single factory, and narrows the package's
real `@playwright/test` import surface from six files to two.

**New (additive, minor):**

- New `"./create-matchers"` export subpath, exporting
  `createFrameliaMatchers(test: PlaywrightTestHandle)`: a factory taking an
  already-resolved Playwright `test` handle (a `type`-only Playwright
  import, erased at compile time -- never touching module resolution) and
  returning the four matcher implementations (`toMatchFigma`, `toMatchPage`,
  `toMatchPageBaseline`, `toMatchUrl`), ready to pass to `expect.extend()`.
  This is a real, tested, code-level fix for Playwright's hard "second
  `@playwright/test` instance" crash, which a prior fix (#60) only patched
  for this repo's own internal example by folding it into the root pnpm
  workspace so pnpm dedupes the install -- it made zero code changes to this
  package, so the structural gap remained for any real external consumer
  outside that exact workspace topology. An affected consumer now wires
  their own already-loaded `test` in directly:

  ```ts
  import { expect as baseExpect, test } from "@playwright/test";
  import { createFrameliaMatchers } from "@framelia/playwright/create-matchers";

  export const expect = baseExpect.extend(createFrameliaMatchers(test));
  ```

  which structurally removes the second-resolution path, rather than
  depending on workspace topology. Proven end-to-end under a real Playwright
  worker in `tests-smoke/create-matchers.spec.ts`.

**Non-breaking:**

- `index.ts`'s `expect` export and `register.ts`'s side-effect registration
  are rebuilt on top of `createFrameliaMatchers`, but both files still
  import `@playwright/test` for real at module scope -- a verified,
  unavoidable limit of Playwright's extension model, not a design gap:
  `expect.extend()` must return a synchronously usable object because spec
  files call `expect(...)` inline, so these zero-config entry points cannot
  defer resolving `@playwright/test`. `register.ts`'s registered matcher set
  (`toMatchFigma`/`toMatchPage`/`toMatchUrl`, not `toMatchPageBaseline`) is
  unchanged from before this rewrite.
- This narrows the package's real `@playwright/test` import surface from
  six files (all four matcher files plus `index.ts`/`register.ts`) to
  exactly two (`index.ts`/`register.ts` only) -- confirmed via grep. A
  rejected alternative (inspecting `require.cache` to detect/reuse an
  already-loaded instance) was considered and deliberately not implemented:
  it would violate this codebase's own "no internal APIs" principle and be
  fragile across Playwright versions.
- `attach`/`attachJson` `TestInfo` closure construction, previously
  duplicated identically across all four matcher wrapper functions
  (`to-match-figma.ts`, `to-match-page.ts`, `to-match-url.ts`,
  `to-match-page-baseline.ts` -- the original survey found only two of the
  four), is now one `buildAttachContext(testInfo)` helper in `src/attach.ts`.
- The four matcher files (`to-match-figma.ts`, `to-match-page.ts`,
  `to-match-url.ts`, `to-match-page-baseline.ts`) now export only their
  runner-agnostic `run*` cores plus option/context types; the registered
  wrapper functions that used to live alongside them moved into
  `create-matchers.ts`.
- New `tests/public-api.test.ts` snapshots the exact runtime export-name
  set of all four entry points (`.`, `./register`, `./reporter`,
  `./create-matchers`); new `tests/attach.test.ts` covers
  `buildAttachContext`/`attachDiffTriplet`/`sanitizeAttachmentBaseName` in
  isolation.
