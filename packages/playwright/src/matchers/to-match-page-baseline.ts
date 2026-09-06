import * as path from "node:path";

import { visualArtifactPath } from "@framelia/contracts";
import type { VisualMask } from "@framelia/contracts";
import type { ProfileName } from "@framelia/verify";
import { compare, resolvePageBaseline } from "@framelia/verify";
import type { MatcherReturnType, Page } from "@playwright/test";

import {
  attachDiffTriplet,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachFn,
  type AttachJsonFn,
} from "../attach.ts";
import { captureActual } from "../capture.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "../score-attachment.ts";
import { withTimeout } from "../timeout.ts";

export interface ToMatchPageBaselineOptions {
  /** Region scope when set (applies to the captured side only); page scope otherwise. */
  selector?: string;
  fullPage?: boolean;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  profile?: ProfileName;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
  /** Directory a baseline was promoted into (see `framelia baseline promote` /
   *  `promotePageBaseline`). Defaults to `.framelia/visual-verifications/<key>` under cwd. */
  baselineDir?: string;
}

export interface ToMatchPageBaselineContext {
  timeoutMs: number;
  workDir: string;
  attach: AttachFn;
  attachJson: AttachJsonFn;
}

/**
 * Runner-agnostic core (see to-match-figma.ts's doc comment for why this split exists).
 * Unlike toMatchPage/toMatchUrl (two live Pages, no persisted baseline -- see #41), this
 * diffs one live capture against whatever was last accepted via `framelia baseline
 * promote` / promotePageBaseline, the same way toMatchFigma always resolves against the
 * live Figma baseline. "No baseline promoted yet" is reported as a clear, actionable
 * failure rather than throwing.
 */
export async function runToMatchPageBaseline(
  received: Page,
  key: string,
  options: ToMatchPageBaselineOptions,
  context: ToMatchPageBaselineContext,
): Promise<MatcherReturnType> {
  const { timeoutMs, workDir } = context;
  const profile = options.profile ?? (options.selector ? "component/dev" : "page");
  const baselineDir = options.baselineDir ?? path.join(process.cwd(), visualArtifactPath(key));

  const baselineOutcome = resolvePageBaseline(baselineDir);
  if (!baselineOutcome.ok) {
    return {
      pass: false,
      message: () => `toMatchPageBaseline: ${baselineOutcome.message}`,
    };
  }
  const baselineVersion = baselineOutcome.meta.current.version;

  const baseName = sanitizeAttachmentBaseName(`page-baseline-${key}`);
  try {
    const captureOutcome = await withTimeout(
      captureActual(received, {
        outPath: `${workDir}/actual.png`,
        selector: options.selector,
        fullPage: options.fullPage,
        masks: options.masks,
        maxMaskedAreaRatio: options.maxMaskedAreaRatio,
        timeoutMs,
        fontPolicy: options.fontPolicy,
        animationPolicy: options.animationPolicy,
      }),
      timeoutMs,
      "toMatchPageBaseline",
    );
    if (!captureOutcome.ok) {
      return {
        pass: false,
        message: () =>
          `toMatchPageBaseline: capture failed (${captureOutcome.error}): ${captureOutcome.message}`,
      };
    }

    const actualPath = captureOutcome.capturePaths[0]!;
    const outcome = compare(baselineOutcome.path, actualPath, workDir, {
      profile,
      maskBounds: captureOutcome.maskEvidence?.bounds,
    });

    await attachDiffTriplet(context.attach, baseName, {
      expected: baselineOutcome.path,
      actual: actualPath,
      diff: outcome.diffPath,
    });
    const scoreAttachment: FrameliaScoreAttachment = {
      ...buildScoreAttachment(outcome, {
        targetUrl: received.url(),
        baselineKind: "web",
        attachmentBaseName: baseName,
        profile,
        scope: options.selector
          ? { kind: "region", selector: options.selector }
          : { kind: "page", fullPage: options.fullPage ?? false },
        masks: options.masks,
        maxMaskedAreaRatio: options.maxMaskedAreaRatio,
        captureEvidence: captureOutcome,
      }),
      baselinePromotedAt: baselineOutcome.meta.current.promotedAt,
      baselinePromotedBy: baselineOutcome.meta.current.promotedBy,
      baselineVersion,
      ...(baselineOutcome.meta.current.runId !== undefined
        ? { baselineRunId: baselineOutcome.meta.current.runId }
        : {}),
    };
    await context.attachJson(`${baseName}${SCORE_ATTACHMENT_SUFFIX}`, scoreAttachment);

    return {
      pass: outcome.pass,
      message: () =>
        outcome.pass
          ? `toMatchPageBaseline: ${key} matched promoted baseline v${baselineVersion} (matchRatio ${outcome.matchRatio?.toFixed(4)}).`
          : `toMatchPageBaseline: ${key} did not match promoted baseline v${baselineVersion} (matchRatio ${outcome.matchRatio?.toFixed(4) ?? "n/a"}, ssim ${outcome.ssim?.toFixed(4) ?? "n/a"}). See attached expected/actual/diff, or run \`framelia baseline promote\` if this change is intentional.`,
    };
  } catch (error) {
    return {
      pass: false,
      message: () =>
        `toMatchPageBaseline: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
