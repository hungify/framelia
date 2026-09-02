import type * as z from "zod";

import type {
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  topIssueSchema,
  visualDiagnosticSchema,
} from "../score.ts";
import type { ProfileName } from "../visual-contract.ts";

export type DashboardVerdict =
  | "queued"
  | "running"
  | "passed"
  | "masked-pass"
  | "failed"
  | "blocked";
export type VerificationPhase = "baseline" | "capture" | "compare" | "gates" | "complete";
export type DashboardPhase = "queued" | VerificationPhase;

export interface DashboardImageEvidence {
  path: string;
  hash?: string;
  width?: number;
  height?: number;
}

/**
 * The concrete threshold values a comparison actually ran against -- structurally identical
 * to @framelia/verify's Profile, duplicated here (not imported) because this package sits
 * below @framelia/verify in the dependency graph (contracts has no workspace deps of its
 * own). Callers on the verify/playwright/dashboard-server side pass a Profile value straight
 * through; it satisfies this type structurally.
 */
export interface DashboardResolvedThreshold {
  name: ProfileName;
  minMatch: number;
  maxDiffPixels: number | null;
  minSSIM: number;
  maxAvgDeltaE: number;
  maxAreaGapPercent: number;
  cluster: boolean;
  stabilityMaxDiffRatio: number;
}

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
  comparison?: DashboardContractResult["comparison"];
  maskEvidence?: DashboardMaskEvidence;
  captureEvidence?: DashboardCaptureEvidence;
  resolvedThreshold?: DashboardResolvedThreshold;
  blockers: Array<{ code: string; message: string }>;
  diagnostics: DashboardDiagnostic[];
  topIssues: DashboardTopIssue[];
  styleGateEligible?: boolean;
  evidenceHash?: string;
  finishedAt: string;
}

export type DashboardSummary = Record<Exclude<DashboardVerdict, "masked-pass">, number> & {
  "masked-pass"?: number;
  total: number;
};

export interface DashboardRun {
  /** Versions this UI-projection format independently of SCHEMA_VERSION (the verification contract/artifact version). */
  schemaVersion: 1;
  runId: string;
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
