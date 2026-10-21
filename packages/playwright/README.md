# @framelia/playwright

Playwright custom matchers for Figma-to-web and web-to-web visual comparison.

```bash
npm install --save-dev @framelia/playwright @playwright/test
```

`@playwright/test` is a peer dependency. Package shares consumer's `expect` instance.

Public entry points (`.`, `/register`, `/reporter`, `/create-matchers`) ship JavaScript
and TypeScript declarations. Ordinary Playwright collection in ESM and CommonJS
projects does not require `NODE_OPTIONS`, `tsx`, or a Framelia-specific loader.
Playwright itself still handles the consumer's TypeScript configuration and tests.

For the CLI and reporter dashboard workflow, install the three public packages:

```bash
npm install --save-dev framelia @framelia/playwright @playwright/test
```

The optional dashboard peer is supplied by the CLI's dependency graph. A matcher-only
consumer does not need the CLI or dashboard package.

## Quickstart

Framelia owns capture and comparison. Your Playwright test owns navigation, auth, and interaction.

Set Figma credentials:

```bash
export FIGMA_ACCESS_TOKEN="..."
export FRAMELIA_FIGMA_FILE_KEY="..."
```

Register matchers with typed `expect`:

```ts
import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test("login matches Figma", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/login");
  await expect(page).toMatchFigma("153:5181");
});
```

Or import `@framelia/playwright/register` once from test setup.

Register Reporter in `playwright.config.ts` for live dashboard events and immutable selected-run
evidence:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

```bash
npx playwright test
npx framelia open --project-root "$PWD" --run <run-id>
```

For each `framelia.contract`-annotated case, the Reporter freezes its authored contract, pinned
baseline, project/repeat identity, resolved policy, registration digest, retry policy, and
policy-selected stability sample count in a `CasePlan`. Every attempt remains under
`.framelia/runs/<run-id>/`; finalization records which attempt was selected without deleting retry
history.

### Shared project policy

The reporter resolves `framelia.config.*` through the same project-policy module as the CLI.
Programmatic Playwright integrations can import `resolveProjectPolicy`,
`discoverAuthoredContracts`, and `resolveContractProjectMatrix` from
`@framelia/playwright/project-policy`. Contract/project pairs are resolved from authored policy,
not inferred from whatever tests collection happens to return.

### Coordinated `framelia check`

`framelia check` uses the public Reporter and ordinary Playwright CLI in two explicit phases. A
private `FRAMELIA_RUN_CONTEXT` file identifies the mode and frozen run paths:

1. Collection runs Playwright's documented `--list`. In `onEnd`, the Reporter atomically publishes
   a versioned manifest from documented project, file-Suite, title-path, repeat, dependency, and
   teardown metadata. It does not start the dashboard or publish evidence.
2. The parent freezes one authoritative selection and invokes Playwright with an exact
   `--test-list`. The Reporter synchronously reconciles the recollected graph in `onBegin` and
   publishes `ready`; each generated visual body re-reads that gate as its first operation, before
   `prepare`, viewport changes, or capture. `onEnd` publishes a separate completed lifecycle
   summary after every attempt publication settles.

The exact list uses Playwright's documented tuple—`[project] › file-suite › full title path`, or
the same line without a project prefix for the unnamed project. Generated titles are
`[exact.contract.id] Human name`, so contracts registered from one source remain independently
selectable even when their human names are identical. `defineFigmaTests` registers its public
`test(...)` call under the caller's real `specUrl`, so no wrapper-source alias or private runner
API is needed. Title bytes remain part of collected identity; project names containing
Playwright's bracket delimiters and tuple segments containing CR, LF, or Unicode `›` are rejected
instead of being interpreted ambiguously.

Playwright continues to schedule project dependencies, teardown, repeat slots, retries, fixtures,
and web servers. Collection imports and evaluates the application's trusted config/spec code just
like an ordinary Playwright invocation; it is not sandboxed or side-effect-free. User reporters
remain installed. Their child output is forwarded to the coordinator's standard error while the
CLI reserves standard output for its versioned JSON outcome.

Without `FRAMELIA_RUN_CONTEXT`, Reporter behavior is unchanged: direct `playwright test` starts the
live dashboard and records the directly selected subset. The coordinated path never fetches
Figma, refreshes or repairs a baseline, reuses a prior result, or kills a consumer-owned server.
Any binding/spec/policy/setup graph mutation between collection and execution blocks before
capture and leaves an inspectable terminal run once planning had started.

### Web-to-web matchers

