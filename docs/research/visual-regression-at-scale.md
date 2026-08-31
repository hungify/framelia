# Visual regression / design-QA at scale: prior art vs. Framelia

Research date: 2026-08-30. Scope: how established visual-regression and design-to-code
verification products structure "what to test," handle setup/auth, control CI cost, aggregate
results, and what they've documented about scaling pain — compared against Framelia's current
design (contract-per-page JSON manifests, matcher-only Playwright library, CLI capture/compare/
done-gate/dashboard). Every claim below is sourced to a primary doc/repo; secondary "top-N tools"
roundups were used only to find URLs, never cited as evidence.

There is no existing `docs/research/` convention in this repo (only `docs/agents/`) — this file
establishes one.

## Ground truth: what Framelia actually does today (verified against the repo)

Before comparing, here is what the code and docs in this repo actually say, as of this commit
(`packages/cli`, `packages/playwright`, `packages/contracts`, `examples/framelia-reference-app`):

- **Contract = one JSON manifest per feature.** `framelia contract create` writes
  `.framelia/visual-verifications/<feature>/visual-contract.json`, containing a `target` (URL,
  identity only), and one or more `contracts[]` entries with `id`, a Figma `baseline`
  (`fileKey`+`nodeId`), `viewport`, `outDir`, and a `scope` (`page` or `region` with `selector`/
  `expectSize`), optional `styleChecks`. Confirmed by reading `packages/cli/README.md` and the
  actual file at `examples/framelia-reference-app/.framelia/visual-verifications/login/visual-contract.json`.
- **The matcher library never navigates.** `packages/playwright/README.md` states outright:
  "Framelia owns capture and comparison. Your Playwright test owns navigation, auth, and
  interaction," and "Matchers never own caller page navigation, authentication, or browser setup."
  `packages/cli/README.md`'s troubleshooting section says the same for the CLI: "framelia no
  longer owns any of that setup" (fonts, timers, animations, browser, viewport) — that's on the
  developer's own Playwright test. The CLI README also explicitly documents that `verify`,
  `doctor`, and `discover` — "plus the navigation action DSL underneath them — are retired. There
  is no CLI command that captures a browser or executes navigation."
- **Exactly one hand-written spec drives a `toMatchFigma` contract today.**
  `examples/framelia-reference-app/e2e/specs/` contains four spec files:
  `figma.spec.ts` (the only one calling `toMatchFigma`), `authenticated.spec.ts`,
  `public.spec.ts` (functional assertions, no visual matcher), and `cli.spec.ts` (exercises the
  CLI binary itself). `figma.spec.ts` reads
  `.framelia/visual-verifications/login/visual-contract.json` off disk, does
  `contractFile?.contracts.find((c) => c.id === "login.desktop")`, and hardcodes that one lookup
  before calling `toMatchFigma`. Only one contract file exists in the reference app
  (`login/visual-contract.json`), with one `contracts[]` entry.
- **No contract-discovery / auto-generated-test-per-contract mechanism exists.** A repo-wide
  search of `packages/cli/src`, `packages/playwright/src`, `packages/contracts/src`, and
  `packages/verify/src` for discovery/glob/enumeration logic turns up only
  `packages/contracts/src/paths.ts`'s `DISCOVERY_DIR_NAME = ".discovery"`, which is an on-disk
  output directory for the `contract suggest-masks` diagnostic command — unrelated to enumerating
  contracts or generating Playwright tests. There is no helper anywhere in the codebase that walks
  `.framelia/visual-verifications/**/visual-contract.json` and spins up one `test()` per contract
  entry; `figma.spec.ts`'s single hardcoded `.find()` is the entire "runner." This is confirmed,
  not merely asserted from the task brief.
- **The CLI's capture/compare/gate/dashboard split is real and documented.**
  `packages/cli/src/commands/` has separate `contract.ts`, `done-gate.ts` (calls
  `doneGateFromArtifact` from `@framelia/verify`, reparsing the persisted artifact from disk
  rather than trusting an in-memory verdict), `dashboard.ts` (`aggregateDashboardSource`,
  `archivedDashboardSource`, `exportDashboardReport`, backed by `@framelia/dashboard-server`), and
  `debug.ts`/`schema.ts`/`status.ts`. `framelia compare` diffs two PNGs directly without
  provenance; `framelia fetch-gold` fetches one Figma render for diagnosis.

