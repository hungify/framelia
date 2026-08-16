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
  goldSize: { width: number; height: number };
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
import type { ExpectSize, ProfileName } from "@framelia/verify";
import type { CaptureEvidence } from "@framelia/verify/internal";

export type MatcherScope =
  | { kind: "page"; fullPage: boolean }
  | { kind: "region"; selector: string; expectedSize?: ExpectSize };
