---
paths:
  - "**/*.test.ts"
  - "packages/*/tests/**"
  - "packages/playwright/tests-smoke*/**"
  - "apps/dashboard/tests/**"
  - "**/vitest*.config.ts"
  - "**/playwright*.config.ts"
  - "scripts/consumer-smoke/**"
---

# Testing

New behaviour is written test-first with the `tdd` skill; mutation testing (`mutation-testing` skill) checks the tests at the end of a branch.

| Suite              | Where                                                        | Command (repo root)                                                                    | Notes                                                                                                          |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit / integration | `packages/<pkg>/tests/**/*.test.ts`, `apps/dashboard/tests/` | `pnpm --filter <pkg> test [<path>] [-t '<name>']`                                      | Vitest 4, Node. Tests live in `tests/`, named after the module or topic, never next to the code.               |
| Real browser       | capture/matcher tests in `verify` and `playwright`           | same; needs `pnpm exec playwright install chromium` once                               | Drive a real Chromium page; no mocked `Page`.                                                                  |
| Figma network      | `packages/verify/tests/integration/`                         | `pnpm --filter @framelia/verify test:integration`                                      | Opt-in, needs a live `FIGMA_ACCESS_TOKEN`; excluded from `pnpm test` and CI.                                   |
| Playwright smoke   | `packages/playwright/tests-smoke*/`                          | `pnpm --filter @framelia/playwright test:smoke` (`:define-figma-tests`, `:run-bundle`) | Builds the package chain first; exercises the Reporter and matchers end to end.                                |
| Consumer smoke     | `scripts/consumer-smoke/`                                    | `pnpm test:consumer`                                                                   | Packed tarballs installed into a throwaway consumer; CI runs it across Node, npm/pnpm and Playwright versions. |

Package `<pkg>` names: `@framelia/contracts`, `@framelia/verify`, `@framelia/dashboard-server`, `@framelia/playwright`, `framelia` (cli), `@framelia/dashboard`.

- Pass the file and `-t` straight after the script name (`pnpm --filter @framelia/verify test tests/hash.test.ts -t '…'`); with a `--` in between, Vitest drops the filters and runs the whole suite.
- Workspace siblings resolve from source through the `framelia-dev` condition, so most suites need no build. Exceptions: `framelia` and `@framelia/dashboard-server` have a `pretest` that builds (the cli tests spawn the built `bin`); run them through `pnpm --filter <pkg> test`, not bare `vitest`.
- Test at the package's public surface: exported functions, the CLI as a process (`spawnSync` on the bin, `tests/fake-process.ts`), the Reporter through Playwright. Mock only what crosses the machine boundary (the Figma HTTP API via an injected `fetch`, the clock); never our own modules.
- Filesystem state goes in a fresh `fs.mkdtempSync(path.join(os.tmpdir(), "framelia-<topic>-"))` directory, removed in `afterEach`. Shared fixtures live in `tests/fixtures/`; PNGs come from `makeSolidPng` (`@framelia/verify/testing`).
- Expected values are literals or worked examples (known digests, known pixel counts), never recomputed with the code under test.
- Invariant tests (`architecture*.test.ts`, `public-api.test.ts`, `check:zero-deps`) are part of the design: change them only together with the architecture decision they pin.
- Names: a present-tense sentence about the observable behaviour, naming the trigger: `it("rejects a stale lock whose owner PID is no longer alive")`, `it("formats as sha256:<hex> and matches the file's own content hash")`. Use `describe` for the unit under test (the exported function, the command) and nested `describe("when …")` for a shared precondition.
