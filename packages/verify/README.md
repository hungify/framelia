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

There is no browser-owning, navigation-owning capture path in this package anymore — that
ownership moved entirely to the caller (KTD1–3 of the Playwright matcher pivot). Baseline
resolution stays: `FigmaBaselineProvider` fetches a fresh Figma node render per call; there is no
web-baseline provider, since web-vs-web comparison is `@framelia/playwright`'s `toMatchPage`/
`toMatchUrl`, diffing two already-navigated pages directly rather than through a persisted
baseline pointer.
