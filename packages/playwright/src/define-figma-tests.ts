import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";

import { MIN_STABILITY_SAMPLES } from "@framelia/contracts";
import {
  authoredContractSchema,
  contractBindingSchema,
  testRegistrationSchema,
  TEST_REGISTRATION_FORMAT_VERSION,
} from "@framelia/contracts/workflow";
import type { AuthoredContract } from "@framelia/contracts/workflow";
import type { PinnedBaseline } from "@framelia/verify";
import {
  canonicalJsonDigest,
  compare,
  expectStyleToSnapshot,
  readPinnedBaseline,
} from "@framelia/verify";
import type { CaptureCoreOutcome, ReadyCaptureSpec } from "@framelia/verify/internal";
import { captureReadyPage } from "@framelia/verify/internal";
import {
  discoverProjectConfig,
  fileHash,
  resolveProjectPolicy,
} from "@framelia/verify/project-policy";
import type { Page, TestInfo, TestType } from "@playwright/test";
import * as z from "zod";

import {
  attachDiffTriplet,
  buildAttachContext,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
} from "./attach.ts";
import { resolveFigmaCompareOptions } from "./figma-profile.ts";
import { CONTRACT_ANNOTATION_TYPE } from "./registration.ts";
import { assertExecuteCaseReady } from "./run-context.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "./score-attachment.ts";
import {
  buildAttributionIssues,
  captureCheckPointBounds,
  captureCheckPointStyleIssues,
  captureStyleIssues,
  withStyleCheckTimeout,
} from "./style-checks.ts";
import { withTimeout } from "./timeout.ts";

/** Annotation `type` every registered test carries. */
export { CONTRACT_ANNOTATION_TYPE } from "./registration.ts";

const DEFAULT_TIMEOUT_MS = 60_000;

type SpecRegistrationFunction = (
  test: unknown,
  title: unknown,
  details: unknown,
  body: unknown,
) => unknown;
const registrationFunctions = new Map<string, SpecRegistrationFunction>();

/**
 * Playwright derives `TestCase.location.file` from the immediate public `test(...)`
 * call site, while `--test-list` matches that location against the documented file
 * Suite title. A normal helper call would therefore point every generated case at this
 * package file and make the exact file-Suite tuple unselectable. Compile one tiny
 * forwarding call with the caller's real spec filename so Playwright records the
 * public registration under that spec without touching private runner APIs.
 */
function registerAtSpecLocation<TestArgs extends object, WorkerArgs extends object>(
  test: TestType<TestArgs, WorkerArgs>,
  specFilePath: string,
  title: string,
  details: unknown,
  body: (args: TestArgs, testInfo: TestInfo) => void | Promise<void>,
): void {
  let register = registrationFunctions.get(specFilePath);
  if (!register) {
    register = compileFunction(
      "test(title, details, body);",
      ["test", "title", "details", "body"],
      { filename: specFilePath },
    ) as SpecRegistrationFunction;
    registrationFunctions.set(specFilePath, register);
  }
  register(test, title, details, body);
}

// Playwright's own default context viewport (`browser.newContext()` with no explicit
// `viewport`/`use.viewport` override) -- the sentinel this module uses to tell "a
// fixture customized the page's viewport on purpose" apart from "nobody touched it, so
// applying the contract's own viewport is safe." See reconcileViewport's doc comment.
const PLAYWRIGHT_DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export interface FigmaContractTarget {
  path: string;
}

/**
 * Options for {@link defineFigmaTests}. Generic over the caller's own extended
 * `TestType<TestArgs, WorkerArgs>` so the `test` handle passed in type-checks against
 * whatever fixtures the caller's own `test.extend<...>()` declares.
 *
 * `prepare`'s fixtures argument is deliberately typed as `{ page: Page }`, not the full
 * `TestArgs & WorkerArgs` -- Playwright's own test-file transform statically parses the
 * *literal* destructuring pattern of the function passed to a real `test(...)` call to
 * decide which fixtures to resolve for that test (see the registered callback below); it
 * rejects both a plain (non-destructured) parameter and a rest element (`...rest`)
 * outright, at load time, before any code runs. Because `defineFigmaTests` is a generic
 * library function, it cannot know a downstream caller's own custom fixture *names* at
 * its own authoring time, so it cannot statically list them for Playwright's parser --
 * there is no runtime-dynamic way around this without unsafe code generation
 * (`new Function`/`eval`), which this package's own "no internal APIs, no magic"
 * conventions rule out. `page` is the one fixture name `defineFigmaTests` can always,
 * safely declare (it's required by this module's own `TestArgs extends { page: Page }`
 * bound), and it is enough: Playwright's own documented pattern for a scenario that
 * needs extra per-test setup (authentication, seeding, a modal already dismissed) before
 * `prepare` runs is to override the `page` fixture itself in the caller's own
 * `test.extend()` -- `page: async ({ page }, use) => { ...await use(page); }` -- so by
 * the time `defineFigmaTests`'s own test body (and therefore `prepare`) receives `page`,
 * it is already the fully-prepared page that fixture built. See the "authenticated
 * fixture" example in this package's README.
 */
