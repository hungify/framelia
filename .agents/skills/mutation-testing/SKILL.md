---
name: mutation-testing
description: Check whether the tests of a branch would catch real bugs - Stryker (vitest runner) on the changed TypeScript of each package, manual one-at-a-time mutations in a worktree for .vue files, then kill worthwhile survivors with new tests. Use at the end of a feature branch after the tdd skill's last slice, or when asked for mutation testing, Stryker, mutation score, surviving mutants, weak tests or "are my tests good enough". Not inside each red-green-refactor cycle and not a CI gate.
---

# Mutation testing

Coverage says a line ran; mutation testing says a test would **fail** if that line were wrong. Put a small bug (a mutant) into production code, run the tests: a failing test kills it, a green run means it survived and the tests would miss that bug.

Run it once per feature branch, when the `tdd` slices are done and `pnpm validate` is green: it is too slow for every cycle. It reports; it does not gate CI.

## Scope

Production files changed on the branch: `git diff main...HEAD --name-only -- 'packages/*/src/**' 'apps/dashboard/lib/**' 'apps/dashboard/composables/**' 'apps/dashboard/**/*.vue'`, minus `*.d.ts`, generated files and pure re-export barrels (`index.ts` that only re-exports). Group them by package.

| Code                                                          | Harness                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/*/src/**/*.ts`                                      | **Stryker**, from the package (`pnpm --filter <pkg> test:mutation --mutate <files>`)                                |
| `apps/dashboard/lib/**/*.ts`, `apps/dashboard/composables/**` | **Stryker** (`pnpm --filter @framelia/dashboard test:mutation --mutate <files>`)                                    |
| `apps/dashboard/**/*.vue`                                     | **manual** in a worktree (below): Stryker cannot mutate SFCs that use `defineProps`/`defineModel` (stryker-js#6178) |

## Stryker

All packages share `stryker.config.mjs` at the repo root (each package's `test:mutation` script runs `stryker run ../../stryker.config.mjs` from the package directory, with the package's own `vitest.config.ts`).

| What                                        | Command (repo root)                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| the branch's files in one package           | `pnpm --filter @framelia/verify test:mutation --mutate src/hash.ts,src/fs-atomic.ts` |
| a line range                                | `pnpm --filter @framelia/verify test:mutation --mutate src/hash.ts:10-30`            |
| only what changed since the last run        | `pnpm --filter <pkg> test:mutation --mutate <files> --incremental`                   |
| the runner still kills mutants (CI runs it) | `pnpm test:mutation:smoke`                                                           |

- Always pass `--mutate`: a whole-package run of `verify` or `playwright` takes a long time (their suites drive real Chromium; the dry run alone is about a minute for `playwright`). Expect seconds per file in `contracts`, `dashboard-server` and the dashboard.
- Reports: `<package>/reports/mutation/mutation.json` and `index.html` (git-ignored). Triage from `mutation.json` (each mutant has `status`, `location`, `replacement`, `coveredBy`); re-reading results never needs a re-run.
- `Timeout` counts as detected: a mutant that makes the code hang (a retry loop, a lock that never releases) never reaches an assertion.
- `framelia` (cli): Stryker skips the `pretest` build, and tests that spawn `bin/framelia.js` run the stale `dist/`, so they cannot kill a mutant in `src/`. A survivor covered only by such tests is not proof of a gap; check whether an in-process test (through `CliRuntime` / `tests/fake-process.ts`) covers that path.
- After changing `stryker.config.mjs` or a Vitest config, run `pnpm test:mutation:smoke` first: it fails when the runner stops running tests (every mutant then "survives" without an error).

## Manual mutations (`.vue` files)

You are the harness: change one thing, run the tests that cover it, record the result, put the code back.

Mutate only in a separate git worktree, never in the working tree you develop in: a mutant left behind by an interrupted run still type-checks and lints, so no hook would catch it.

1. Commit the branch's work (the worktree checks out `HEAD`), then create the worktree next to the repo and install into it (fast, from the pnpm store). `WT` below is that path:
   ```bash
   git worktree add --detach ../framelia-mutation HEAD
   pnpm -C ../framelia-mutation install --frozen-lockfile --prefer-offline
   ```
2. Find the covering tests in `apps/dashboard/tests/` (the component's test, or the composable/lib test behind it). Run them once unmutated: they must pass.
3. Read the file and list candidate mutants by priority (below). 5 to 15 per file is enough; skip lines that only wire things up (imports, plain markup).
4. For each mutant, one at a time:
   - apply exactly one change with Edit;
   - run the narrowest command in the worktree: `pnpm -C $WT --filter @framelia/dashboard test tests/<file>.test.ts` (add `-t '<test name>'` when one test is enough);
   - record **KILLED** (a test failed; note which) or **SURVIVED** (all green); a type or compile error counts as killed but tells little, prefer a mutant that still type-checks;
   - `git -C $WT restore <file>` before the next mutant.
5. At the end remove the worktree: `git worktree remove --force $WT`. `git status` in your own tree shows no production change.

### Operators, by priority

| #   | Operator              | Examples                                                                                       |
| --- | --------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Boundary              | `<` to `<=`, `>=` to `>`, `.min(1)` to `.min(0)`, `ratio > threshold` to `ratio >= threshold`  |
| 2   | Boolean logic         | `&&` to `\|\|`, drop a `!`, `v-if="x"` to `v-if="!x"`, `:disabled="pending"` to `false`        |
| 3   | Arithmetic and values | `+` to `-`, a constant or default changed, a status literal swapped (`"passed"` to `"failed"`) |
| 4   | Return and early exit | `return x` to `return undefined`, drop a guard's `return`, `throw` removed                     |
| 5   | Removed statement     | drop `emit(...)`, a cleanup in `finally`, an `fsync`, a lock release, a schema `.parse`        |
| 6   | Error paths           | `catch` body emptied, `AppError` code swapped, a rejection turned into a resolve               |

## Triage every survivor

Ask first: is there **any** input for which the mutant behaves differently (returns, writes, prints, exits or renders differently)? If none, it is **Equivalent**: write the one-line reason and move on. Otherwise:

| Result                | Meaning                  | Action                                   |
| --------------------- | ------------------------ | ---------------------------------------- |
| Killed (or timeout)   | a test failed            | none                                     |
| Survived              | tests stayed green       | kill it, or defer it with a named reason |
| NoCoverage / no tests | no test runs this code   | a gap (cli: see the `dist/` note above)  |
| Equivalent            | no observable difference | none, record the reason                  |

Kill first what consumers and run integrity depend on: gate verdicts and thresholds, digest and identity checks, schema validation boundaries, run-bundle publication and locking, error codes callers branch on, data loss on failure paths. Ask the user (one question with concrete options) when the right behaviour is unclear or the test would be brittle.

## Kill survivors (test-first)

A killing test is a behaviour test that fails against the mutant and passes against the original:

1. Re-apply the mutant in a worktree (Stryker: its `replacement` from `mutation.json`).
2. Delegate to `tdd-test-writer` (as in the `tdd` skill's RED) with the behaviour the mutant breaks as Given / When / Then, the package and the test file in your own tree. Follow `.agents/skills/tdd/references/tests.md`: assert what the caller observes, not the line that was mutated.
3. Verify yourself: copy the test file into the worktree, where it must fail against the mutant; in your own tree (original code) it must pass.
4. Re-run only that mutant (`--mutate <file>:<line>`, or apply it by hand again).

Then run `pnpm validate`.

## Score and report

Score = (killed + timeout) / (all mutants - equivalent). Bands: below 60 % weak, 60 to 80 % moderate, 80 to 90 % good, above 90 % strong. Treat it as a signal for this branch, not a target to game.

Report per file:

```md
## Mutation testing: <branch or feature>

| File                             | Harness | Mutants | Killed | Survived | Equivalent | Score |
| -------------------------------- | ------- | ------- | ------ | -------- | ---------- | ----- |
| packages/verify/src/fs-atomic.ts | Stryker | 24      | 21     | 2        | 1          | 91 %  |

### Survivors

| File:line       | Mutation                   | Verdict                   | Action                                |
| --------------- | -------------------------- | ------------------------- | ------------------------------------- |
| fs-atomic.ts:42 | removed `fsyncDirectory()` | killed by new test        | `survives a crash after the rename …` |
| score.ts:17     | `>= 0` to `> 0`            | equivalent: input is >= 1 | none                                  |
| X.vue:30        | `v-if="error"` to `!error` | deferred: <reason>        | ask / follow-up                       |
```

## Hard lines

- Mutate production code only in the worktree, one mutant at a time, restored after every run.
- A killing test asserts observable behaviour, never the mutated line or a private helper.
- Re-check one file with `--mutate`, never a whole-package run.
- No `thresholds.break` or CI gate on the score before the team agrees on a baseline. CI only runs `pnpm test:mutation:smoke`, which checks that Stryker still runs tests, not how good they are.