`toMatchPage` compares two pages already prepared by your test. `toMatchUrl` opens a page in the
same browser context, so caller cookies/session carry over. These results are live dashboard and
Playwright attachment results; persisted done-gate contracts remain Figma-baselined by design.

## Matchers

```ts
import { expect } from "@framelia/playwright";

await expect(page).toMatchFigma("153:5181", {
  fileKey: process.env.FRAMELIA_FIGMA_FILE_KEY,
});
await expect(page).toMatchPage(referencePage);
await expect(page).toMatchUrl("http://127.0.0.1:3000/reference");
```

Matchers never own caller page navigation, authentication, or browser setup. `toMatchUrl` only
creates a page in the received page's browser context and navigates that URL.

Options support `selector`, `fullPage`, `masks`, `profile`, font policy, animation policy, and a
per-call `timeout` (ms) that overrides the expect timeout for that one call.
Figma region captures may provide `expectSize`; this becomes part of persisted contract evidence.
Page-scope calls (no `selector`) may provide `styleChecks`, one style comparison per declared
check-point against its own baked `expectStyle`; results are tagged with the check-point's
selector and merged into `topIssues` the same non-blocking way region scope's own style
comparison is.

A failed comparison's message lists each metric next to the threshold it failed against
(`matchRatio`, `ssim`, `avgDeltaE`, `diffPixels`, size and `areaGap`), whether the diff cluster
check failed, and the first blocking issue. Each `toMatchFigma` call gets its own attachment
names and work directory, so two calls for the same node in one test keep separate evidence.

`.not` only inverts a real visual verdict. When a comparison cannot run at all (no file key, a
failed Figma fetch or capture, a navigation failure, no promoted baseline), the matcher throws
under `.not` instead of reporting a pass.

`toMatchPageBaseline(key)` follows Playwright's `--update-snapshots`. With `missing` it promotes
the capture when no baseline is promoted yet. With `changed` it also promotes on a mismatch.
With `all` it always promotes. Promotion goes through the same versioned `promotePageBaseline`
as `framelia baseline promote`, recorded as `playwright --update-snapshots`, so earlier versions
stay recoverable. `.not` never promotes.

## Pinned Figma contracts (`defineFigmaTests`)

`defineFigmaTests(test, options)` registers ordinary Playwright tests -- one per
`framelia.contract` JSON file -- that compare against a **pinned, digest-verified
baseline snapshot on disk** (`.framelia/baselines/<digest>/snapshot.json` under the
project root, plus its referenced image/style bytes). It never fetches from Figma: no
credentials or network are reachable anywhere in this call path, and a changed or
unreachable live Figma file can never alter what a pinned check compares against.
Acquiring/refreshing that pinned snapshot is a separate, explicit step (not covered by
this package).

```ts
import { defineFigmaTests } from "@framelia/playwright";
import { test } from "@playwright/test";

defineFigmaTests(test, {
  contracts: new URL("./visual-contract.json", import.meta.url),
  specUrl: new URL(import.meta.url),
  async prepare({ page }, { target }) {
    await page.goto(target.path);
  },
});
```

`contracts` accepts one file (a `URL`, resolved module-relatively, or a path string) or
an array of several -- each becomes exactly one registered test, fanned across every
configured Playwright project the way any other registered test is. `specUrl` is
required -- pass `new URL(import.meta.url)` from your own spec file; `defineFigmaTests`
hashes that file's raw bytes at this exact registration moment and freezes the digest
into every registered test's own annotation, so a spec file edited on disk after
Playwright's own collection phase imports it can never be silently frozen into (or
captured against) a different identity than what Node actually imported. Every
registered test carries a versioned `framelia.contract` annotation (`{ contractId,
contractFile, contractDigest }` plus that registration-time spec digest) for downstream
tooling; a contract's own `projects` field, when set, skips the test on every other
project instead of narrowing what gets registered.

The contract's own `viewport` is reconciled, and the pinned baseline's
`deviceScaleFactor` validated, before `prepare` runs. Viewport: applied automatically
when the page's own viewport is still unset or Playwright's own default; an
already-customized page viewport that disagrees with the contract's own viewport fails
the test explicitly instead, without resizing or reloading the page. `deviceScaleFactor`
can only ever be validated, never applied here -- it's fixed at browser-context creation,
so a project running a higher-DPR contract must configure its own context/project with a
matching `deviceScaleFactor`; a mismatch between that live value and the pinned
baseline's own scale is caught and reported explicitly, instead of silently producing a
wrong-resolution comparison.

Capture takes exactly the resolved project policy's `stabilitySamples` (2–5) back-to-back
screenshots without navigation or reload. Only the primary image is retained; hashes for every
sample are persisted and the private sample images are removed. A gate-eligible attempt is stable
only when the recorded count exactly matches the frozen `CasePlan` and every hash agrees.

