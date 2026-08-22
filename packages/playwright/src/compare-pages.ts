import type { VisualMask } from "@framelia/contracts";
import type { ProfileName } from "@framelia/verify";
import { compare } from "@framelia/verify";
import type { MatcherReturnType, Page } from "@playwright/test";

import {
  attachDiffTriplet,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachFn,
  type AttachJsonFn,
} from "./attach.ts";
import { captureActual } from "./capture.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "./score-attachment.ts";
import { withTimeout } from "./timeout.ts";

export interface ComparePagesOptions {
  /** Region scope when set (applies to both sides); page scope otherwise. */
  selector?: string;
  fullPage?: boolean;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  profile?: ProfileName;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
}

export interface ComparePagesContext {
  timeoutMs: number;
  workDir: string;
  attach: AttachFn;
  attachJson: AttachJsonFn;
}

/**
 * Shared web-vs-web diff tail for toMatchPage and toMatchUrl — neither
 * matcher owns navigation; both diff two already-navigated Pages via the same
 * capture/compare/attach-on-failure pipeline.
 */
export async function runComparePages(
  matcherLabel: string,
  pageA: Page,
  pageB: Page,
  baseName: string,
  options: ComparePagesOptions,
  context: ComparePagesContext,
): Promise<MatcherReturnType> {
  const { timeoutMs, workDir } = context;
  // Web-to-web comparisons default to component/dev (not toMatchFigma's
  // component/strict) — these have no Figma baseline, aren't done-gate
  // eligible, and dev's looser thresholds fit an informal check.
  const profile = options.profile ?? (options.selector ? "component/dev" : "page");

  try {
    const [captureA, captureB] = await withTimeout(
      Promise.all([
        captureActual(pageA, {
          outPath: `${workDir}/a.png`,
          selector: options.selector,
          fullPage: options.fullPage,
          masks: options.masks,
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
          timeoutMs,
          fontPolicy: options.fontPolicy,
          animationPolicy: options.animationPolicy,
        }),
        captureActual(pageB, {
          outPath: `${workDir}/b.png`,
          selector: options.selector,
          fullPage: options.fullPage,
          masks: options.masks,
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
          timeoutMs,
          fontPolicy: options.fontPolicy,
          animationPolicy: options.animationPolicy,
        }),
      ]),
      timeoutMs,
      matcherLabel,
    );

    if (!captureA.ok) {
      return {
        pass: false,
        message: () =>
          `${matcherLabel}: capturing the received page failed (${captureA.error}): ${captureA.message}`,
      };
    }
    if (!captureB.ok) {
      return {
        pass: false,
        message: () =>
          `${matcherLabel}: capturing the comparison page failed (${captureB.error}): ${captureB.message}`,
      };
    }

    const aPath = captureA.capturePaths[0]!;
    const bPath = captureB.capturePaths[0]!;
    // Both sides share the same selector/mask config, but each resolves its own
    // bounds against its own page -- union them so either side's masked pixels
    // are excluded from scoring, not just whichever side happened to match first.
    const maskBounds = [
      ...(captureA.maskEvidence?.bounds ?? []),
      ...(captureB.maskEvidence?.bounds ?? []),
    ];
    const outcome = compare(bPath, aPath, workDir, { profile, maskBounds });

    await attachDiffTriplet(context.attach, baseName, {
      expected: bPath,
      actual: aPath,
      diff: outcome.diffPath,
    });
    const scoreAttachment: FrameliaScoreAttachment = buildScoreAttachment(outcome, {
      targetUrl: pageA.url(),
      baselineKind: "web",
      attachmentBaseName: baseName,
      profile,
      scope: options.selector
        ? { kind: "region", selector: options.selector }
        : { kind: "page", fullPage: options.fullPage ?? false },
      masks: options.masks,
      maxMaskedAreaRatio: options.maxMaskedAreaRatio,
      captureEvidence: captureA,
    });
    await context.attachJson(`${baseName}${SCORE_ATTACHMENT_SUFFIX}`, scoreAttachment);

    return {
      pass: outcome.pass,
      message: () =>
        outcome.pass
          ? `${matcherLabel}: pages matched (matchRatio ${outcome.matchRatio?.toFixed(4)}).`
          : `${matcherLabel}: pages did not match (matchRatio ${outcome.matchRatio?.toFixed(4) ?? "n/a"}, ssim ${outcome.ssim?.toFixed(4) ?? "n/a"}). See attached expected/actual/diff.`,
    };
  } catch (error) {
    return {
      pass: false,
      message: () => `${matcherLabel}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
