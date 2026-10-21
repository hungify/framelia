import * as path from "node:path";

import { resolveDisplayThreshold, visualArtifactPath } from "@framelia/contracts";
import type { VisualMask } from "@framelia/contracts";
import type { ProfileName } from "@framelia/verify";
import { compare, promotePageBaseline, resolvePageBaseline } from "@framelia/verify";
import type { MatcherReturnType, Page } from "@playwright/test";

import {
  attachDiffTriplet,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachFn,
  type AttachJsonFn,
} from "../attach.ts";
import { captureActual } from "../capture.ts";
import { describeMismatch, operationalFailure } from "../matcher-outcome.ts";
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
  /** Hides dev-only overlays (TanStack Query/Router devtools, Next.js's dev overlay) before
   *  capture: `true` uses the built-in selector, or pass a custom CSS selector. */
  devtoolsSelector?: true | string;
  /** Directory a baseline was promoted into (see `framelia baseline promote` /
   *  `promotePageBaseline`). Defaults to `.framelia/visual-verifications/<key>` under cwd. */
  baselineDir?: string;
  /** Per-call deadline in ms for capture+compare; defaults to the expect timeout. */
  timeout?: number;
}

/** Playwright's own `--update-snapshots` modes (`testInfo.config.updateSnapshots`). */
export type UpdateSnapshotsMode = "all" | "changed" | "missing" | "none";

export interface ToMatchPageBaselineContext {
  timeoutMs: number;
  workDir: string;
  attach: AttachFn;
  attachJson: AttachJsonFn;
  /** Promotes this call's capture as the new baseline instead of failing: "missing" when
   *  none is promoted yet, "changed" also on a mismatch, "all" always. Default "none". */
  updateSnapshots?: UpdateSnapshotsMode;
}

/** Who a `--update-snapshots` promotion is recorded as (see `framelia baseline promote`). */
const UPDATE_SNAPSHOTS_PROMOTER = "playwright --update-snapshots";

/**
 * Runner-agnostic core (see to-match-figma.ts's doc comment for why this split exists).
 * Unlike toMatchPage/toMatchUrl (two live Pages, no persisted baseline -- see #41), this
 * diffs one live capture against whatever was last accepted via `framelia baseline
 * promote` / promotePageBaseline, the same way toMatchFigma always resolves against the
 * live Figma baseline. "No baseline promoted yet" is reported as a clear, actionable
 * failure rather than throwing -- unless Playwright's `--update-snapshots` asks for it to
 * be written, in which case this capture is promoted through the same versioned
 * `promotePageBaseline` the CLI uses (prior versions stay recoverable).
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

  const updateSnapshots = context.updateSnapshots ?? "none";
  const baselineOutcome = resolvePageBaseline(baselineDir);
  if (!baselineOutcome.ok && updateSnapshots === "none") {
    return operationalFailure(`toMatchPageBaseline: ${baselineOutcome.message}`);
  }

  const baseName = sanitizeAttachmentBaseName(`page-baseline-${key}`);
  const promote = async (actualPath: string, reason: string): Promise<MatcherReturnType> => {
    const promoted = promotePageBaseline({
      sourcePath: actualPath,
      outDir: baselineDir,
      promotedBy: UPDATE_SNAPSHOTS_PROMOTER,
      note: reason,
    });
    await context.attach(`${baseName}-actual`, actualPath);
    return {
      pass: true,
      message: () =>
        `toMatchPageBaseline: ${reason}; promoted this capture as ${key} baseline v${promoted.meta.current.version} (--update-snapshots=${updateSnapshots}).`,
    };
  };
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
        devtoolsSelector: options.devtoolsSelector,
      }),
      timeoutMs,
      "toMatchPageBaseline",
    );
    if (!captureOutcome.ok) {
      return operationalFailure(
        `toMatchPageBaseline: capture failed (${captureOutcome.error}): ${captureOutcome.message}`,
      );
    }

    const actualPath = captureOutcome.capturePaths[0]!;
    if (!baselineOutcome.ok) return await promote(actualPath, "no promoted baseline yet");
    const baselineVersion = baselineOutcome.meta.current.version;
    if (updateSnapshots === "all") {
      return await promote(actualPath, `replacing baseline v${baselineVersion}`);
    }
    const outcome = compare(baselineOutcome.path, actualPath, workDir, {
      profile,
      maskBounds: captureOutcome.maskEvidence?.bounds,
    });
    if (!outcome.pass && updateSnapshots === "changed") {
      return await promote(actualPath, `baseline v${baselineVersion} no longer matched`);
    }

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
          : `toMatchPageBaseline: ${key} did not match promoted baseline v${baselineVersion} (${describeMismatch(outcome, resolveDisplayThreshold({ profile }))}). See attached expected/actual/diff, or run \`framelia baseline promote\` (or Playwright with --update-snapshots) if this change is intentional.`,
    };
  } catch (error) {
    return operationalFailure(
      `toMatchPageBaseline: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