`prepare`'s fixtures argument is deliberately `{ page }`, not a caller's whole extended
fixtures object -- Playwright's own test-file transform statically requires every
fixture a test uses to be named literally in that test's own destructuring pattern, which
a generic library function cannot do for fixture names it never sees at its own authoring
time. For a scenario that needs setup before `prepare` runs (login, seeding, dismissing a
modal), override the built-in `page` fixture itself -- Playwright's own documented
pattern for exactly this:

```ts
import { defineFigmaTests } from "@framelia/playwright";
import { test as base } from "@playwright/test";

const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.SMOKE_USER_EMAIL!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await use(page);
  },
});

defineFigmaTests(test, {
  contracts: new URL("./dashboard.visual-contract.json", import.meta.url),
  specUrl: new URL(import.meta.url),
  async prepare({ page }, { target }) {
    await page.goto(target.path);
    await page.getByTestId("dashboard-ready").waitFor();
  },
});
```

By the time `prepare` runs, `page` is already the fixture's fully-prepared page; capture
only ever happens after `prepare` resolves, so a modal/auth/readiness wait inside
`prepare` genuinely gates the screenshot.

The capture deadline (`timeoutMs`) defaults to what remains of the test's own timeout once
capture starts, measured from the start of the test body and minus a 1s margin, so a slow
`prepare` cannot push capture past Playwright's own test timeout. A test timeout of `0`
(unlimited) falls back to 60s.

## Scaling to many pages

Framelia does not ship a runner that discovers every `visual-contract.json` and generates
tests from it -- that would mean owning test lifecycle, which this package has never done (see
Quickstart). The supported pattern at scale is still one spec file per page, reusing your own
Page Object/fixture conventions; see `examples/framelia-reference-app` for a working reference.
Two small helpers remove the boilerplate that pattern otherwise repeats per spec:

### Reading one contract entry

A `visual-contract.json` can hold several contracts (e.g. one page's desktop and mobile
viewports). `readContractEntry` replaces the hand-rolled `existsSync` + `JSON.parse` + `.find()`
every spec otherwise repeats, and schema-validates the result against the same schema
`framelia contract create` writes:

```ts
import { expect, readContractEntry } from "@framelia/playwright";
import { test } from "@playwright/test";

const entry = readContractEntry(
  ".framelia/visual-verifications/login/visual-contract.json",
  "login.desktop",
);

test("login matches Figma", async ({ page }) => {
  test.skip(!entry.ok, entry.ok ? "" : entry.message);
  const { contract } = entry as Extract<typeof entry, { ok: true }>;
  await page.setViewportSize(contract.viewport);
  await page.goto("/login");
  await expect(page).toMatchFigma(contract.baseline.nodeId, { fileKey: contract.baseline.fileKey });
});
```

### Skipping a contract whose target provably hasn't changed

At ~100 pages, most contracts are unchanged between runs, but Framelia has no build/dependency
graph to know that in general (no bundler ownership, unlike Chromatic's TurboSnap over a
Storybook build). What it does own is a small per-contract receipt: "did the last check against
_this exact fingerprint_ pass." The fingerprint itself is entirely your call -- a git commit SHA
for whole-app granularity, or a hash of the source files behind one route for finer granularity.
Framelia never computes or interprets it (below assumes a clean CI checkout).

```ts
import {
  expect,
  isContractFresh,
  readContractEntry,
  writeContractFreshness,
} from "@framelia/playwright";
import { test } from "@playwright/test";
import { execSync } from "node:child_process";

const contractPath = ".framelia/visual-verifications/login/visual-contract.json";
const entry = readContractEntry(contractPath, "login.desktop");
const fingerprint = execSync("git rev-parse HEAD").toString().trim();

test("login matches Figma", async ({ page }) => {
  test.skip(!entry.ok, entry.ok ? "" : entry.message);
  const { contract } = entry as Extract<typeof entry, { ok: true }>;
  test.skip(
    isContractFresh(contract.outDir, fingerprint),
    `unchanged since the last passing check at this commit (${fingerprint}).`,
  );

  await page.setViewportSize(contract.viewport);
  await page.goto("/login");
  await expect(page).toMatchFigma(contract.baseline.nodeId, { fileKey: contract.baseline.fileKey });
  writeContractFreshness(contract.outDir, {
    fingerprint,
    pass: true,
    checkedAt: new Date().toISOString(),
  });
});
```