export interface DefineFigmaTestsOptions {
  /** One contract file, or several -- each file holds exactly one `framelia.contract`
   *  JSON object (the same one-contract-per-file convention `discoverAuthoredContracts`
   *  assumes) and becomes exactly one registered `test()` call, fanned across whatever
   *  Playwright projects the runner is configured with. `URL` entries resolve the same
   *  module-relative way `new URL("./visual-contract.json", import.meta.url)` implies. */
  contracts: URL | string | Array<URL | string>;
  /**
   * Identity of the calling spec file itself -- pass `new URL(import.meta.url)` from
   * your own spec file, the same `import.meta.url`-based `URL` convention `contracts`
   * above documents, applied here to the file itself rather than a sibling contract
   * file. Required: `defineFigmaTests` hashes this file's raw bytes synchronously, at
   * this exact registration moment, and freezes that digest into every registered
   * test's own `framelia.contract` annotation.
   *
   * This closes a gap Playwright's own collection model otherwise leaves open:
   * Playwright imports every spec file (running this call, synchronously, once) during
   * collection, strictly before any Reporter's `onBegin` runs. A spec file edited on
   * disk in the window between "Playwright finished importing it" and "onBegin's own
   * case-plan projection reads the file fresh to compute a digest" would freeze the
   * *edited* content's digest into the case plan -- even though the code that actually
   * executes for every attempt is still whatever Node already imported. A
   * finalization-time re-check can't catch this either: the frozen digest was wrong
   * from the moment it was captured, not drifted afterward. Freezing the digest here,
   * at true import time, is the only point that can ever see the actually-executing
   * bytes.
   */
  specUrl: URL;
  /**
   * Runs once per registered test, after the contract's viewport/deviceScaleFactor have
   * been applied (or validated against an already-customized fixture) and before any
   * capture happens -- navigate, wait for a modal, whatever this contract's scenario
   * needs before it's ready to screenshot. `target` is the contract's own `target.path`.
   * `page` is already the caller's own (possibly fixture-overridden) page -- see this
   * interface's own doc comment for why that, not a wider fixtures bag, is what's here.
   */
  prepare: (
    fixtures: { page: Page },
    context: { target: FigmaContractTarget },
  ) => Promise<void> | void;
  /** Overrides automatic project-root discovery (nearest ancestor `framelia.config.*`,
   *  falling back to the contract file's own directory -- see discoverProjectConfig).
   *  Rarely needed; set when a contract file lives outside the project it belongs to. */
  projectRoot?: string;
  /** Deadline for capture+compare+style-check+attribution, in ms. Defaults to the
   *  test's own configured timeout (`testInfo.timeout`), falling back to 60s when that's
   *  unset (0 = unbounded in Playwright's own config). */
  timeoutMs?: number;
  // `maxMaskedAreaRatio`/`fontPolicy`/`animationPolicy`/`devtoolsSelector` below (and
  // `timeoutMs`/`prepare`/`projectRoot` above) are literal values the caller's own
  // `.spec.ts` passed directly to this call -- not read from an externally-mutable file
  // the way `contracts` (via `fs.readFileSync`) and the project's `framelia.config.*`
  // (via `resolveProjectPolicy`) are. They can only change if the source file itself
  // changes, which requires a process restart that re-runs collection and re-freezes
  // everything from scratch anyway -- there is no live-process A-then-B-then-A window
  // for them the way there is for a file re-read mid-run, so the registered callback
  // below never re-verifies them.
  maxMaskedAreaRatio?: number;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
  devtoolsSelector?: true | string;
}

export interface FigmaContractOutcome {
  pass: boolean;
  message: string;
}

