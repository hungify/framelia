import type * as z from "zod";

import type { ProfileName } from "./contract.ts";
import type {
  CaptureEvidenceArtifact,
  captureEvidenceSchema,
  captureMaskEvidenceSchema,
  topIssueSchema,
  visualDiagnosticSchema,
} from "./score.ts";

export type UIVerdict = "queued" | "running" | "passed" | "masked-pass" | "failed" | "blocked";
export type VerificationPhase = "baseline" | "capture" | "compare" | "gates" | "complete";
export type UIPhase = "queued" | VerificationPhase;

export interface UIImageEvidence {
  path: string;
  hash?: string;
  width?: number;
  height?: number;
}

/**
 * The concrete threshold values a comparison actually ran against -- structurally identical
 * to @framelia/verify's Profile, duplicated here (not imported) because this package sits
 * below @framelia/verify in the dependency graph (contracts has no workspace deps of its
 * own). Callers on the verify/playwright/ui-server side pass a Profile value straight
 * through; it satisfies this type structurally.
 */
export interface UIResolvedThreshold {
  name: ProfileName;
  minMatch: number;
  maxDiffPixels: number | null;
  minSSIM: number;
  maxAvgDeltaE: number;
  maxAreaGapPercent: number;
  cluster: boolean;
  stabilityMaxDiffRatio: number;
}

/** Same shape score.ts's visualDiagnosticSchema validates in visual-score.json's diagnostics. */
export type UIDiagnostic = z.infer<typeof visualDiagnosticSchema>;

/** Same shape score.ts's topIssueSchema validates in visual-score.json's topIssues. */
export type UITopIssue = z.infer<typeof topIssueSchema>;

/** Same shape capture writes into visual-score.json's maskEvidence field. */
export type UIMaskEvidence = z.infer<typeof captureMaskEvidenceSchema>;

/**
 * Same shape capture writes into visual-score.json's captureEvidence field, plus fields the
 * UI projection layer computes on top of it (expectedUrl/redirectMismatch/artifactPaths
 * aren't part of the raw capture evidence — they're derived when building the projection).
 */
export type UICaptureEvidence = z.infer<typeof captureEvidenceSchema> & {
  expectedUrl?: string;
  redirectMismatch: boolean;
  artifactPaths: { score?: string; baseline?: string; actual?: string; diff?: string };
};

