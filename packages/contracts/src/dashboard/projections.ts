import type { CaptureEvidenceArtifact } from "../score.ts";
import type {
  ComparisonSummaryInput,
  ContractResultAssemblyInput,
  DashboardCaptureEvidence,
  DashboardContractResult,
  DashboardDiagnostic,
  DashboardVerdict,
  DashboardVerdictInput,
  ProjectCaptureInput,
} from "./types.ts";

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
