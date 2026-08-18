/**
 * Every matcher attaches one of these (pass or fail, always) alongside the
 * conditional -expected/-actual/-diff image triplet. The Reporter
 * runs out-of-process from the Page/matcher and has no other channel to see
 * per-call comparison results -- TestResult only exposes attachments, not
 * matcher return values. See SCORE_ATTACHMENT_SUFFIX in attach.ts.
 */
export interface FrameliaScoreAttachment {
  pass: boolean;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  diffPixels: number | null;
  baselineSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  targetUrl: string;
  baselineKind: "figma" | "web";
  attachmentBaseName?: string;
  profile?: ProfileName;
  scope?: MatcherScope;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  captureEvidence?: CaptureEvidence;
  baselineFetchedAt?: string;
  baselineLastModified?: string | null;
  topIssues?: Array<{ kind: string; severity: string; message: string }>;
  warnings?: string[];
  /** Set only for baselineKind "figma" -- lets the Reporter rebuild a real baseline pointer. */
  fileKey?: string;
  nodeId?: string;
}
import type { VisualMask } from "@framelia/contracts";
import type { CompareOutcome, ExpectSize, ProfileName } from "@framelia/verify";
import type { CaptureEvidence } from "@framelia/verify/internal";

export type MatcherScope =
  | { kind: "page"; fullPage: boolean }
  | { kind: "region"; selector: string; expectedSize?: ExpectSize };

/** Fields a matcher must supply on top of what a compare() outcome already carries. */
export interface ScoreAttachmentBase {
  targetUrl: string;
  baselineKind: "figma" | "web";
  attachmentBaseName: string;
  profile: ProfileName;
  scope: MatcherScope;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  captureEvidence?: CaptureEvidence;
}

/**
 * The one place that turns a compare() outcome into a FrameliaScoreAttachment.
 * Every matcher (toMatchFigma, toMatchPage, toMatchUrl) calls this so outcome
 * fields like topIssues/warnings can't be silently dropped by one caller.
 */
export function buildScoreAttachment(
  outcome: CompareOutcome,
  base: ScoreAttachmentBase,
): FrameliaScoreAttachment {
  return {
    pass: outcome.pass,
    matchRatio: outcome.matchRatio,
    ssim: outcome.ssim,
    avgDeltaE: outcome.avgDeltaE,
    diffPixels: outcome.diffPixels,
    baselineSize: outcome.baselineSize,
    actualSize: outcome.actualSize,
    topIssues: outcome.topIssues,
    warnings: outcome.warnings,
    ...base,
  };
}