export interface FigmaContractTestContext {
  timeoutMs: number;
  workDir: string;
  maxMaskedAreaRatio?: number;
  stabilitySamples: number;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
  devtoolsSelector?: true | string;
  attach: (name: string, path: string) => Promise<void>;
  attachJson: (name: string, data: unknown) => Promise<void>;
}

/**
 * Runner-agnostic core: capture, compare, style-check, attribute, and attach evidence
 * for one already-prepared page against its pinned baseline -- everything
 * `defineFigmaTests` does after `prepare()` returns, split out so it's testable under
 * Vitest with a real Chromium page, mirroring `runToMatchFigma`'s own split (see its doc
 * comment for why). Never touches Playwright's `test`/`testInfo` globals.
 */
export async function runFigmaContractTest(
  page: Page,
  contract: AuthoredContract,
  pinnedBaseline: PinnedBaseline,
  context: FigmaContractTestContext,
): Promise<FigmaContractOutcome> {
  const { timeoutMs, workDir } = context;
  const baseName = sanitizeAttachmentBaseName(contract.id);
  const { profile, clusterCheck } = resolveFigmaCompareOptions(
    contract.profile,
    contract.scope.kind === "region",
  );
  const scale = pinnedBaseline.snapshot.rendering.deviceScaleFactor;
  const startedAt = Date.now();

  try {
    const outPath = path.join(workDir, "actual.png");
    const spec: ReadyCaptureSpec = {
      identity: { id: contract.id, baseline: pinnedBaseline.snapshot.source },
      outPath,
      scope:
        contract.scope.kind === "region"
          ? {
              kind: "region",
              selector: contract.scope.selector,
              expectedSize: contract.scope.expectSize,
            }
          : // Pinned page-scope baselines are always viewport-sized, never a scrolled
            // full-page capture -- baselineSnapshotSchema's own superRefine asserts
            // expected.image.{width,height} equal viewport x deviceScaleFactor exactly,
            // which a taller-than-viewport full-page capture could never satisfy.
            { kind: "page", fullPage: false },
      screenshot: { masks: contract.masks, maxMaskedAreaRatio: context.maxMaskedAreaRatio },
      stabilitySamples: context.stabilitySamples,
      timeoutMs,
      scale,
      devtoolsSelector: context.devtoolsSelector,
      fontPolicy: context.fontPolicy,
      animationPolicy: context.animationPolicy,
    };
    const captureOutcome: CaptureCoreOutcome = await withTimeout(
      captureReadyPage(page, spec),
      timeoutMs,
      "defineFigmaTests capture",
    );

    if (!captureOutcome.ok) {
      return {
        pass: false,
        message: `defineFigmaTests: capture failed (${captureOutcome.error}): ${captureOutcome.message}`,
      };
    }

    const outcome = compare(pinnedBaseline.imagePath, outPath, workDir, {
      profile,
      clusterCheck,
      profileOverrides: contract.profileOverrides,
      maskBounds: captureOutcome.maskEvidence?.bounds,
    });

    const styleCheckTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const styleIssues =
      contract.scope.kind === "region"
        ? contract.scope.expectStyle
          ? await withStyleCheckTimeout(
              captureStyleIssues(
                page,
                contract.scope.selector,
                expectStyleToSnapshot(contract.scope.expectStyle),
                contract.styleToleranceOverrides,
              ),
              styleCheckTimeoutMs,
            )
          : []
        : contract.scope.styleChecks
          ? await captureCheckPointStyleIssues(
              page,
              contract.scope.styleChecks,
              contract.styleToleranceOverrides,
              styleCheckTimeoutMs,
            )
          : [];

    const attributionTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const attributionIssues =
      contract.scope.kind === "page" &&
      contract.scope.styleChecks?.length &&
      outcome.diffClusters.length
        ? buildAttributionIssues(
            outcome.diffClusters,
            await withTimeout(
              captureCheckPointBounds(page, contract.scope.styleChecks, false, scale),
              attributionTimeoutMs,
              "defineFigmaTests pixel attribution",
            ).catch(() => []),
          )
        : [];

    const extraIssues = [...styleIssues, ...attributionIssues];
    const outcomeWithStyle = extraIssues.length
      ? { ...outcome, topIssues: [...outcome.topIssues, ...extraIssues] }
      : outcome;

    await attachDiffTriplet(context.attach, baseName, {
      expected: pinnedBaseline.imagePath,
      actual: outPath,
      diff: outcome.diffPath,
    });

    const scoreAttachment: FrameliaScoreAttachment = {
      ...buildScoreAttachment(outcomeWithStyle, {
        targetUrl: page.url(),
        baselineKind: "figma",
        attachmentBaseName: baseName,
        profile,
        clusterCheck,
        profileOverrides: contract.profileOverrides,
        styleToleranceOverrides: contract.styleToleranceOverrides,
        gateEligible: contract.gateEligible,
        styleGateEligible: contract.styleGateEligible,
        scope:
          contract.scope.kind === "region"
            ? {
                kind: "region",
                selector: contract.scope.selector,
                expectedSize: contract.scope.expectSize,
              }
            : { kind: "page", fullPage: false },
        masks: contract.masks,
        maxMaskedAreaRatio: context.maxMaskedAreaRatio,
        captureEvidence: captureOutcome,
      }),
      fileKey: pinnedBaseline.snapshot.source.fileKey,
      nodeId: pinnedBaseline.snapshot.source.nodeId,
    };
    await context.attachJson(`${baseName}${SCORE_ATTACHMENT_SUFFIX}`, scoreAttachment);

    return {
      pass: outcome.pass,
      message: outcome.pass
        ? `defineFigmaTests: ${contract.id} matched its pinned baseline (matchRatio ${outcome.matchRatio?.toFixed(4)}).`
        : `defineFigmaTests: ${contract.id} did not match its pinned baseline (matchRatio ${outcome.matchRatio?.toFixed(4) ?? "n/a"}, ssim ${outcome.ssim?.toFixed(4) ?? "n/a"}). See attached expected/actual/diff.`,
    };
  } catch (error) {
    return {
      pass: false,
      message: `defineFigmaTests: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function resolveContractFilePath(input: URL | string): string {
  return input instanceof URL ? fileURLToPath(input) : path.resolve(input);
}

interface LoadedContractFile {
  contract: AuthoredContract;
  digest: `sha256:${string}`;
}

function loadContractFile(filePath: string): LoadedContractFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`defineFigmaTests: cannot read contract file ${filePath}.`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`defineFigmaTests: contract file ${filePath} is not valid JSON.`, {
      cause: error,
    });
  }
  const result = authoredContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `defineFigmaTests: contract file ${filePath} failed schema validation: ${z.prettifyError(result.error)}`,
    );
  }
  return { contract: result.data, digest: canonicalJsonDigest(result.data) };
}

/**
 * Synchronously locates and hashes the project's config file's raw bytes, if one
 * exists -- a race-free companion to the async `resolveProjectPolicy`-based policy
 * check in `defineFigmaTests`'s registered callback. `resolveProjectPolicy` does a
 * genuinely deferred dynamic `import()` for an ESM-scoped config file (`.mjs`/`.mts`, or
 * `.ts`/`.js` under a `"type": "module"` package) -- real, awaited I/O that isn't
 * guaranteed to actually touch the file until a later tick, leaving a window where a
 * config mutated between "decide to resolve" and "import actually reads" could make
 * `policyPromise` itself resolve against the wrong content, defeating that check at its
 * very first moment. A synchronous `fs.readFileSync` has no such window: Node's
 * single-threaded execution model guarantees no other code can run between "decide to
 * read" and "read completes" for it. `discoverProjectConfig(projectRoot, projectRoot)`
 * mirrors `resolveProjectPolicy`'s own `discoverProjectConfig(cwd, options.projectRoot)`
 * call exactly (both `cwd` and the explicit override are `projectRoot`), so both checks
 * agree on which file they mean.
 */
function hashConfigFile(projectRoot: string): string | undefined {
  const configPath = discoverProjectConfig(projectRoot, projectRoot).configPath;
  return configPath ? fileHash(configPath) : undefined;
}

function toPortablePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Non-destructive viewport reconciliation: applies the contract's own CSS-px viewport to
 * the page when the page's current viewport is unset or still at Playwright's own
 * built-in default (nobody customized it, so there's nothing to protect), and fails
 * loudly -- without ever calling `setViewportSize`, `reload`, or otherwise touching the
 * page -- when the page already carries a *different*, deliberately customized viewport
 * (e.g. a custom auth fixture that already navigated at a specific size). This can't
 * distinguish "a fixture explicitly chose Playwright's own default value" from "nobody
 * touched it"; that's an inherent limit of Playwright's viewport API (`page.viewportSize()`
 * has no "was this ever set" flag), not a gap left unhandled here.
 */
export async function reconcileViewport(
  page: Page,
  contractViewport: { width: number; height: number },
  contractId: string,
): Promise<void> {
  const current = page.viewportSize();
  const isUnsetOrDefault =
    current === null ||
    (current.width === PLAYWRIGHT_DEFAULT_VIEWPORT.width &&
      current.height === PLAYWRIGHT_DEFAULT_VIEWPORT.height);
  if (isUnsetOrDefault) {
    await page.setViewportSize({ width: contractViewport.width, height: contractViewport.height });
    return;
  }
  if (current.width !== contractViewport.width || current.height !== contractViewport.height) {
    throw new Error(
      `defineFigmaTests: contract "${contractId}" requires viewport ${contractViewport.width}x${contractViewport.height}, but the page's fixture already set a custom viewport ${current.width}x${current.height}. defineFigmaTests never overrides an already-customized viewport or reloads the page -- reconcile the fixture's viewport with the contract, or stop customizing the fixture's viewport.`,
    );
  }
}

