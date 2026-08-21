import type * as z from "zod";

import type {
  CaptureEvidenceArtifact,
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  topIssueSchema,
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

/** Same shape score.ts's topIssueSchema validates in visual-score.json's topIssues. */
export type DashboardTopIssue = z.infer<typeof topIssueSchema>;

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
  /** Informational field-level mismatches vs. the Figma baseline's style (color, typography,
   * spacing, corner radius) -- never affects `status`. See compareStyles() in @framelia/verify. */
  topIssues?: DashboardTopIssue[];
  maskEvidence?: DashboardMaskEvidence;
  captureEvidence?: DashboardCaptureEvidence;
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

export function deriveComparisonSummary(
  score: ComparisonSummaryInput,
): NonNullable<DashboardContractResult["comparison"]> {
  return {
    algorithm: "framelia-multi-signal",
    diffPixels: score.diffPixels ?? null,
    diffRatio: score.matchRatio == null ? null : 1 - score.matchRatio,
    matchRatio: score.matchRatio ?? null,
    ssim: score.ssim ?? null,
    avgDeltaE: score.avgDeltaE ?? null,
    sizeMatch:
      score.baselineSize.width === score.actualSize.width &&
      score.baselineSize.height === score.actualSize.height,
  };
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
  /** Set when the contract scoped capture to one element; omitted for page/viewport scope. */
  region?: ProjectCaptureRegion;
}

/**
 * The one place both dashboard paths (playwright reporter's live run, dashboard-server's
 * durable report) turn a contract's scope into DashboardContractResult["capture"], so a
 * region-scoped contract can't render with target details on one path and without them
 * on the other.
 */
export function projectCapture(
  input: ProjectCaptureInput,
): NonNullable<DashboardContractResult["capture"]> {
  if (!input.region) return { kind: "viewport", viewport: input.viewport };
  const { selector, matchCount, stable, expectedSize, actualSize, reason } = input.region;
  return {
    kind: "element",
    viewport: input.viewport,
    target: {
      definition: { kind: "css", value: selector },
      matchCount,
      stable,
      ...(expectedSize ? { expectedSize } : {}),
      ...(actualSize ? { actualSize } : {}),
      ...(reason ? { reason } : {}),
    },
  };
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

function urlsEqual(a: string, b: string): boolean {
  const normalizedA = normalizedUrl(a);
  const normalizedB = normalizedUrl(b);
  if (normalizedA !== null && normalizedB !== null) return normalizedA === normalizedB;
  return a === b;
}

/**
 * Project already-validated capture evidence (see captureEvidenceSchema above) into the
 * dashboard's display shape. Shape checking lives in the schema; this only enriches
 * (redirectMismatch, deviceScaleFactor) and drops fields the dashboard doesn't render
 * (contract identity, raw capture/sample paths, computed style).
 */
export function projectCaptureEvidence(
  value: CaptureEvidenceArtifact | undefined,
  expectedUrl: string,
  deviceScaleFactor?: number,
): DashboardCaptureEvidence | undefined {
  if (!value) return undefined;
  return {
    finalUrl: value.finalUrl,
    expectedUrl,
    redirectMismatch: !urlsEqual(value.finalUrl, expectedUrl),
    viewport: value.viewport
      ? {
          width: value.viewport.width,
          height: value.viewport.height,
          ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
        }
      : null,
    scope:
      value.scope.kind === "page"
        ? { kind: "page", fullPage: value.scope.fullPage ?? false }
        : value.scope,
    elementRect: value.elementRect,
    readiness: value.readiness,
    fonts: value.fonts,
    actions: value.actions,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    capturedAt: value.capturedAt,
    screenshotHashes: value.screenshotHashes,
    warnings: value.warnings,
    maskEvidence: value.maskEvidence ?? null,
    artifactPaths: {},
  };
}

function captureEvidenceMissingDiagnostic(
  captureEvidence: DashboardCaptureEvidence | undefined,
): DashboardDiagnostic | null {
  if (captureEvidence) return null;
  return {
    kind: "warning",
    code: "CAPTURE_EVIDENCE_MISSING",
    message:
      "Capture evidence is missing or malformed; visual result cannot be treated as a clean pass.",
    blocking: true,
  };
}

function redirectMismatchDiagnostic(
  captureEvidence: DashboardCaptureEvidence,
): DashboardDiagnostic | null {
  if (!captureEvidence.redirectMismatch) return null;
  return {
    kind: "warning",
    code: "REDIRECT_MISMATCH",
    message: `Expected ${captureEvidence.expectedUrl}; captured ${captureEvidence.finalUrl}.`,
    blocking: true,
  };
}

function fontFallbackDiagnostic(
  captureEvidence: DashboardCaptureEvidence,
  alreadyReported: boolean,
): DashboardDiagnostic | null {
  if (alreadyReported) return null;
  const fonts = captureEvidence.fonts;
  if (fonts.supported && fonts.status === "loaded" && !fonts.failed.length) return null;
  return {
    kind: "font-fallback",
    code: "FONT_FALLBACK_OR_LOAD_FAILURE",
    message: `Font readiness: ${fonts.status}; failed faces: ${fonts.failed.join(", ") || "none reported"}.`,
    blocking: false,
  };
}

function readinessFailedDiagnostic(
  captureEvidence: DashboardCaptureEvidence,
): DashboardDiagnostic | null {
  if (captureEvidence.readiness?.status !== "failed") return null;
  return {
    kind: "warning",
    code: "READINESS_FAILED",
    message: "Target readiness did not pass before capture.",
    blocking: true,
  };
}

function navigationActionDiagnostics(
  captureEvidence: DashboardCaptureEvidence,
): DashboardDiagnostic[] {
  return captureEvidence.actions
    .filter((action) => action.status === "failed")
    .map((action) => ({
      kind: "warning",
      code: "NAVIGATION_ACTION_FAILED",
      message: `Action ${action.index + 1} (${action.kind}) failed after ${action.attempts} attempt(s): ${action.error ?? "unknown error"}.`,
      blocking: true,
    }));
}

function maskEvidenceDiagnostic(
  captureEvidence: DashboardCaptureEvidence,
): DashboardDiagnostic | null {
  const mask = captureEvidence.maskEvidence;
  if (!mask || mask.status === "applied") return null;
  return {
    kind: "warning",
    code: mask.code ?? "MASK_EVIDENCE_INCOMPLETE",
    message: mask.message ?? `Mask evidence ${mask.status}.`,
    blocking: mask.status === "failed",
  };
}

/**
 * The one place both the live (playwright reporter) and durable (dashboard-server report
 * export) dashboard paths compute caveats from capture evidence. Only meaningful for a clean
 * capture -- a structurally failed result already carries its own blocker.
 */
export function deriveCaptureEvidenceDiagnostics(
  captureEvidence: DashboardCaptureEvidence | undefined,
  scoreDiagnostics: readonly DashboardDiagnostic[],
): DashboardDiagnostic[] {
  const missing = captureEvidenceMissingDiagnostic(captureEvidence);
  if (missing) return [missing];
  if (!captureEvidence) return [];
  const fontAlreadyReported = scoreDiagnostics.some(
    (diagnostic) => diagnostic.code === "FONT_FALLBACK_OR_LOAD_FAILURE",
  );
  return [
    redirectMismatchDiagnostic(captureEvidence),
    fontFallbackDiagnostic(captureEvidence, fontAlreadyReported),
    readinessFailedDiagnostic(captureEvidence),
    ...navigationActionDiagnostics(captureEvidence),
    maskEvidenceDiagnostic(captureEvidence),
  ].filter((diagnostic): diagnostic is DashboardDiagnostic => diagnostic !== null);
}

export interface DashboardVerdictInput {
  /** False for a structural failure (selector didn't resolve, etc.) -- distinct from a clean visual mismatch. */
  resultOk: boolean;
  /** The visual comparison's own pass/fail, independent of resultOk. */
  pass: boolean;
  diagnostics: readonly DashboardDiagnostic[];
  maskApplied: boolean;
}

/**
 * The one place both dashboard paths turn a result + diagnostics into a verdict, so the
 * same run can't read "passed" through one channel and "blocked" through the other.
 */
export function deriveDashboardVerdict(input: DashboardVerdictInput): DashboardVerdict {
  if (!input.resultOk || input.diagnostics.some((diagnostic) => diagnostic.blocking))
    return "blocked";
  if (!input.pass) return "failed";
  return input.maskApplied ? "masked-pass" : "passed";
}

/** Everything needed to assemble one DashboardContractResult, already derived by the caller. */
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
  blockers: Array<{ code: string; message: string }>;
  diagnostics: DashboardDiagnostic[];
  topIssues: DashboardTopIssue[];
  evidenceHash?: string;
  finishedAt: string;
}

/**
 * The one place both dashboard paths (playwright reporter's live run, dashboard-server's
 * durable report) turn already-derived fields into a DashboardContractResult. Field
 * derivation (status, capture, comparison, diagnostics, ...) stays with the caller and
 * already goes through the shared helpers above -- this only owns the object's shape, so
 * a field added to DashboardContractResult has one conditional-spread to update, not two.
 */
export function assembleContractResult(
  input: ContractResultAssemblyInput,
): DashboardContractResult {
  return {
    id: input.id,
    name: input.name,
    tags: input.tags,
    status: input.status,
    phase: "complete",
    baselineKind: input.baselineKind,
    ...(input.baseline ? { baseline: input.baseline } : {}),
    ...(input.actual ? { actual: input.actual } : {}),
    ...(input.diff ? { diff: input.diff } : {}),
    capture: input.capture,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    ...(input.maskEvidence ? { maskEvidence: input.maskEvidence } : {}),
    ...(input.captureEvidence ? { captureEvidence: input.captureEvidence } : {}),
    blockers: input.blockers,
    ...(input.diagnostics.length ? { diagnostics: input.diagnostics } : {}),
    ...(input.topIssues.length ? { topIssues: input.topIssues } : {}),
    ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
    finishedAt: input.finishedAt,
  };
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
