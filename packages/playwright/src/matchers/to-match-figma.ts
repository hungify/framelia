import type { StyleCheckPoint, VisualMask } from "@framelia/contracts";
import type {
  ExpectSize,
  StyleSnapshot,
  TopIssue,
  ProfileOverrides,
  StyleToleranceOverrides,
} from "@framelia/verify";
import {
  compare,
  compareStyles,
  expectStyleToSnapshot,
  FigmaBaselineProvider,
} from "@framelia/verify";
import type { ExpectMatcherState, MatcherReturnType, Page } from "@playwright/test";
import { test } from "@playwright/test";

import {
  attachDiffTriplet,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachJsonFn,
} from "../attach.ts";
import { captureElementStyle } from "../capture-style.ts";
import { captureActual } from "../capture.ts";
import { resolveFigmaCompareOptions } from "../figma-profile.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "../score-attachment.ts";
import { withTimeout } from "../timeout.ts";

/**
 * Style comparison is best-effort and informational-only (see compareStyles):
 * a capture-style failure (stale selector, detached element) must never fail
 * the match itself, only skip the style issues for this run.
 */
async function captureStyleIssues(
  page: Page,
  selector: string,
  figmaStyle: StyleSnapshot,
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
): Promise<TopIssue[]> {
  try {
    const actualStyle = await captureElementStyle(page, selector);
    return compareStyles(figmaStyle, actualStyle, styleToleranceOverrides);
  } catch {
    return [];
  }
}

/**
 * Bounds any style comparison (region's single selector or page's check-points) by the
 * matcher's own timeoutMs -- a stale or missing selector's page.$eval has no timeout of
 * its own and can otherwise hang past the matcher's configured timeout, delaying score
 * and image attachment. Style issues are always best-effort (see captureStyleIssues), so
 * a timeout here degrades to no issues rather than failing the match.
 */
async function withStyleCheckTimeout(
  work: Promise<TopIssue[]>,
  timeoutMs: number,
): Promise<TopIssue[]> {
  try {
    return await withTimeout(work, timeoutMs, "toMatchFigma style check");
  } catch {
    return [];
  }
}

/**
 * Page-scope equivalent of the region-scope bake-in above: one style comparison per
 * declared check-point, each against its own baked `expectStyle` (there's no live
 * per-checkpoint Figma baseline to re-fetch at verify time -- see #26/#27). A
 * check-point whose `expectStyle` never baked at authoring time is skipped rather
 * than compared against nothing. Every resulting issue is tagged with the
 * check-point's own selector so multiple check-points stay distinguishable in
 * `topIssues` (see TopIssue.selector).
 */
async function captureCheckPointStyleIssues(
  page: Page,
  checkPoints: StyleCheckPoint[],
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
): Promise<TopIssue[]> {
  const perCheckPoint = await Promise.all(
    checkPoints
      .filter(
        (
          checkPoint,
        ): checkPoint is StyleCheckPoint & {
          expectStyle: NonNullable<StyleCheckPoint["expectStyle"]>;
        } => checkPoint.expectStyle !== undefined,
      )
      .map(async (checkPoint) => {
        const issues = await captureStyleIssues(
          page,
          checkPoint.selector,
          expectStyleToSnapshot(checkPoint.expectStyle),
          styleToleranceOverrides,
        );
        return issues.map((issue) => Object.assign({}, issue, { selector: checkPoint.selector }));
      }),
  );
  return perCheckPoint.flat();
}

export interface ToMatchFigmaOptions {
  /** Figma file key. Falls back to FRAMELIA_FIGMA_FILE_KEY when omitted. */
  fileKey?: string;
  /** Region scope when set (diffs only this selector's bounding box); page scope otherwise. */
  selector?: string;
  expectSize?: ExpectSize;
  fullPage?: boolean;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  profile?: "page" | "component/strict" | "component/dev";
  /** Explicit per-contract threshold overrides, merged on top of the resolved profile's own defaults. */
  profileOverrides?: ProfileOverrides;
  /** Explicit per-contract style-comparison tolerance overrides, merged on top of compareStyles()'s own defaults. */
  styleToleranceOverrides?: StyleToleranceOverrides;
  /** Page-scope only: one style comparison per declared check-point, each against its own
   *  baked `expectStyle` (see #26). Ignored when `selector` is set (region scope). */
  styleChecks?: StyleCheckPoint[];
  /** Explicit override of whether this contract's resolved threshold blocks the CI merge
   *  gate; unset falls back to the resolved profile's own gateEligible default. */
  gateEligible?: boolean;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
}