/**
 * deviceScaleFactor is fixed at browser-context creation (`browser.newContext({
 * deviceScaleFactor })`) and Playwright exposes no API to change or even read it back
 * off an existing `Page`/`BrowserContext` -- so unlike viewport, this can only validate,
 * never auto-apply. `window.devicePixelRatio` is the standard, accurate way to read a
 * live context's actual rendering scale back out.
 */
export async function assertDeviceScaleFactorAgreement(
  page: Page,
  expectedScale: number,
  contractId: string,
): Promise<void> {
  const liveDpr = await page.evaluate(() => window.devicePixelRatio);
  if (liveDpr !== expectedScale) {
    throw new Error(
      `defineFigmaTests: contract "${contractId}" was pinned at deviceScaleFactor ${expectedScale}, but the page's actual devicePixelRatio is ${liveDpr}. deviceScaleFactor is fixed at browser-context creation and cannot be changed by defineFigmaTests -- configure the Playwright project/fixture that creates this page with { deviceScaleFactor: ${expectedScale} } (matching the pinned baseline's rendering.deviceScaleFactor exactly), or re-pin the baseline at the page's actual scale.`,
    );
  }
}

/**
 * Registers one ordinary Playwright `test()` per contract file, deterministically
 * annotated with versioned `framelia.contract` metadata (contract id, project-relative
 * file, and its validated content digest) -- collection (`playwright test --list`, or
 * any run up to the point a test body actually executes) never calls `prepare`; only
 * running the registered test does. Comparisons run entirely offline against a pinned,
 * digest-verified baseline snapshot on disk (see `readPinnedBaseline`) -- no Figma
 * credentials or network reachable anywhere in this call path, and a changed or
 * unreachable live Figma file can never alter what a pinned check compares against.
 *
 * `defineFigmaTests` never fans a contract across projects itself: Playwright's own
 * runner already does that for every registered test. When a contract restricts itself
 * to a subset of projects (`contract.projects`), the registered test calls
 * `testInfo.skip()` for every other project instead.
 *
 * Project-root resolution (for both the pinned-baseline lookup and the project-relative
 * `contractFile` recorded in the annotation) mirrors `discoverProjectConfig`'s own
 * nearest-`framelia.config.*`-ancestor walk, started from each contract file's own
 * directory: a project with a real `framelia.config.ts` gets its true project root, and
 * a contract file with no config anywhere above it (e.g. an isolated test fixture) falls
 * back to its own directory -- deliberately not a fixed, separately-configured project
 * root, since a contract file's baseline data (`.framelia/baselines/...`) lives relative
 * to the same root a real project would resolve for its `framelia.config.ts`-driven
 * tooling, and this reuses that exact, already-tested resolution instead of a second,
 * parallel one.
 */
