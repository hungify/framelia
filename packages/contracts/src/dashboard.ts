import type * as z from "zod";

import type {
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  visualDiagnosticSchema,
} from "./score.ts";

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

/** Same shape score.ts's visualDiagnosticSchema validates in visual-score.json's diagnostics. */
export type DashboardDiagnostic = z.infer<typeof visualDiagnosticSchema>;

/** Same shape capture writes into visual-score.json's maskEvidence field. */
export type DashboardMaskEvidence = z.infer<typeof captureMaskEvidenceSchema>;

/**
 * Same shape capture writes into visual-score.json's captureEvidence field, plus fields the
 * dashboard projection layer computes on top of it (expectedUrl/redirectMismatch/artifactPaths
 * aren't part of the raw capture evidence — they're derived when building the projection).
 */
export type DashboardCaptureEvidence = z.infer<typeof captureEvidenceSchema> & {
  expectedUrl?: string;
  redirectMismatch: boolean;
  artifactPaths: { score?: string; baseline?: string; actual?: string; diff?: string };
};

export interface DashboardContractResult {
  id: string;
  name: string;
  /** Set when aggregating multiple verification artifacts. */
  feature?: string;
  tags: string[];
  status: DashboardVerdict;
  phase: DashboardPhase;
  baselineKind: "figma" | "page";
  baseline?: DashboardImageEvidence & { revision?: string; provenance: string };
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
  maskEvidence?: DashboardMaskEvidence;
  captureEvidence?: DashboardCaptureEvidence;
  evidenceHash?: string;
  startedAt?: string;
  finishedAt?: string;
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