export interface ToMatchFigmaContext {
  timeoutMs: number;
  workDir: string;
  /** Attaches a file at `path` under `name`; wraps TestInfo.attach in the real matcher. */
  attach: (name: string, path: string) => Promise<void>;
  attachJson: AttachJsonFn;
}

const FILE_KEY_ENV_VAR = "FRAMELIA_FIGMA_FILE_KEY";

/**
 * Runner-agnostic core: everything toMatchFigma does except reach into
 * Playwright's test-runner globals (`test.info()`, `this.timeout`). Split out
 * so it can run under Vitest without a live Playwright test context —
 * `test.info()` throws outside one, and playwright/test's `setCurrentTestInfo`
 * that fakes one is an unexported internal, which this project's "no internal
 * APIs" principle rules out using even for test scaffolding.
 */
export async function runToMatchFigma(
  received: Page,
  nodeId: string,
  options: ToMatchFigmaOptions,
  context: ToMatchFigmaContext,
): Promise<MatcherReturnType> {
  const { timeoutMs, workDir } = context;
  const fileKey = options.fileKey ?? process.env[FILE_KEY_ENV_VAR];
  if (!fileKey) {
    return {
      pass: false,
      message: () =>
        `toMatchFigma: no Figma file key. Pass { fileKey } or set ${FILE_KEY_ENV_VAR}.`,
    };
  }

  const baseName = sanitizeAttachmentBaseName(nodeId);
  const { profile, clusterCheck } = resolveFigmaCompareOptions(
    options.profile,
    Boolean(options.selector),
  );
  const startedAt = Date.now();

  try {
    const [baselineOutcome, captureOutcome] = await withTimeout(
      Promise.all([
        new FigmaBaselineProvider().resolve({
          source: { kind: "figma", fileKey, nodeId },
          outDir: workDir,
          profile,
          stabilitySamples: 1,
          defaults: {},
        }),
        captureActual(received, {
          outPath: `${workDir}/actual.png`,
          selector: options.selector,
          expectedSize: options.expectSize,
          fullPage: options.fullPage,
          masks: options.masks,
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
          timeoutMs,
          fontPolicy: options.fontPolicy,
          animationPolicy: options.animationPolicy,
        }),
      ]),
      timeoutMs,
      "toMatchFigma",
    );

    if (!baselineOutcome.ok) {
      return {
        pass: false,
        message: () =>
          `toMatchFigma: Figma baseline fetch failed (${baselineOutcome.error}): ${baselineOutcome.message}`,
      };
    }
    if (!captureOutcome.ok) {
      return {
        pass: false,
        message: () =>
          `toMatchFigma: capture failed (${captureOutcome.error}): ${captureOutcome.message}`,
      };
    }

    const actualPath = captureOutcome.capturePaths[0]!;
    const outcome = compare(baselineOutcome.baseline.evidence.path, actualPath, workDir, {
      profile,
      clusterCheck,
      profileOverrides: options.profileOverrides,
      maskBounds: captureOutcome.maskEvidence?.bounds,
    });

    // Region scope (selector set) -- style comparison needs a single element to
    // capture computed style from, and only applies when the Figma baseline fetch
    // was fresh enough to have extracted one (see ResolvedBaseline). Page scope
    // (no selector) instead runs one comparison per declared check-point, each
    // against its own baked expectStyle rather than the page's own Figma baseline
    // (see #27) -- gated on `!options.selector` so a region call whose baseline
    // fetch didn't yield a figmaStyle can never fall through into check-point
    // diagnostics that don't belong to it.
    //
    // Bounded by what's left of timeoutMs after the baseline+capture race above,
    // not a fresh timeoutMs window -- reusing the full budget here would let the
    // matcher run up to 2x its configured timeout before returning, which could
    // blow past Playwright's own enforced test/expect timeout instead of failing
    // gracefully with our own message (see review on #32).
    const styleCheckTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const styleIssues = options.selector
      ? baselineOutcome.baseline.figmaStyle
        ? await withStyleCheckTimeout(
            captureStyleIssues(
              received,
              options.selector,
              baselineOutcome.baseline.figmaStyle,
              options.styleToleranceOverrides,
            ),
            styleCheckTimeoutMs,
          )
        : []
      : options.styleChecks
        ? await withStyleCheckTimeout(
            captureCheckPointStyleIssues(
              received,
              options.styleChecks,
              options.styleToleranceOverrides,
            ),
            styleCheckTimeoutMs,
          )
        : [];
    // Style mismatches are informational-only (TopIssue.blocking: false) and
    // never affect `outcome.pass` -- merged in after compare() decided pass/fail.
    const outcomeWithStyle = styleIssues.length
      ? { ...outcome, topIssues: [...outcome.topIssues, ...styleIssues] }
      : outcome;

    await attachDiffTriplet(context.attach, baseName, {
      expected: baselineOutcome.baseline.evidence.path,
      actual: actualPath,
      diff: outcome.diffPath,
    });
    const scoreAttachment: FrameliaScoreAttachment = {
      ...buildScoreAttachment(outcomeWithStyle, {
        targetUrl: received.url(),
        baselineKind: "figma",
        attachmentBaseName: baseName,
        profile,
        clusterCheck,
        profileOverrides: options.profileOverrides,
        gateEligible: options.gateEligible,
        scope: options.selector
          ? { kind: "region", selector: options.selector, expectedSize: options.expectSize }
          : { kind: "page", fullPage: options.fullPage ?? false },
        masks: options.masks,
        maxMaskedAreaRatio: options.maxMaskedAreaRatio,
        captureEvidence: captureOutcome,
      }),
      baselineFetchedAt: baselineOutcome.baseline.evidence.fetchedAt,
      baselineLastModified: baselineOutcome.baseline.evidence.lastModified,
      fileKey,
      nodeId,
    };
    await context.attachJson(`${baseName}${SCORE_ATTACHMENT_SUFFIX}`, scoreAttachment);

    return {
      pass: outcome.pass,
      message: () =>
        outcome.pass
          ? `toMatchFigma: ${nodeId} matched (matchRatio ${outcome.matchRatio?.toFixed(4)}).`
          : `toMatchFigma: ${nodeId} did not match Figma baseline (matchRatio ${outcome.matchRatio?.toFixed(4) ?? "n/a"}, ssim ${outcome.ssim?.toFixed(4) ?? "n/a"}). See attached expected/actual/diff.`,
    };
  } catch (error) {
    return {
      pass: false,
      message: () => `toMatchFigma: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The registered matcher: thin Playwright-runner glue around {@link runToMatchFigma}.
 * `this: ExpectMatcherState` is Playwright's own expect.extend() contract, not an
 * import-bound `this` a bundler could drop — Playwright always invokes matchers with
 * `this` bound to ExpectMatcherState via its own dispatcher.
 */
export async function toMatchFigma(
  this: ExpectMatcherState,
  received: Page,
  nodeId: string,
  options: ToMatchFigmaOptions = {},
): Promise<MatcherReturnType> {
  const testInfo = test.info();
  // oxlint-disable-next-line no-this-in-exported-function -- see doc comment above.
  const timeoutMs = this.timeout;
  return runToMatchFigma(received, nodeId, options, {
    timeoutMs,
    workDir: testInfo.outputPath(sanitizeAttachmentBaseName(nodeId)),
    attach: (name, path) =>
      testInfo.attach(name, { path, contentType: "image/png" }).then(() => undefined),
    attachJson: (name, data) =>
      testInfo
        .attach(name, { body: JSON.stringify(data), contentType: "application/json" })
        .then(() => undefined),
  });
}