export function defineFigmaTests<TestArgs extends { page: Page }, WorkerArgs extends object>(
  test: TestType<TestArgs, WorkerArgs>,
  options: DefineFigmaTestsOptions,
): void {
  const inputs = Array.isArray(options.contracts) ? options.contracts : [options.contracts];
  if (inputs.length === 0) {
    throw new Error("defineFigmaTests: options.contracts must include at least one contract file.");
  }

  // Resolved and hashed once per `defineFigmaTests` call (not once per contract in the
  // loop below): every contract this call registers shares the one spec file that
  // called it. Synchronous `fs.readFileSync`-based hashing, at this exact moment --
  // Playwright's own collection phase runs this whole function body synchronously,
  // once, while importing the spec file, strictly before any Reporter's `onBegin`. This
  // is the only point in the entire lifecycle that can ever observe the bytes Node
  // actually imported and will actually execute; see `specUrl`'s own doc comment.
  const specFilePath = fileURLToPath(options.specUrl);
  const registeredSpecDigest = fileHash(specFilePath);

  for (const input of inputs) {
    const contractFilePath = resolveContractFilePath(input);
    const { contract, digest } = loadContractFile(contractFilePath);
    const projectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : discoverProjectConfig(path.dirname(contractFilePath)).root;
    const contractFile = toPortablePath(path.relative(projectRoot, contractFilePath));
    // Project-relative form of `specFilePath` (resolved from `options.specUrl`),
    // computed against this contract's own discovered `projectRoot` -- the same
    // convention `contractFile` above already uses. Embedded in the registration so a
    // later reader can verify the caller-supplied `specUrl` actually matches the file
    // Playwright's own runtime metadata says registered this test (see
    // `testRegistrationSchema`'s own doc comment for why this exists).
    const specFile = toPortablePath(path.relative(projectRoot, specFilePath));
    const binding = contractBindingSchema.parse({
      formatVersion: 1,
      kind: "framelia.contract-binding",
      contractId: contract.id,
      contractFile,
      contractDigest: digest,
    });
    const registration = testRegistrationSchema.parse({
      formatVersion: TEST_REGISTRATION_FORMAT_VERSION,
      kind: "framelia.test-registration",
      binding,
      specFile,
      specDigest: registeredSpecDigest,
    });
    // Synchronous, race-free companion to `policyPromise` below -- see
    // `hashConfigFile`'s own doc comment for why the async, dynamic-`import()`-based
    // policy resolution alone isn't sufficient.
    const registeredConfigDigest = hashConfigFile(projectRoot);
    // Kicked off here, at registration time, so the config file this resolves against
    // is whatever's on disk right now -- not deferred until the callback below actually
    // runs (which may be long after registration). Never awaited here: awaiting would
    // make `defineFigmaTests` itself async, forcing every call site to `await` it for
    // registration to complete before Playwright's collection phase moves on. The
    // callback awaits this same promise to get the frozen digest, and separately
    // re-resolves fresh policy for the live comparison -- mirroring the contract check
    // above. A project with no `framelia.config.*` at all is legitimate (see
    // `discoverProjectConfig`'s fallback in this function's own doc comment) --
    // `allowUninitialized: true` makes that resolve to `policyDigest: undefined` rather
    // than throwing, and undefined-vs-undefined below correctly compares as "no drift."
    const policyPromise = resolveProjectPolicy({
      cwd: projectRoot,
      projectRoot,
      allowUninitialized: true,
    });
    // A contract whose project filter excludes this Playwright project skips (see
    // `testInfo.skip` below) before ever awaiting `policyPromise` -- swallow here so an
    // unrelated project's broken `framelia.config` can't surface as an unhandled
    // rejection for a test that was never going to run against it anyway.
    policyPromise.catch(() => undefined);

    registerAtSpecLocation(
      test,
      specFilePath,
      contract.name,
      { annotation: { type: CONTRACT_ANNOTATION_TYPE, description: JSON.stringify(registration) } },
      // `{ page }` is the only fixture name this generic library can statically declare
      // here -- see DefineFigmaTestsOptions's own doc comment for why Playwright's
      // fixture-parser constraint rules out forwarding a caller's full, unknown-in-advance
      // fixture set.
      async ({ page }, testInfo: TestInfo) => {
        assertExecuteCaseReady(testInfo, registration, projectRoot);
        // Precapture reconciliation: `contract` above was loaded once, at collection
        // time, and closed over by this callback -- Playwright may not actually invoke
        // this callback until long after collection, and nothing else re-validates that
        // the file on disk still matches what was registered. Reload it fresh here and
        // compare digests before doing anything observable (skip decisions, viewport
        // reconciliation, capture): a file that changed between collection and
        // execution must fail loudly, never silently capture against a stale identity
        // or a live-but-never-verified new one. See finalizeRunRecord's own
        // digest-drift check (packages/verify/src/run-bundle/reconcile.ts) for the
        // finalization-time half of this guarantee; this is the capture-time half.
        const { contract: liveContract, digest: liveDigest } = loadContractFile(contractFilePath);
        if (liveDigest !== digest) {
          throw new Error(
            `defineFigmaTests: contract "${contract.id}" changed on disk after test collection (registered digest ${digest}, now ${liveDigest}) -- refusing to run a stale contract's test.`,
          );
        }

        // Same shape of gap as the contract check above, applied to the spec file
        // itself (see `specUrl`'s own doc comment for the registration-time half of
        // this fix): `specFilePath`/`registeredSpecDigest` were captured once, at
        // collection time, when this whole function body ran. This closes the *wider*
        // window the registration-time freeze alone cannot: a spec file edited (or
        // edited-then-reverted) anywhere between registration and this specific test's
        // own execution -- not just the narrower registration-vs-onBegin window
        // `specUrl` closes for the frozen `CasePlan`. Node never re-imports an
        // already-loaded module, so this can never change *which code* actually runs
        // here -- but it must still fail loudly rather than silently capture evidence
        // under a spec identity that no longer matches what's on disk.
        const liveSpecDigest = fileHash(specFilePath);
        if (liveSpecDigest !== registeredSpecDigest) {
          throw new Error(
            `defineFigmaTests: spec file ${specFilePath} changed on disk after test collection (registered digest ${registeredSpecDigest}, now ${liveSpecDigest}) -- refusing to run a stale spec file's test.`,
          );
        }

        // `specUrl` binds "the file whose bytes were hashed above" to a real identity
        // only by the caller's own honesty -- nothing so far stops a caller from
        // passing an arbitrary, stable, unrelated file (or simply the wrong file)
        // whose digest has nothing to do with what Playwright is actually executing.
        // `testInfo.file` looks like the right runtime-authoritative check but is NOT:
        // it reports the location where `test(...)` was *textually called* (a stack
        // trace at registration time), which for every `defineFigmaTests` registration
        // is always this library's own call site inside this file, never the caller's
        // spec file -- confirmed empirically against a real `playwright test` run.
        // `testInfo.titlePath` is documented as "the full title path starting with the
        // test file name" and is populated from the collected file `Suite`'s own title
        // (tracked independently of any wrapping function's own call site), relative to
        // `testInfo.project.testDir` -- resolve it to an absolute path, then to the
        // same portable form `registration.specFile` is already in, and refuse to run
        // if they disagree.
        const liveSpecFile = toPortablePath(
          path.relative(
            projectRoot,
            path.resolve(testInfo.project.testDir, testInfo.titlePath[0]!),
          ),
        );
        if (liveSpecFile !== specFile) {
          throw new Error(
            `defineFigmaTests: contract "${liveContract.id}"'s registered specUrl (${specFile}) does not match the file Playwright says registered this test (${liveSpecFile}) -- refusing to run a test whose declared spec identity doesn't match its actual location.`,
          );
        }

        // Synchronous, race-free fingerprint, checked first: `policyPromise`
        // (`resolveProjectPolicy`) does a genuinely deferred dynamic `import()` for an
        // ESM-scoped config file -- real, awaited I/O that could still be reading the
        // file's *old* content the instant a mutation lands between "decide to resolve"
        // and "import actually reads," which would make both the registered and live
        // `resolveProjectPolicy()` calls agree on the wrong content and defeat that
        // check at its very first moment. `hashConfigFile` uses a synchronous
        // `fs.readFileSync` instead, which has no such window. This is additive
        // defense-in-depth, not a replacement: it can't catch drift in anything
        // `resolveProjectPolicy` derives beyond the config file's own raw bytes (env
        // files, for instance), which the semantic `policyDigest` check below still
        // covers.
        const liveConfigDigest = hashConfigFile(projectRoot);
        if (liveConfigDigest !== registeredConfigDigest) {
          throw new Error(
            `defineFigmaTests: project config file for contract "${liveContract.id}" changed on disk after test collection (registered digest ${registeredConfigDigest ?? "none (uninitialized)"}, now ${liveConfigDigest ?? "none (uninitialized)"}) -- refusing to run a stale project policy's test.`,
          );
        }
        // Same shape of gap as the contract check above, for the project policy
        // (`framelia.config.*`): it's file-backed and re-readable mid-process, so an
        // edit-then-revert of that file during a run's window is just as invisible to
        // finalization-time reconciliation as a contract edit-then-revert would be.
        // `resolveProjectPolicy` already folds every policy-relevant field into one
        // digest the same way `reconcileCasePlan` compares it
        // (packages/verify/src/run-bundle/reconcile.ts) -- reuse that digest directly
        // rather than re-deriving one.
        const registeredPolicy = await policyPromise;
        const livePolicy = await resolveProjectPolicy({
          cwd: projectRoot,
          projectRoot,
          allowUninitialized: true,
        });
        if (registeredPolicy.policyDigest !== livePolicy.policyDigest) {
          throw new Error(
            `defineFigmaTests: project policy for contract "${liveContract.id}" changed on disk after test collection (registered digest ${registeredPolicy.policyDigest ?? "none (uninitialized)"}, now ${livePolicy.policyDigest ?? "none (uninitialized)"}) -- refusing to run a stale project policy's test.`,
          );
        }

        const allowedProjects = liveContract.projects;
        testInfo.skip(
          allowedProjects != null && !allowedProjects.includes(testInfo.project.name),
          `contract "${liveContract.id}" does not apply to Playwright project "${testInfo.project.name}" (allowed: ${allowedProjects?.join(", ")}).`,
        );

        // The pinned baseline record/digest itself is never closed over from collection
        // time -- readPinnedBaseline is called fresh on every single execution, against
        // liveContract (itself just verified), and it's already digest-verified
        // internally against liveContract.baseline. There is no stale, pre-collection
        // copy of the *record* for anything to drift away from.
        //
        // What IS still exposed: readPinnedBaseline only verifies the shared
        // `.framelia/baselines/<digest>/` files' bytes at the moment it runs, then
        // returns paths into that same shared, externally-writable location.
        // reconcileViewport/prepare()/the full browser navigation and capture below can
        // take real, unbounded wall-clock time before compare()/attachDiffTriplet()
        // finally re-read those same shared paths -- nothing stops the shared files
        // being swapped and reverted in that window, invisible to everything including
        // finalization's own reconciliation (which only checks the pinned record's
        // digest, never the live file at the moment of use). Writing the just-verified
        // `imageBytes`/`styleBytes` -- the exact buffers readPinnedBaseline already read
        // and hashed, not a second read of the shared path via copyFileSync -- into this
        // attempt's own private workDir immediately, synchronously, right here, before
        // any further awaited work, closes that window entirely for the rest of this
        // test's execution: there is now exactly one read of each shared baseline file's
        // bytes in this whole call chain, inside readPinnedBaseline itself.
        const pinnedBaseline = await readPinnedBaseline(projectRoot, liveContract);
        const workDir = testInfo.outputPath(sanitizeAttachmentBaseName(liveContract.id));
        // `testInfo.outputPath(...)` only guarantees Playwright's own base
        // `testInfo.outputDir` exists; it does NOT create the extra path segment(s)
        // passed to it (real Playwright's implementation only `mkdirSync`s
        // `outputDir` itself, then joins the segments onto that without creating
        // them) -- writing into `workDir` (a subdirectory of `outputDir`) without
        // creating it first throws ENOENT.
        fs.mkdirSync(workDir, { recursive: true });
        const privateImagePath = path.join(
          workDir,
          `expected${path.extname(pinnedBaseline.imagePath)}`,
        );
        fs.writeFileSync(privateImagePath, pinnedBaseline.imageBytes);
        let privateStylePath: string | undefined;
        if (pinnedBaseline.stylePath && pinnedBaseline.styleBytes) {
          privateStylePath = path.join(
            workDir,
            `expected-style${path.extname(pinnedBaseline.stylePath)}`,
          );
          fs.writeFileSync(privateStylePath, pinnedBaseline.styleBytes);
        }
        const privateBaseline: PinnedBaseline = {
          ...pinnedBaseline,
          imagePath: privateImagePath,
          ...(privateStylePath ? { stylePath: privateStylePath } : {}),
        };

        await reconcileViewport(page, liveContract.viewport, liveContract.id);
        await assertDeviceScaleFactorAgreement(
          page,
          privateBaseline.snapshot.rendering.deviceScaleFactor,
          liveContract.id,
        );

        await options.prepare({ page }, { target: liveContract.target });

        const timeoutMs =
          options.timeoutMs ?? (testInfo.timeout > 0 ? testInfo.timeout : DEFAULT_TIMEOUT_MS);
        const result = await runFigmaContractTest(page, liveContract, privateBaseline, {
          timeoutMs,
          workDir,
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
          stabilitySamples: livePolicy.capture.stabilitySamples ?? MIN_STABILITY_SAMPLES,
          fontPolicy: options.fontPolicy,
          animationPolicy: options.animationPolicy,
          devtoolsSelector: options.devtoolsSelector,
          ...buildAttachContext(testInfo),
        });

        if (!result.pass) throw new Error(result.message);
      },
    );
  }
}
