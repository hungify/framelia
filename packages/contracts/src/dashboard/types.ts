import type * as z from "zod";

import type { Profile, ThresholdOverrideSource } from "../profiles.ts";
import type {
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  topIssueSchema,
  visualDiagnosticSchema,
} from "../score.ts";

export type DashboardVerdict =
  | "queued"
  | "running"
  | "passed"
  | "masked-pass"
  | "failed"
  | "blocked";
export type VerificationPhase = "baseline" | "capture" | "compare" | "gates" | "complete";
export type DashboardPhase = "queued" | VerificationPhase;
export type DashboardExecutionState = "running" | "completed" | "blocked" | "incomplete" | "error";
export type DashboardVisualVerdict = "passed" | "mismatched" | "not-evaluated";
export type DashboardEvidenceAvailability = "available" | "missing" | "invalid" | "not-recorded";

export interface DashboardAttempt {
  runId: string;
  attemptId: string;
  casePlanDigest: string;
  retryIndex: number;
  selected: boolean;
  executionState: DashboardExecutionState;
  visualVerdict: DashboardVisualVerdict;
  evidence: Record<
    "expected" | "actual" | "diff" | "score",
    {
      availability: DashboardEvidenceAvailability;
      path?: string;
      digest?: string;
      message?: string;
    }
  >;
  baseline?: {
    snapshotDigest: string;
    kind: "figma" | "web";
    fileKey?: string;
    nodeId?: string;
    sourceRunId?: string;
  };
  scoreProvenance?: {
    formatVersion?: number;
    digest: string;
  };
  comparison?: {
    matchRatio: number | null;
    ssim: number | null;
    avgDeltaE: number | null;
    diffPixels: number | null;
  };
  topIssues: Array<z.infer<typeof topIssueSchema>>;
  diagnostics: Array<z.infer<typeof visualDiagnosticSchema>>;
  warnings: string[];
}

export interface DashboardImageEvidence {
  path: string;
  hash?: string;
  width?: number;
  height?: number;
}

/**
 * The concrete threshold values a comparison actually ran against. This is the profile
 * table's own `Profile` -- previously a hand-kept structural copy that omitted
 * `gateEligible`/`styleGateEligible` even though `resolveDisplayThreshold` has always put
 * them on the wire.
 */
export type DashboardResolvedThreshold = Profile;

export type DashboardDiagnostic = z.infer<typeof visualDiagnosticSchema>;

export type DashboardTopIssue = z.infer<typeof topIssueSchema>;

export type DashboardMaskEvidence = z.infer<typeof captureMaskEvidenceSchema>;

export type DashboardCaptureEvidence = z.infer<typeof captureEvidenceSchema> & {
  expectedUrl?: string;
  redirectMismatch: boolean;
  artifactPaths: { score?: string; baseline?: string; actual?: string; diff?: string };
};