This is an exact, opt-in memoization, not a heuristic: nothing here can produce a false
"unchanged" verdict on its own, because the fingerprint comparison is exact string equality
against what the caller supplied last time it recorded a pass. It skips the capture+compare test
body (`test.skip`), not `done-gate` itself -- `done-gate` keeps evaluating whatever evidence
already exists on disk from the last real run, exactly as before.

## Reporter

Register `@framelia/playwright/reporter` to get live dashboard events and durable Figma matcher
artifacts:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

Reporter reads matcher score/image attachments from Playwright's main process boundary. Each Figma
matcher call gets its own evidence directory. Passing calls attach expected/actual/diff images so
Reporter can persist the same evidence required by `framelia done-gate`.

Images are attached as bytes (`body`), not file paths. Playwright deletes a test's `outputDir`
after it ends unless `preserveOutput` keeps it, so path attachments would lose passing-test
evidence under `preserveOutput: "failures-only"` or `"never"`. The HTML report still shows the
images in its diff viewer.

A low-level `toMatchFigma({ contractId })` result is stored under that contract's evidence
directory. When the config has more than one project, the directory name also gets the project
name, and a `repeatEachIndex` above 0 adds `-r<n>`, so projects and repeats cannot overwrite each
other. A single-project, non-repeated run keeps the plain directory. Each run removes any stale
diff or score left in the directory by an earlier run. In a suite that mixes annotated contract
tests with low-level matchers, the live dashboard shows both. Low-level results are never part of
the recorded run.

A reporter invocation knows only Playwright's selected tests, so its run plan is always marked as
a subset and never claims to be the complete required matrix. Protected signed requirements
supply the authoritative full matrix to `framelia done-gate`. Attempt publication failures are
persisted on the final run record and shown in the dashboard; a run with one cannot pass the gate.

Only contract/project pairs the contract applies to are planned: the contract's own `projects`
if set, otherwise the policy's `playwright.projects`. A direct `playwright test` run fails
(`onEnd` returns `failed`) when its annotated tests cannot be recorded, for example when no
`framelia.config.*` exists, when an attempt publication fails, or when finalization fails. The
run status and each global error message go into the final run record. An interrupted or
timed-out run, or one whose selected cases have no accepted attempt, is sealed `incomplete`,
never `finalized`.

`framelia check` is the supported path for authoritative runs.

Web-to-web matcher results remain runtime/dashboard evidence. Contract and done-gate artifacts are
Figma-baselined after schema-v4 pivot.

### Sharded runs

Every shard of a sharded direct run (`npx playwright test --shard=N/M`) records into one shared
run when all shards get the same run ID: set `FRAMELIA_RUN_ID` (or the reporter's `runId`
option) to one value per CI run, for example `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`. A run is
immutable, so a re-run needs a new ID.

A shard only sees its own tests, so no shard knows the whole plan. Each shard publishes its case
plans as an immutable plan fragment, publishes its attempts as usual, and on exit records a
completion marker with its Playwright result status and global errors. The last shard to complete
composes the run's frozen plan from every fragment and finalizes the run once. The run status uses
the worst shard result: an interrupted or timed-out shard leaves the run `incomplete`. Until then
the run is in progress: `framelia runs list` shows which shards it is waiting for, and `open`,
`report` and `done-gate` refuse it with `RUN_BUNDLE_SHARDS_PENDING`.

```text
.framelia/runs/<slug(run-id)>/
├── shards/<N>-of-<M>/plan/fragment.json         # shard N's case plans
├── shards/<N>-of-<M>/completion/completion.json # shard N's result status and global errors
├── cases/<slug(case-id)>/attempts/...           # attempts, as for any run
├── plan/                                         # composed once every shard completed
└── run.json                                      # written once, when the run is finalized
```

Shards that share one machine (and one project root) finalize the run themselves. When each shard
runs on its own CI runner, collect every shard's `.framelia/runs/<slug(run-id)>` directory into one
checkout of the same commit and run `framelia runs finalize --run <run-id>` there. Shard files are
keyed by shard and attempts by case, so the directories merge without collisions. The command
exits `2` and lists the missing shards until every shard is present. See the
[CLI CI example](../cli/README.md#ci-example).

Shards must agree on the shard total, the project policy and the retry policy, and must not plan
the same case. Finalization rejects a conflict (`RUN_BUNDLE_SHARD_CONFLICT`) and a plan fragment
that changed after its shard completed. A sharded run without a shared run ID falls back to one
bundle per shard, with runId `<generated-id>-shard-<N>-of-<M>`, and the reporter warns how to set
`FRAMELIA_RUN_ID`. `framelia check` is not sharded.