export interface UIContractResult {
  id: string;
  name: string;
  /** Set when aggregating multiple verification artifacts. */
  feature?: string;
  tags: string[];
  status: UIVerdict;
  phase: UIPhase;
  baselineKind: "figma" | "page";
  baseline?: UIImageEvidence & {
    revision?: string;
    provenance: string;
    /** Set only for a toMatchPageBaseline result -- who/when/from-what-run accepted
     *  this baseline via `framelia baseline promote` (see #41). */
    promotedAt?: string;
    promotedBy?: string;
    runId?: string;
  };
  actual?: UIImageEvidence & { url: string };
  diff?: UIImageEvidence;
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
  diagnostics?: UIDiagnostic[];
  /** Field-level mismatches vs. the Figma baseline's style (color, typography, spacing,
   * corner radius) -- never affects `status` (the live UI verdict). May still block
   * the separate CI done-gate when `styleGateEligible` is true. See compareStyles() in
   * @framelia/verify. */
  topIssues?: UITopIssue[];
  /** This contract's resolved style-gate eligibility (explicit override or profile default,
   * see @framelia/verify's resolveStyleGateEligible) -- lets the UI show whether style
   * mismatches above are informational-only or enforced at the CI merge gate. */
  styleGateEligible?: boolean;
  maskEvidence?: UIMaskEvidence;
  captureEvidence?: UICaptureEvidence;
  /** Set whenever the comparison resolved a profile (i.e. a score attachment/artifact exists). */
  resolvedThreshold?: UIResolvedThreshold;
  evidenceHash?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** Common subset of VisualScoreArtifact (ui-server) and FrameliaScoreAttachment
 * (playwright reporter) that UIContractResult["comparison"] is derived from --
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
): NonNullable<UIContractResult["comparison"]> {
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
 * The one place both UI paths (playwright reporter's live run, ui-server's
 * durable report) turn a contract's scope into UIContractResult["capture"], so a
 * region-scoped contract can't render with target details on one path and without them
 * on the other.
 */
export function projectCapture(
  input: ProjectCaptureInput,
): NonNullable<UIContractResult["capture"]> {
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
 * UI's display shape. Shape checking lives in the schema; this only enriches
 * (redirectMismatch, deviceScaleFactor) and drops fields the UI doesn't render
 * (contract identity, raw capture/sample paths, computed style).
 */
export function projectCaptureEvidence(
  value: CaptureEvidenceArtifact | undefined,
  expectedUrl: string,
  deviceScaleFactor?: number,
): UICaptureEvidence | undefined {
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
  captureEvidence: UICaptureEvidence | undefined,
): UIDiagnostic | null {
  if (captureEvidence) return null;
  return {
    kind: "warning",
    code: "CAPTURE_EVIDENCE_MISSING",
    message:
      "Capture evidence is missing or malformed; visual result cannot be treated as a clean pass.",
    blocking: true,
  };
}

function redirectMismatchDiagnostic(captureEvidence: UICaptureEvidence): UIDiagnostic | null {
  if (!captureEvidence.redirectMismatch) return null;
  return {
    kind: "warning",
    code: "REDIRECT_MISMATCH",
    message: `Expected ${captureEvidence.expectedUrl}; captured ${captureEvidence.finalUrl}.`,
    blocking: true,
  };
}

function fontFallbackDiagnostic(
  captureEvidence: UICaptureEvidence,
  alreadyReported: boolean,
): UIDiagnostic | null {
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

function readinessFailedDiagnostic(captureEvidence: UICaptureEvidence): UIDiagnostic | null {
  if (captureEvidence.readiness?.status !== "failed") return null;
  return {
    kind: "warning",
    code: "READINESS_FAILED",
    message: "Target readiness did not pass before capture.",
    blocking: true,
  };
}

function navigationActionDiagnostics(captureEvidence: UICaptureEvidence): UIDiagnostic[] {
  return captureEvidence.actions
    .filter((action) => action.status === "failed")
    .map((action) => ({
      kind: "warning",
      code: "NAVIGATION_ACTION_FAILED",
      message: `Action ${action.index + 1} (${action.kind}) failed after ${action.attempts} attempt(s): ${action.error ?? "unknown error"}.`,
      blocking: true,
    }));
}

function maskEvidenceDiagnostic(captureEvidence: UICaptureEvidence): UIDiagnostic | null {
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
 * The one place both the live (playwright reporter) and durable (ui-server report
 * export) UI paths compute caveats from capture evidence. Only meaningful for a clean
 * capture -- a structurally failed result already carries its own blocker.
 */
export function deriveCaptureEvidenceDiagnostics(
  captureEvidence: UICaptureEvidence | undefined,
  scoreDiagnostics: readonly UIDiagnostic[],
): UIDiagnostic[] {
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
  ].filter((diagnostic): diagnostic is UIDiagnostic => diagnostic !== null);
}

export interface UIVerdictInput {
  /** False for a structural failure (selector didn't resolve, etc.) -- distinct from a clean visual mismatch. */
  resultOk: boolean;
  /** The visual comparison's own pass/fail, independent of resultOk. */
  pass: boolean;
  diagnostics: readonly UIDiagnostic[];
  maskApplied: boolean;
}

/**
 * The one place both UI paths turn a result + diagnostics into a verdict, so the
 * same run can't read "passed" through one channel and "blocked" through the other.
 */
export function deriveUIVerdict(input: UIVerdictInput): UIVerdict {
  if (!input.resultOk || input.diagnostics.some((diagnostic) => diagnostic.blocking))
    return "blocked";
  if (!input.pass) return "failed";
  return input.maskApplied ? "masked-pass" : "passed";
}

/** Everything needed to assemble one UIContractResult, already derived by the caller. */
export interface ContractResultAssemblyInput {
  id: string;
  name: string;
  tags: string[];
  status: UIVerdict;
  baselineKind: "figma" | "page";
  baseline?: UIContractResult["baseline"];
  actual?: UIContractResult["actual"];
  diff?: UIContractResult["diff"];
  capture: UIContractResult["capture"];
  comparison?: UIContractResult["comparison"];
  maskEvidence?: UIMaskEvidence;
  captureEvidence?: UICaptureEvidence;
  resolvedThreshold?: UIResolvedThreshold;
  blockers: Array<{ code: string; message: string }>;
  diagnostics: UIDiagnostic[];
  topIssues: UITopIssue[];
  styleGateEligible?: boolean;
  evidenceHash?: string;
  finishedAt: string;
}

/**
 * The one place both UI paths (playwright reporter's live run, ui-server's
 * durable report) turn already-derived fields into a UIContractResult. Field
 * derivation (status, capture, comparison, diagnostics, ...) stays with the caller and
 * already goes through the shared helpers above -- this only owns the object's shape, so
 * a field added to UIContractResult has one conditional-spread to update, not two.
 */
export function assembleContractResult(input: ContractResultAssemblyInput): UIContractResult {
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
    ...(input.resolvedThreshold ? { resolvedThreshold: input.resolvedThreshold } : {}),
    blockers: input.blockers,
    ...(input.diagnostics.length ? { diagnostics: input.diagnostics } : {}),
    ...(input.topIssues.length ? { topIssues: input.topIssues } : {}),
    ...(input.styleGateEligible !== undefined
      ? { styleGateEligible: input.styleGateEligible }
      : {}),
    ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
    finishedAt: input.finishedAt,
  };
}

export type UISummary = Record<Exclude<UIVerdict, "masked-pass">, number> & {
  "masked-pass"?: number;
  total: number;
};

export interface UIRun {
  /** Versions this UI-projection format independently of SCHEMA_VERSION (the verification contract/artifact version). */
  schemaVersion: 1;
  runId: string;
  suiteName?: string;
  status: UIVerdict;
  summary: UISummary;
  contracts: UIContractResult[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface UIEvent {
  sequence: number;
  runId: string;
  contractId?: string;
  phase?: UIPhase;
  status: UIVerdict;
  timestamp: string;
}
