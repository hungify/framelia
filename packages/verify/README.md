# @framelia/verify

Visual verification engine used by `framelia` CLI and `@framelia/playwright`.

```ts
import { compare, FigmaBaselineProvider, doneGateFromArtifact } from "@framelia/verify";
```

Engine owns baseline acquisition, navigation-free capture, image comparison, and done gates. It
depends on `@framelia/contracts` and has no dependency on the CLI, HTTP server, dashboard, or
`@playwright/test`'s `expect` — `@framelia/playwright` is the only package that turns this engine
into test matchers.

Mask policy: contract-local `{ selector, reason, maxMatches? }` entries are last-resort overlays,
valid for a Figma-baselined capture. Deterministic state/deep links, fonts, and animation setup
come first. Capture resolves visible in-scope locators once, preserves layout, uses fixed
`#FF00FF`, unions bounds, and blocks when evidence is missing or area exceeds the default 15% cap.

## Contract-scale helpers

`readContractEntry(contractPath, contractId)` reads one entry out of a (possibly
multi-contract) `visual-contract.json`, schema-validated against `verificationRequestSchema`.

`writeContractFreshness` persists a small per-contract receipt (`last-verified.json`, under the
contract's own `outDir`) recording whether the last check against a caller-supplied fingerprint
passed; `readContractFreshness`/`isContractFresh` read and check that receipt. This package never
computes the fingerprint or decides to skip a test on the strength of it -- see
`@framelia/playwright`'s README ("Scaling to many pages") for the intended call pattern from a
Playwright spec.

## Navigation-free capture

`captureReadyPage(page, spec)` (exported from `@framelia/verify/internal`) screenshots an
already-positioned `Page`/`Locator` — no `goto`/`reload`/navigation of its own. The caller (a
Playwright test, via `@framelia/playwright`'s matchers) owns getting the page into the state it
wants captured; this only handles settle/font-readiness/mask-resolution/screenshot on top of that.

```ts
import { captureReadyPage } from "@framelia/verify/internal";

const outcome = await captureReadyPage(page, {
  outPath: "actual.png",
  scope: { kind: "page", fullPage: false },
  screenshot: { masks: [] },
});
```

The root engine does not launch browsers or navigate pages; the caller owns those actions for
matcher-driven verification. Standalone browser helpers for auth, mask suggestions, and page
baseline promotion live in `@framelia/verify/cli`, not the root entry point. Baseline
resolution stays: `FigmaBaselineProvider` fetches a fresh Figma node render per call; there is no
web-baseline provider, since web-vs-web comparison is `@framelia/playwright`'s `toMatchPage`/
`toMatchUrl`, diffing two already-navigated pages directly rather than through a persisted
baseline pointer.

## Manual integration tests

The real-network integration suite is manual-only and is excluded from regular tests and
`validate`. Run it explicitly from the repository root:

```bash
pnpm --filter @framelia/verify test:integration
```

`tests/integration/setup.ts` loads the repository-root `.env` through `loadProjectEnv`.
Set `FIGMA_ACCESS_TOKEN` there (or export it in your shell) with read access to the fixture
Figma file `q2MZbYDBibNKYDm7ESfvKF`, node `6006:1028`. The suite skips when no token is
available; it uses fixed fixture IDs, so no file-key or node-ID environment variables are required.