export interface DashboardContractResult {
  id: string;
  name: string;
  feature?: string;
  tags: string[];
  /** Durable selected-run identity. Absent only for low-level ephemeral matcher results. */
  sourceRunId?: string;
  caseId?: string;
  contractId?: string;
  projectName?: string;
  repeatIndex?: number;
  targetPath?: string;
  executionState?: DashboardExecutionState;
  visualVerdict?: DashboardVisualVerdict;
  selectedAttemptId?: string;
  attempts?: DashboardAttempt[];
  provenance?: {
    policyDigest: string;
    retryAcceptance: "require-first-attempt" | "allow-passed-after-retry";
    sourceDigest?: string;
    buildDigest?: string;
    dirty?: boolean;
    bindingDigest: string;
    specFile: string;
    specFileDigest: string;
    titlePath: string[];
  };
  status: DashboardVerdict;
  phase: DashboardPhase;
  baselineKind: "figma" | "page";
  baseline?: DashboardImageEvidence & {
    revision?: string;
    provenance: string;
    /** Set only for a toMatchPageBaseline result -- who/when/from-what-run accepted
     *  this baseline via `framelia baseline promote` (see #41). */
    promotedAt?: string;
    promotedBy?: string;
    runId?: string;
  };
  actual?: DashboardImageEvidence & { url: string };
  diff?: DashboardImageEvidence;
  capture: {
    kind: "viewport" | "element";
    viewport: { width: number; height: number };
    target?: {
      definition: { kind: "css"; value: string };
      matchCount: number;
      stable: boolean;
      expectedSize?: { width: number; height: number };
      actualSize?: { width: number; height: number };
      reason?: string;
    };
  };
  comparison?: {
    algorithm: "framelia-multi-signal";
    diffPixels: number | null;
    diffRatio: number | null;
    matchRatio: number | null;
    ssim: number | null;
    avgDeltaE: number | null;
    sizeMatch: boolean;
  };
  blockers: Array<{ code: string; message: string }>;
  /** Evidence caveats; blocking diagnostics cannot be projected as passed. */
  diagnostics?: DashboardDiagnostic[];
  /** Field-level mismatches vs. the Figma baseline's style (color, typography, spacing,
   * corner radius) -- never affects `status` (the live dashboard verdict). May still block
   * the separate CI done-gate when `styleGateEligible` is true. See compareStyles() in
   * @framelia/verify. */
  topIssues?: DashboardTopIssue[];
  /** This contract's resolved style-gate eligibility (explicit override or profile default,
   * see @framelia/verify's resolveStyleGateEligible) -- lets the dashboard show whether style
   * mismatches above are informational-only or enforced at the CI merge gate. */
  styleGateEligible?: boolean;
  maskEvidence?: DashboardMaskEvidence;
  captureEvidence?: DashboardCaptureEvidence;
  resolvedThreshold?: DashboardResolvedThreshold;
  evidenceHash?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** Common subset of VisualScoreArtifact (dashboard-server) and FrameliaScoreAttachment
 * (playwright reporter) that DashboardContractResult["comparison"] is derived from --
 * the two packages read scores off different channels (a persisted artifact vs. a
 * Playwright attachment) but compute the same comparison summary from them. */
export interface ComparisonSummaryInput {
  diffPixels: number | null;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  baselineSize: { width: number; height: number };
  actualSize: { width: number; height: number };
}

/**
 * Everything a dashboard result's comparison, resolved threshold, and style-gate
 * eligibility are derived from. Both producers satisfy this structurally: a persisted
 * `VisualScoreArtifact` (dashboard-server) and a Playwright score attachment
 * (@framelia/playwright's reporter). Passing the score itself, rather than three
 * separately-derived fields, is what keeps the live and durable paths from drifting.
 */
export interface ContractScoreInput extends ComparisonSummaryInput, ThresholdOverrideSource {
  styleGateEligible?: boolean;
}

export interface ProjectCaptureRegion {
  selector: string;
  matchCount: number;
  stable: boolean;
  expectedSize?: { width: number; height: number };
  actualSize?: { width: number; height: number };
  reason?: string;
}

export interface ProjectCaptureInput {
  viewport: { width: number; height: number };
  region?: ProjectCaptureRegion;
}

export interface DashboardVerdictInput {
  /** False for a structural failure (selector didn't resolve, etc.) -- distinct from a clean visual mismatch. */
  resultOk: boolean;
  /** The visual comparison's own pass/fail, independent of resultOk. */
  pass: boolean;
  diagnostics: readonly DashboardDiagnostic[];
  maskApplied: boolean;
}

export interface ContractResultAssemblyInput {
  id: string;
  name: string;
  tags: string[];
  status: DashboardVerdict;
  baselineKind: "figma" | "page";
  baseline?: DashboardContractResult["baseline"];
  actual?: DashboardContractResult["actual"];
  diff?: DashboardContractResult["diff"];
  capture: DashboardContractResult["capture"];
  /** The score this result was produced from, if the comparison ran at all. Its
   *  `comparison`, `resolvedThreshold`, and `styleGateEligible` are derived here. */
  score?: ContractScoreInput;
  maskEvidence?: DashboardMaskEvidence;
  captureEvidence?: DashboardCaptureEvidence;
  blockers: Array<{ code: string; message: string }>;
  diagnostics: DashboardDiagnostic[];
  topIssues: DashboardTopIssue[];
  evidenceHash?: string;
  finishedAt: string;
}

export type DashboardSummary = Record<Exclude<DashboardVerdict, "masked-pass">, number> & {
  "masked-pass"?: number;
  total: number;
};

export interface DashboardRun {
  /** Versions this UI-projection format independently of SCHEMA_VERSION (the verification contract/artifact version). */
  schemaVersion: 2;
  runId: string;
  coverage?: {
    available: number;
    required: number;
    selected: number;
    selectionMode: "all" | "subset";
    availableCaseIds: string[];
    requiredCaseIds: string[];
    selectedCaseIds: string[];
  };
  executionState?: "running" | "completed" | "incomplete" | "error";
  visualVerdict?: DashboardVisualVerdict;
  suiteName?: string;
  status: DashboardVerdict;
  summary: DashboardSummary;
  contracts: DashboardContractResult[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface DashboardEvent {
  sequence: number;
  runId: string;
  contractId?: string;
  phase?: DashboardPhase;
  status: DashboardVerdict;
  timestamp: string;
}
