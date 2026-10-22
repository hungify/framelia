---
paths:
  - "packages/**/*.ts"
  - "apps/dashboard/**/*.ts"
  - "apps/dashboard/**/*.vue"
  - "scripts/**/*.{ts,mjs}"
---

# Code style

Oxlint (`.oxlintrc.json`) runs first and owns the general and TypeScript rules; ESLint (`eslint.config.ts`) adds only what Oxlint lacks (Vue templates and a11y, Vitest/Playwright structure, regex correctness, disable-comment hygiene) and turns off everything Oxlint covers; Oxfmt (`.oxfmtrc.json`) formats and sorts imports. `lint-staged` runs all three on commit. Fix what they report. A disable comment names one rule and gives its reason after `--`; both linters read `eslint-disable` comments. The few per-file overrides in `.oxlintrc.json` (`no-await-in-loop` for sequential capture and prompts) are deliberate; add one only with the same kind of reason. What lint cannot tell you:

- ESM only. Node built-ins as namespace imports with the `node:` prefix: `import * as fs from "node:fs"`. Zod v4 as `import * as z from "zod"`.
- In `packages/*`, relative imports carry the `.ts` extension (`from "./hash.ts"`); `verbatimModuleSyntax` is on, so type-only imports use `import type` or inline `type` modifiers. `apps/dashboard` imports without extensions (Vite).
- `strict` and `noUncheckedIndexedAccess` are on: handle the `undefined` from indexing instead of asserting it away with `!` or `as`.
- Wire shapes (contracts, run bundles, dashboard payloads, events) are zod schemas in `@framelia/contracts`; derive the type with `z.infer` next to the schema instead of declaring a parallel interface.
- Expected failures in `@framelia/verify` are `AppError` (or the capture-side `FidelityErrorCode`) with a code from the union in `packages/verify/src/types.ts`; add a new code there rather than throwing a bare `Error` that callers would have to match by message.
- File writes that other processes or a later run read (run bundles, evidence, locks) go through the atomic helpers in `packages/verify/src/fs-atomic.ts`.
- Name things with the domain vocabulary (`CONTEXT.md` when present, otherwise the package README): contract, baseline, capture, run bundle, attempt, evidence.
