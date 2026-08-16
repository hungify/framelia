import {
  SCHEMA_VERSION,
  type ContractDefaults,
  type ProfileName,
  type RunType,
  type Stability,
} from "@framelia/contracts";

import type { MaskEvidence } from "./capture/types.ts";

export { SCHEMA_VERSION };
export type { ContractDefaults, ProfileName, RunType, Stability };

export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

export type FidelityErrorCode =
  | "BASELINE_INVALID"
  | "BASELINE_NOT_FOUND"
  | "STORAGE_STATE_NOT_CONFIGURED"
  | "STORAGE_STATE_NOT_FOUND"
  | "TARGET_URL_MISMATCH"
  | "READY_SELECTOR_NOT_FOUND"
  | "READY_SELECTOR_AMBIGUOUS"
  | "FONT_READY_FAILED"
  | "READY_EVENT_NOT_FOUND"
  | "NAVIGATION_ACTION_FAILED"
  | "FIXTURE_NOT_ALLOWED"
  | "SCOPE_SIZE_MISMATCH"
  | "CAPTURE_NAVIGATION_FAILED"
  | "AUTH_SETUP_FAILED"
  | "SELECTOR_NOT_FOUND"
  | "SELECTOR_AMBIGUOUS"
  | "MASK_SELECTOR_NOT_FOUND"
  | "MASK_SELECTOR_AMBIGUOUS"
  | "MASK_NOT_VISIBLE"
  | "MASK_ZERO_SIZE"
  | "MASK_OUT_OF_SCOPE"
  | "MASK_AREA_EXCEEDED"
  | "MASK_SCOPE_INVALID"
  | "CAPTURE_SCREENSHOT_FAILED"
  | "CAPTURE_PAGE_CLOSED";

export type TopIssueKind =
  | "size"
  | "expect-size"
  | "pixel"
  | "ssim"
  | "color"
  | "cluster"
  | "style-typography"
  | "style-color"
  | "baseline-stability"
  | "capture-stability"
  | "residual";

export type TopIssueSeverity = "high" | "medium" | "low";

export interface TopIssue {
  severity: TopIssueSeverity;
  kind: TopIssueKind;
  message: string;
  hint?: string;
  /**
   * true: message names one concrete property/value an agent can set (an
   * expectSize/expectStyle mismatch with an explicit expected value).
   * false: an aggregate render-level symptom (pixel/SSIM/deltaE/cluster/residual)
   * that doesn't map to a single CSS declaration; useful for diagnosis, not
   * a direct repair instruction.
   */
  repairCandidate: boolean;
  /**
   * true: this issue is why `pass` is false (or would be, on its own).
   * false: advisory only — surfaced for a human/agent to read, never flips `pass`.
   * Residual-diff notes are always false: they're informational-only by design,
   * even when `pass` is true.
   */
  blocking: boolean;
}

export interface RejectResult {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: false;
  error: FidelityErrorCode;
  message: string;
  matchCount?: number;
  maskEvidence?: MaskEvidence;
}

export interface FigmaBaselineEvidence {
  kind: "figma";
  path: string;
  metaPath: string;
  fileKey: string;
  nodeId: string;
  fetchedAt: string;
  lastModified: string | null;
}

export type BaselineEvidence = FigmaBaselineEvidence;

export interface ExpectSize {
  width: number;
  height: number;
}

export interface ComputedTextStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  lineHeightPx: number | null;
  letterSpacingPx: number;
  color: { r: number; g: number; b: number; a: number } | null;
  backgroundColor: { r: number; g: number; b: number; a: number } | null;
}

export interface CompareOptions {
  profile: ProfileName;
  expectSize?: ExpectSize;
  clusterCheck?: boolean;
}

export interface CompareOutcome {
  pass: boolean;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  areaGapPercent: number;
  clusterFail: boolean;
  diffPixels: number | null;
  totalPixels: number | null;
  goldSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  resizedForCompare: boolean;
  topIssues: TopIssue[];
  warnings: string[];
  diffPath: string | null;
}

export interface ResolvedBaseline {
  evidence: BaselineEvidence;
  warnings: string[];
}
