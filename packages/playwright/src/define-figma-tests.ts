import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { authoredContractSchema, contractBindingSchema } from "@framelia/contracts/workflow";
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
import { discoverProjectConfig } from "@framelia/verify/project-policy";
import type { Page, TestInfo, TestType } from "@playwright/test";
import * as z from "zod";

import {
  attachDiffTriplet,
  buildAttachContext,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
} from "./attach.ts";
import { resolveFigmaCompareOptions } from "./figma-profile.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "./score-attachment.ts";
import {
  buildAttributionIssues,
  captureCheckPointBounds,
  captureCheckPointStyleIssues,
  captureStyleIssues,
  withStyleCheckTimeout,
} from "./style-checks.ts";
import { withTimeout } from "./timeout.ts";

/** Annotation `type` every registered test carries (see defineFigmaTests's doc comment). */
const CONTRACT_ANNOTATION_TYPE = "framelia.contract";

const DEFAULT_TIMEOUT_MS = 60_000;

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

  for (const input of inputs) {
    const contractFilePath = resolveContractFilePath(input);
    const { contract, digest } = loadContractFile(contractFilePath);
    const projectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : discoverProjectConfig(path.dirname(contractFilePath)).root;
    const contractFile = toPortablePath(path.relative(projectRoot, contractFilePath));
    const binding = contractBindingSchema.parse({
      formatVersion: 1,
      kind: "framelia.contract-binding",
      contractId: contract.id,
      contractFile,
      contractDigest: digest,
    });

    test(
      contract.name,
      { annotation: { type: CONTRACT_ANNOTATION_TYPE, description: JSON.stringify(binding) } },
      // `{ page }` is the only fixture name this generic library can statically declare
      // here -- see DefineFigmaTestsOptions's own doc comment for why Playwright's
      // fixture-parser constraint rules out forwarding a caller's full, unknown-in-advance
      // fixture set.
      async ({ page }: { page: Page }, testInfo: TestInfo) => {
        const allowedProjects = contract.projects;
        testInfo.skip(
          allowedProjects != null && !allowedProjects.includes(testInfo.project.name),
          `contract "${contract.id}" does not apply to Playwright project "${testInfo.project.name}" (allowed: ${allowedProjects?.join(", ")}).`,
        );

        const pinnedBaseline = await readPinnedBaseline(projectRoot, contract);

        await reconcileViewport(page, contract.viewport, contract.id);
        await assertDeviceScaleFactorAgreement(
          page,
          pinnedBaseline.snapshot.rendering.deviceScaleFactor,
          contract.id,
        );

        await options.prepare({ page }, { target: contract.target });

        const timeoutMs =
          options.timeoutMs ?? (testInfo.timeout > 0 ? testInfo.timeout : DEFAULT_TIMEOUT_MS);
        const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
          timeoutMs,
          workDir: testInfo.outputPath(sanitizeAttachmentBaseName(contract.id)),
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
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
