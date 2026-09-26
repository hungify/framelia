import type { StyleCheckPoint, StyleToleranceOverrides, VisualMask } from "@framelia/contracts";
import type { ExpectSize, SelectorBounds, ProfileOverrides } from "@framelia/verify";
import { compare, FigmaBaselineProvider } from "@framelia/verify";
import type { MatcherReturnType, Page } from "@playwright/test";

import {
  attachDiffTriplet,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachJsonFn,
} from "../attach.ts";
import { captureActual } from "../capture.ts";
import { resolveFigmaCompareOptions } from "../figma-profile.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "../score-attachment.ts";
import {
  buildAttributionIssues,
  captureCheckPointBounds,
  captureCheckPointStyleIssues,
  captureStyleIssues,
  withStyleCheckTimeout,
} from "../style-checks.ts";
import { withTimeout } from "../timeout.ts";

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
  /** Explicit override of whether style mismatches block the CI merge gate; unset falls back
   *  to the resolved profile's own styleGateEligible default (opt-in, default false). */
  styleGateEligible?: boolean;
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
        ? await captureCheckPointStyleIssues(
            received,
            options.styleChecks,
            options.styleToleranceOverrides,
            styleCheckTimeoutMs,
          )
        : [];

    const attributionTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const attributionIssues =
      !options.selector && options.styleChecks?.length && outcome.diffClusters.length
        ? buildAttributionIssues(
            outcome.diffClusters,
            await withTimeout(
              captureCheckPointBounds(received, options.styleChecks, options.fullPage ?? false),
              attributionTimeoutMs,
              "toMatchFigma pixel attribution",
            ).catch(() => [] as SelectorBounds[]),
          )
        : [];

    const extraIssues = [...styleIssues, ...attributionIssues];
    const outcomeWithStyle = extraIssues.length
      ? { ...outcome, topIssues: [...outcome.topIssues, ...extraIssues] }
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
        styleToleranceOverrides: options.styleToleranceOverrides,
        gateEligible: options.gateEligible,
        styleGateEligible: options.styleGateEligible,
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
