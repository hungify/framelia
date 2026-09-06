# @framelia/playwright

Playwright custom matchers for Figma-to-web and web-to-web visual comparison.

```bash
npm install --save-dev @framelia/playwright @playwright/test
```

`@playwright/test` is a peer dependency. Package shares consumer's `expect` instance.

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

Register Reporter in `playwright.config.ts` for live dashboard events and persisted evidence:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

```bash
npx playwright test
npx framelia done-gate \
  --artifact .framelia/visual-verifications/<test-id>/visual-verification.json
```

Reporter writes matcher evidence under `.framelia/visual-verifications/`. Final Figma evidence
includes `visual-score.json`, `run-meta.json`, `punch-list.json`, hashes, and
`visual-verification.json`.

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

Options support `selector`, `fullPage`, `masks`, `profile`, font policy, and animation policy.
Figma region captures may provide `expectSize`; this becomes part of persisted contract evidence.
Page-scope calls (no `selector`) may provide `styleChecks`, one style comparison per declared
check-point against its own baked `expectStyle`; results are tagged with the check-point's
selector and merged into `topIssues` the same non-blocking way region scope's own style
comparison is.

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

Web-to-web matcher results remain runtime/dashboard evidence. Contract and done-gate artifacts are
Figma-baselined after schema-v4 pivot.
