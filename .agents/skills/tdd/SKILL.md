---
name: tdd
description: Test-driven development for this repo (contracts, verify, dashboard-server, playwright, cli, dashboard) - red, green, refactor with one isolated subagent per phase. Use before writing code for any new behaviour or bug fix in packages/* or apps/dashboard (feature, CLI command or flag, matcher option, schema field, reproducible bug), or when asked for red-green-refactor. Not for config, docs, dependency bumps, generated files or behaviour-preserving refactors.
---

# TDD (red, green, refactor)

You orchestrate and verify; three subagents do the work so each phase sees only what it should:

| Phase    | Subagent          | Sees                                       | May edit                      |
| -------- | ----------------- | ------------------------------------------ | ----------------------------- |
| RED      | `tdd-test-writer` | the behaviour, existing code               | tests and test infrastructure |
| GREEN    | `tdd-implementer` | the failing test and its output            | everything except tests       |
| REFACTOR | `tdd-refactorer`  | the files GREEN changed, the passing tests | everything except tests       |

The test writer never sees a planned implementation, so the test describes behaviour instead of code that already exists in someone's head. `.claude/hooks/tdd-guard.mjs` enforces the edit column (test paths: `*.test.ts`, `packages/*/tests/**`, `apps/dashboard/tests/**`, `packages/playwright/tests-smoke*/**`, vitest/playwright configs, `scripts/consumer-smoke/**`). Write neither tests nor production code yourself while this skill runs.

## 0. Frame (you)

1. Read `CONTEXT.md` and the ADRs in `docs/adr/` that touch the area (when they exist) so behaviour and test names use the domain vocabulary.
2. Write the behaviour as acceptance criteria (Given / When / Then) and split it into slices: one observable behaviour per cycle (`check rejects a contract id that matches no test`, `the run bundle records the retry that explained the exit`). Start with the simplest happy path (tracer bullet), then errors and edge cases. Finish a slice before starting the next.
3. Pick the package and seam per slice from `.agents/rules/testing.md`: the lowest package that owns the behaviour (`.agents/rules/package-boundaries.md`), tested at its public surface: an exported function, the CLI as a process, the matcher or Reporter through Playwright, a dashboard `lib/` function or composable. A bug fix gets a test at the seam where the user sees the bug, reproducing it.
4. Contract first. When a slice changes a wire shape, run the `@framelia/contracts` slice (schema + `public-api.test.ts`) before the producer (verify / dashboard-server / cli) and the consumer (dashboard) slices.

## 1. RED: `tdd-test-writer`

Delegate with: the acceptance criteria of this slice, the package and test file path, and pointers to the existing code the test drives (exported functions, commands, fixtures). Leave out how to implement it.

Then verify yourself; the report is a claim, the test run is the evidence:

- Run the test (commands below). It must **fail**, and fail for the expected reason: an assertion about the missing behaviour, or an export that does not exist yet. A syntax error, a typo, a broken fixture or a wrong path to existing code is not RED: send it back.
- It passes already? The behaviour exists: tell the user and drop or rewrite the slice.
- It is not one of the bad tests in [tests.md](references/tests.md): coupled to the implementation (fails the swap test) or tautological (expected values from the code under test).

## 2. GREEN: `tdd-implementer`

Delegate with: the test file path, the RED command and its failure output. The test is the specification; nothing else.

Then verify yourself:

- The test passes, and `git diff --stat` shows no change to test files since RED.
- The package is still green and clean: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`, `pnpm lint`.

## 3. REFACTOR: `tdd-refactorer`

Delegate with: the files GREEN changed and the test file path. "No refactoring needed" is a valid result. Re-run the GREEN checks afterwards.

## 4. Finish

After the last slice, read the test file as a whole: names follow `.agents/rules/testing.md`, no test depends on another's state, and setup REFACTOR reported as repeated becomes a local helper (delegate that cleanup to `tdd-test-writer`; the tests must stay green). Then run `pnpm validate`. If the change touches the Reporter, matchers or the packed public entrypoints, also run the matching `test:smoke*` script or `pnpm test:consumer`. If a published package's behaviour changed, add a changeset (`.agents/rules/changesets.md`). Once the branch is complete, check the tests with the `mutation-testing` skill (not after every slice). Report each slice: behaviour, test, RED failure, GREEN result, refactor outcome, and the final check output.

## Commands

| What                     | Command (repo root)                                           |
| ------------------------ | ------------------------------------------------------------- |
| one test file            | `pnpm --filter <pkg> test tests/<file>.test.ts`               |
| one test                 | `pnpm --filter <pkg> test tests/<file>.test.ts -t '<name>'`   |
| one package: types, lint | `pnpm --filter <pkg> typecheck`, `pnpm lint`                  |
| everything               | `pnpm validate` (zero-deps, typecheck, test, lint, fmt:check) |

`<pkg>`: `@framelia/contracts`, `@framelia/verify`, `@framelia/dashboard-server`, `@framelia/playwright`, `framelia` (cli), `@framelia/dashboard`.

## Hard lines

- Production code waits for a RED test you have watched fail.
- A wrong test goes back to RED with the reason; GREEN makes the test pass as written.
- One slice per cycle, and every cycle gets REFACTOR's evaluation.
- Invariant tests (`architecture*.test.ts`, `public-api.test.ts`, `check:zero-deps`) change only with the architecture decision they pin.

## References

- [tests.md](references/tests.md): good and bad tests (coupled, tautological, horizontal slicing). RED.
- [deep-modules.md](references/deep-modules.md): test the surface, not the internals; the swap test. RED.
- [refactoring.md](references/refactoring.md): what to refactor under green, one change at a time, when to stop. REFACTOR.