## 1. How do these tools structure "what to test" at scale?

**Storybook (and everything that piggybacks on it: Chromatic, Loki, Applitools' Storybook SDK)
uses filesystem discovery, not a manifest.** Storybook's own config (`.storybook/main.ts`)
declares a `stories` glob — an array of glob patterns (or a `{directory, files}` object) that
Storybook "statically analyzes" at startup to find every `*.stories.*` file in the project; no
one lists pages/components one-by-one. ([Storybook docs — `stories` config](https://storybook.js.org/docs/api/main-config/main-config-stories)) Chromatic and Loki then
ride this: Chromatic "automatically converts [stories] into tests, catching any unexpected
changes" — there is no separate Chromatic-specific per-story config required to be *included* in
a run. ([Chromatic docs — Visual Tests](https://www.chromatic.com/docs/test)) Loki similarly "aims to have easy setup, no to low
maintenance cost" and works with existing Storybook configs rather than a second manifest.
([oblador/loki README](https://github.com/oblador/loki)) Applitools' Storybook SDK: "Write/organize stories as usual... Each story becomes a
visual checkpoint... with zero code to author and maintain," explicitly contrasting this with a
per-test Eyes SDK approach that does require individual scripts. ([Applitools — Storybook SDK introduction](https://applitools.com/docs/eyes/sdks/storybook/introduction))

**Percy embeds "what to test" as calls in test code, not a manifest.** `percySnapshot(page, name,
options)` is called from inside Cypress/Playwright/Puppeteer test scripts — Percy has no top-level
list of pages to visit; you write the code that visits a page and calls the snapshot function.
([BrowserStack Percy docs — per-snapshot config](https://www.browserstack.com/docs/percy/percy-snapshot-config/per-snapshot-config)) Its Storybook integration is the exception: it *can* auto-generate one snapshot per
story, with an in-story `parameters.percy` escape hatch (`skip`, additional named variants) —
i.e. Percy supports both models depending on which SDK you use. ([BrowserStack — Storybook advanced topics](https://www.browserstack.com/docs/percy/references/storybook-advance-topics))

**BackstopJS is the closest true prior art for Framelia's "JSON manifest per page" pattern.**
`backstop.json`'s `scenarios` array is exactly that: "a manifest where each entry represents a
distinct test case for a specific page or component state," with `label`, `url`, `selectors`, etc.
declared as data, not code. Auto-discovery is explicitly not supported — "all pages must be
explicitly configured in the scenarios array." ([garris/BackstopJS README](https://github.com/garris/BackstopJS/blob/master/README.md)) This is the strongest direct precedent for
Framelia's contract-per-page JSON file, though BackstopJS keeps every scenario in one array in one
file rather than one file per feature directory.

**reg-suit/reg-viz has no per-page config at all** — it's a generic "diff these two directories of
already-produced images" CLI plus a plugin system (key-generator for baseline identity,
publisher for fetching/storing prior snapshots in S3/GCS, notifier for GitHub/GitLab/Slack). "What
to test" is whatever images upstream tooling (your own screenshot script) produced; reg-suit only
owns comparison, storage, and reporting. ([reg-viz/reg-suit README](https://github.com/reg-viz/reg-suit/blob/master/README.md))

**Applitools Eyes** (non-Storybook usage) is per-test-script like Percy: you call `eyes.check(...)`
from your own Selenium/Playwright/Cypress test. Its scale mechanism is not a config format but the
**Ultrafast Grid**: run the app once, then render that single DOM/CSS capture across "dozens of
devices" server-side rather than re-running the browser per device/viewport combination.
([Applitools docs — Ultrafast Grid](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid))

**Figma-to-code tools** are a much younger, more fragmented category and mostly still per-frame,
not manifest-driven. Applitools' Figma integration lets someone "export a frame from Figma
straight into Applitools Eyes," choosing a match level (Strict/Layout/Content/Dynamic) per export;
there's no bulk "export every frame in this file" manifest documented. ([Applitools — Figma solutions page](https://applitools.com/solutions/figma/)) Other entrants found in
this category (UI Match, Floto Design Diff, TestMu SmartUI's Figma CLI) are plugin/CLI tools that
operate one frame or one page at a time; none of them documents a JSON/YAML manifest pattern
resembling Framelia's contracts. This is a genuine gap in the "prior art" landscape — Framelia's
contract format has closer analogues in the general web-VRT world (BackstopJS) than in the
Figma-to-code niche specifically.

**Verdict on Q1:** Framelia's contract-per-page JSON manifest has real, direct prior art
(BackstopJS's `scenarios` array), but the dominant modern pattern in the Storybook-adjacent
ecosystem (Chromatic, Loki, Applitools-for-Storybook) is filesystem/glob **discovery** of
what-to-test, not a manifest — and none of the manifest-style tools (BackstopJS, reg-suit)
auto-generate their own test runner entries; they *are* the runner.

## 2. Custom setup before a snapshot (auth, modals, seeded state) at scale

**BackstopJS bakes it into the config schema.** `onBeforeScript` runs before a scenario ("set up
browser state e.g. cookies"), `onReadyScript` runs after page-ready to simulate interactions
(hover/click/scroll) before the screenshot, and `cookiePath` can import a pre-exported cookie jar.
Both can be set globally or per-scenario. ([garris/BackstopJS README](https://github.com/garris/BackstopJS/blob/master/README.md))

**Storybook bakes it into the *story* itself, not a separate test config**, via two complementary
mechanisms: **decorators** wrap a story in providers (theme/router/auth context) and can be
applied globally, per-component, or per-story, executing in that nesting order
([Storybook docs — Decorators](https://storybook.js.org/docs/writing-stories/decorators)); **play functions** run *after* the story
renders to simulate user behavior (typing, clicking, submitting) before assertions/snapshots run,
and Chromatic explicitly "intelligently waits for their completion before capturing snapshots."
([Storybook docs — Interaction tests](https://storybook.js.org/docs/writing-tests/interaction-testing), [Chromatic docs — Visual Tests](https://www.chromatic.com/docs/test)) Everything needed to reach the desired
state is authored once, in the story file, and every consumer (Chromatic, Loki, Applitools'
Storybook SDK) reuses it — setup is not duplicated per visual-testing tool.

**Percy and Applitools (non-Storybook) delegate entirely to the host test framework.** Percy's
snapshot call is just one line inside whatever Cypress/Playwright test already navigated, logged
in, and opened the modal; Percy's own config surface (widths, `percy-css`, `scope`, `min-height`,
`enable-javascript`) only affects how the snapshot itself is captured, not how the page got into
that state. ([BrowserStack Percy docs — per-snapshot config](https://www.browserstack.com/docs/percy/percy-snapshot-config/per-snapshot-config)) Applitools' `eyes.check()` is the same shape.

**Verdict on Q2:** there are two camps, and Framelia sits with the "delegated entirely to the host
framework" camp (Percy/Applitools/Playwright-native), not the "baked into config schema" camp
(BackstopJS) or the "baked into the reusable fixture" camp (Storybook decorators/play functions).
Framelia's `packages/playwright/README.md` states this as a deliberate boundary ("Matchers never
own caller page navigation, authentication, or browser setup"), which matches Percy/Applitools'
precedent, not BackstopJS's.

## 3. Authenticated vs. public pages as a first-class scaling concern

**Playwright itself (Framelia's own host framework) has first-party, documented support for this**
via `storageState` + **setup projects**: a dedicated `setup` project logs in once and writes
`playwright/.auth/user.json`; every other project declares `dependencies: ["setup"]` and
`use: { storageState: "playwright/.auth/user.json" }`, so tests "start already authenticated"
without re-running login per test. Worker-scoped variants (one account/session per parallel
worker) are also documented for suites that mutate shared server state. ([Playwright docs — Authentication](https://playwright.dev/docs/auth))
Framelia's reference app already follows exactly this pattern —
`e2e/fixtures/auth.setup.ts` + `authenticated.spec.ts` vs. `public.spec.ts` — which is itself
evidence the project is leaning on Playwright's own precedent rather than inventing something new.

**Storybook** treats auth/context as a **decorator** concern (see Q2) — a story either wraps
itself in an "already authenticated" provider or doesn't; there's no separate "authenticated
story" first-class concept distinct from any other contextual decorator.

**Percy and Applitools** have no first-class authenticated/public distinction in their own config;
it's whatever the surrounding Cypress/Playwright/Selenium test does before the snapshot/check
call — same delegation as Q2. Percy's `authorization` option under *asset discovery* only
authenticates Percy's own asset-fetching requests (for CSS/font/image resources), not the page
session itself. ([BrowserStack Percy docs — per-snapshot config](https://www.browserstack.com/docs/percy/percy-snapshot-config/per-snapshot-config))

**Verdict on Q3:** Framelia's delegation to Playwright's own `storageState`/setup-project
mechanism (rather than inventing an auth concept inside the contract schema) matches how Percy and
Applitools behave, and is explicitly the mechanism Playwright's own docs recommend — this looks
like sound, precedented design, not a gap.

## 4. CI cost at scale: parallelization, incremental runs, baseline caching

- **Parallelization / sharding.** Percy: set `PERCY_PARALLEL_TOTAL` (and a shared
  `PERCY_PARALLEL_NONCE`) so N CI jobs each report partial snapshots into one logical build; Percy
  waits until it has seen that many finalized partial builds before finalizing the whole build.
  ([BrowserStack Percy docs — parallel test suites](https://www.browserstack.com/docs/percy/troubleshoot/parallel-test-suites)) Playwright itself ships `--shard=x/y`, splitting either by file or (with
  `fullyParallel: true`) by individual test for more even load, with `--reporter=blob` +
  `playwright merge-reports` to recombine shard results into one report — directly reusable by any
  Framelia suite that grows into hundreds of `toMatchFigma` calls. ([Playwright docs — Sharding](https://playwright.dev/docs/test-sharding))
- **Selective/incremental runs.** Chromatic's **TurboSnap** is the most fully documented example:
  it walks git history plus the bundler's (Webpack/Vite) dependency graph to find exactly which
  story files are affected by a given commit range, then only snapshots those — untouched stories
  are "copied" from the prior baseline instead of re-rendered. Chromatic bills a full capture at
  1x, a copied snapshot at 0.2x, and a fully bypassed build at 0x; the docs' own worked example is
  a 50-story project where 10 changed stories cost 18 billed snapshots instead of 50 (64% fewer).
  Known caveats documented on the same page: changes to config files/`package.json`/`preview.js`
  imports/static folders force a full rebuild; merge commits test the *union* of both branches'
  changes; rebasing/squashing that drops commits from git history can break change detection.
  TurboSnap's "bypass whole build" behavior requires Chromatic CLI ≥17.7.0.
  ([Chromatic docs — Introduction to TurboSnap](https://docs.chromatic.com/docs/turbosnap/))
- **Baseline caching.** reg-suit's plugin architecture separates *identifying* which prior
  baseline to diff against (key-generator plugins, e.g. by git hash) from *fetching/storing* that
  baseline (publisher plugins pulling from/pushing to S3 or GCS) — this is the general pattern
  Framelia would need if it ever wanted to avoid re-fetching Figma "gold" renders on every run.
  ([reg-viz/reg-suit README](https://github.com/reg-viz/reg-suit/blob/master/README.md)) Applitools' Ultrafast Grid achieves a related cost saving differently: it "requires a
  fraction of the time and bandwidth" versus re-running the app per browser/device by rendering
  one captured DOM snapshot across many target environments server-side, rather than caching
  identical *page* renders across runs. ([Applitools docs — Ultrafast Grid](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid))

**Verdict on Q4:** this is the clearest area where Framelia currently has **no documented answer**.
Nothing in `packages/cli` or `packages/playwright` implements or documents an equivalent to
TurboSnap's changed-file detection, Percy's parallel-build nonce protocol, or reg-suit's
baseline-caching plugin split. At today's scale (one contract) this is invisible; at ~100 pages it
would become the single biggest cost/latency lever un-addressed by the current design.

## 5. Aggregating/triaging results across hundreds of snapshots

- **Chromatic**: a PR check ("🟡 UI Test") opens a build view where each changed story is shown
  baseline-vs-new side by side; a reviewer clicks Accept (updates the baseline for that story) or
  Reject (fails the build) per story, or in bulk for grouped identical diffs; accepted changes
  become the new baseline going forward. ([Chromatic docs — Review](https://www.chromatic.com/docs/review/))
- **Percy**: build dashboard shows old-baseline-left/new-snapshot-right per snapshot; it can
  "group identical visual changes" so one Accept/Reject click applies to every matching snapshot,
  and integrates with GitHub/GitLab/Bitbucket/Azure DevOps so a PR status check stays pending
  until every changed snapshot in the build has been explicitly reviewed. ([BrowserStack Percy — build review & approval](https://www.browserstack.com/percy/features/build-review-and-approval))
- **Applitools**: batches (`batchId`/`batchName`) group related checks (a run, a feature set) so
  the Applitools dashboard can present "which of my N checks failed" as one batch rather than N
  unrelated test results; `batchSequenceName` additionally tracks a batch's pass-rate trend release
  over release. ([Applitools docs — Ultrafast Grid](https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid))
- **reg-suit**: produces one HTML diff report per run and pushes a summary comment/status directly
  onto the GitHub PR or GitLab MR (plus Slack/Chatwork notifier plugins) — the report artifact
  itself, not a hosted dashboard service, is the aggregation surface. ([reg-viz/reg-suit README](https://github.com/reg-viz/reg-suit/blob/master/README.md))
- **BackstopJS**: a self-contained local HTML report with pass/fail per scenario, visual diff
  inspection, an approval workflow, and filtering by scenario name/label — same "artifact you open
  locally or in CI" model as reg-suit, no hosted service. ([garris/BackstopJS README](https://github.com/garris/BackstopJS/blob/master/README.md))

**Verdict on Q5:** Framelia's own dashboard (`framelia dashboard`/`framelia open`/`framelia
report`, backed by `@framelia/dashboard-server`, aggregating every artifact under
`.framelia/visual-verifications/`) sits architecturally closest to BackstopJS/reg-suit's model — a
locally-served or exported static report over a directory of evidence — rather than a hosted
per-build service like Percy/Chromatic. `framelia done-gate` (reparsing the persisted artifact from
disk, checking evidence freshness/hash integrity/pass state, never trusting an in-memory verdict)
is functionally the same idea as Percy's "PR status check stays pending until reviewed" gate and
Chromatic's Accept/Reject build gate, just implemented as an independent re-verification pass over
already-written JSON+PNG evidence instead of a live web review UI with a persistent
accept-becomes-new-baseline state machine. One concrete gap next to Percy/Chromatic: neither
`framelia dashboard` nor `done-gate`, per the code read above, implements an **Accept-updates-the-
baseline** review workflow — reviewing a diff in the dashboard does not appear to write anything
back that changes what the next run compares against (Framelia's baseline is always the live Figma
node, by design, so this may be an intentional non-goal rather than an oversight — worth confirming
against project intent, since it's a real behavioral divergence either way).

## 6. Documented pitfalls scaling from a handful of pages to 100+

- **Chromatic's own troubleshooting docs** name the concrete causes of flaky/false-positive
  snapshots at scale: animations (Chromatic "attempts to pause all" but "you may need to configure
  animation behavior" further), web-font load timing (recommends `<link rel="preload">` in
  `preview-head.html`), non-deterministic content (`Date.now()`, unseeded randomness — recommends
  `mockdate`/`seedrandom`), CDN-hosted images not finishing inside the capture window (recommends
  serving static assets locally), and general UI-settle timing (recommends an explicit delay
  before capture). Its documented mitigation for elements that are simply never going to be stable
  is per-element opt-out (`.chromatic-ignore` class / `data-chromatic="ignore"`), plus an automatic
  "flake filter" that detects and excludes unstable tests from blocking a build. ([Chromatic docs — Troubleshooting snapshots](https://www.chromatic.com/docs/troubleshooting-snapshots/))
  Chromatic's own docs also give the direct cost shape of the scaling problem: an 800-story design
  system produces thousands of snapshots per build across configured browsers/viewports, and a
  team running dozens of builds a day sees that bill climb accordingly — which is precisely the
  problem TurboSnap (Q4) exists to blunt. ([Chromatic docs — Introduction to TurboSnap](https://docs.chromatic.com/docs/turbosnap/))
- **BackstopJS's own issue tracker** documents reliability breaking down as scenario count grows:
  a reported 10–30% failure rate running 35 scenarios × 3 viewports with the Chromy engine, traced
  to port contention between concurrently-spawned browser instances ([garris/BackstopJS#696](https://github.com/garris/BackstopJS/issues/696)); a
  separate report of 105 expected screenshots yielding only 97, unresolved by reducing concurrency
  ([garris/BackstopJS#581](https://github.com/garris/BackstopJS/issues/581)); and a report that the Chromy engine is dramatically slower than
  PhantomJS specifically "with scenarios containing many selectors" ([garris/BackstopJS#480](https://github.com/garris/BackstopJS/issues/480)). These are first-party
  GitHub issues on the tool's own repo, not secondhand commentary — i.e. exactly the kind of
  "prior art" evidence the brief asked for on scaling pitfalls, showing that a flat manifest of
  scenarios plus naive local browser concurrency is a documented failure mode once scenario count
  and viewport-multiplication grow.
- **Review fatigue is a named, first-party-acknowledged failure mode, not just user complaints.**
  Chromatic's own framing (Q1/Q6 sources above) is that snapshot-based testing inherently requires
  every visual test to render deterministically or it "will always require approval" — the tool's
  documented mitigations (ignore classes, flake filter, mockdate/seedrandom) exist specifically
  because, absent them, the review queue accumulates noise proportional to snapshot count.

## Synthesis

**Validated by prior art, with clear precedent:**

- **Matcher-only library that delegates navigation/auth to hand-written Playwright specs.** This
  is not an outlier — it is exactly how Percy (`percySnapshot()` embedded in Cypress/Playwright
  test code) and Applitools Eyes (`eyes.check()` embedded the same way) both work outside of their
  Storybook-specific SDKs. `packages/playwright/README.md`'s explicit statement — "Framelia owns
  capture and comparison. Your Playwright test owns navigation, auth, and interaction" — is the
  same boundary Percy and Applitools draw, and Framelia's authenticated/public split
  (`auth.setup.ts` + Playwright `storageState`/setup-project dependency) directly follows
  Playwright's own first-party documented pattern for this problem, not something invented
  in-house.
- **Independent done-gate that reparses persisted evidence from disk rather than trusting an
  in-memory verdict.** This mirrors, in spirit, Percy's and Chromatic's "the PR stays gated until
  every changed snapshot is reviewed/accepted" mechanism — a genuinely separate integrity check
  standing between "the run said pass" and "CI actually proceeds."
- **JSON manifest per page** has a real, named precedent: BackstopJS's `scenarios` array is the
  same idea (declare targets as data, not code), and BackstopJS explicitly does *not* auto-discover
  pages either — this is a legitimate, if not currently the most fashionable, design point in the
  landscape, not an invented pattern with zero precedent.

**Diverges from common practice — and the divergence's risk profile differs by item:**

- **No changed-file / incremental-run detection (no TurboSnap equivalent).** This is the sharpest
  divergence from the modern default. Chromatic's whole selling point at scale is *not*
  re-verifying stories nothing touched; Framelia today has no mechanism to skip a contract whose
  target page/component provably didn't change since its last passing run. At 1 contract this
  costs nothing; at 100 contracts run on every PR, this is a real, foreseeable cost/latency
  problem with a well-documented industry answer (TurboSnap's git-diff + bundler-dependency-graph
  approach) that Framelia does not yet have any counterpart to.
- **No parallelization/sharding story documented for the matcher suite itself.** Playwright's own
  `--shard` plus Percy's `PERCY_PARALLEL_TOTAL` pattern are both directly reusable by any
  Playwright-based suite (which Framelia's specs already are) — this is a gap in *documentation and
  recommended CI recipe*, not necessarily in capability, since the underlying test runner already
  supports sharding; Framelia's own README's CI example doesn't mention it.
- **Locally-served/exported dashboard, not a hosted per-build review service with an
  accept-becomes-baseline workflow.** This is a deliberate, defensible product-shape choice (fits
  a CLI-first, self-hosted tool, and Framelia's baseline is the live Figma node rather than a
  frozen prior screenshot, so "accept updates the baseline" may not even apply the same way it
  does for Percy/Chromatic's screenshot-vs-screenshot model) — but it means Framelia's dashboard
  today is closer to BackstopJS/reg-suit's "open this HTML report" ceiling than Percy/Chromatic's
  "triage hundreds of diffs with one-click bulk-accept-identical-changes" ceiling. Worth watching
  as contract count grows: BackstopJS's own report UI is the right comparison point for what
  "good enough for dozens" looks like, and Percy/Chromatic's bulk-grouping is the point at which
  "hundreds" starts to need more than a flat evidence list.

**Concrete gap, confirmed by reading the code, not just asserted from the brief:** there is no
"discover every `visual-contract.json` under `.framelia/visual-verifications/**` and generate one
Playwright test per contract entry" helper anywhere in `packages/cli`, `packages/playwright`,
`packages/contracts`, or `packages/verify`. `figma.spec.ts` hardcodes a single `.find(id ===
"login.desktop")` lookup against one contract file with one entry; there is exactly one such spec
in the whole reference app. This does not scale past a handful of hand-maintained specs — going to
~100 pages under the current model means either hand-writing ~100 near-identical spec files, or
building the missing generator. The closest prior art for *how* to build that generator, in order
of directness:

1. **Playwright's own dynamic test generation** — `test()`/`test.describe()` can be called in a
   loop at collection time; the natural shape is a small loader that walks
   `.framelia/visual-verifications/**/visual-contract.json`, and for each `contracts[]` entry
   emits one `test(contract.id, async ({ page }) => { ...toMatchFigma... })`, parameterized by that
   entry's `target.url`/`viewport`/`scope`. This requires no new dependency and matches how
   Playwright itself expects parameterized suites to be built ([Playwright docs — Sharding](https://playwright.dev/docs/test-sharding) shows the
   surrounding config/report machinery this would sit inside).
2. **Storybook's `stories` glob config** is the cleanest analogue for the *discovery* half
   specifically (a static, statically-analyzable glob over a known directory convention producing
   a flat list of "things to test") — Framelia's contracts already live at a predictable path
   (`.framelia/visual-verifications/<feature>/visual-contract.json`), so the glob-and-enumerate
   half of the problem is structurally identical to what `stories: ["src/**/*.stories.tsx"]`
   already solves; only the "and now call `toMatchFigma` per entry" half is Framelia-specific.
   ([Storybook docs — `stories` config](https://storybook.js.org/docs/api/main-config/main-config-stories))
3. **BackstopJS's own scenario-array-to-runner translation** is the nearest same-shape precedent
   (JSON manifest in, one headless-browser run per entry out) if Framelia wants a model closer to
   "the manifest format itself, not Playwright's test collection, is the unit of iteration."
   ([garris/BackstopJS README](https://github.com/garris/BackstopJS/blob/master/README.md))

Whichever direction is chosen, the surrounding scaling questions in this document (Q4/Q5) suggest
the generator should not be designed in isolation from an incremental-run story (skip contracts
whose target/route provably didn't change) and a sharding-aware CI recipe (`--shard`) — both are
solved problems elsewhere in this landscape, and retrofitting them onto ~100 already-hand-written
specs is exactly the kind of rework the brief is trying to head off.
