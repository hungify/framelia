import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  visualScoreArtifactSchema,
  type CaptureEvidenceArtifact,
  type VisualScoreArtifact,
  type VerificationArtifact,
  type VerificationRequest,
  type DashboardContractResult,
  type DashboardCaptureEvidence,
  type DashboardDiagnostic,
  type DashboardRun,
  type DashboardSummary,
  type DashboardVerdict,
} from "@framelia/contracts";
import { type ContractDefaults } from "@framelia/verify";

type DashboardFileMap = Map<string, string>;

export interface DashboardProjection {
  run: DashboardRun;
  files: DashboardFileMap;
}

function runIdFor(artifact: VerificationArtifact): string {
  return crypto
    .createHash("sha256")
    .update(`${artifact.createdAt}\0${artifact.projectRoot}`)
    .digest("hex")
    .slice(0, 16);
}

export function summarize(contracts: DashboardContractResult[]): DashboardSummary {
  const summary: DashboardSummary = {
    total: contracts.length,
    queued: 0,
    running: 0,
    passed: 0,
    "masked-pass": 0,
    failed: 0,
    blocked: 0,
  };
  for (const contract of contracts) summary[contract.status] += 1;
  return summary;
}

export function overallStatus(summary: DashboardSummary): DashboardVerdict {
  if (summary.running) return "running";
  if (summary.queued) return "queued";
  if (summary.blocked) return "blocked";
  if (summary.failed) return "failed";
  if (summary["masked-pass"]) return "masked-pass";
  return "passed";
}

function virtualPath(id: string, name: string): string {
  return `contracts/${encodeURIComponent(id)}/${name}`;
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

interface DashboardScore {
  score: VisualScoreArtifact;
  captureEvidence?: DashboardCaptureEvidence;
}

function maskEvidenceFrom(
  value: CaptureEvidenceArtifact["maskEvidence"],
): DashboardCaptureEvidence["maskEvidence"] {
  return value ?? null;
}

/**
 * Project already-validated capture evidence (see captureEvidenceSchema in
 * @framelia/contracts) into the dashboard's display shape. Shape checking
 * lives in the schema; this only enriches (redirectMismatch, deviceScaleFactor)
 * and drops fields the dashboard doesn't render (contract identity, raw
 * capture/sample paths, computed style).
 */
function captureEvidenceFrom(
  value: CaptureEvidenceArtifact | undefined,
  expectedUrl: string,
  deviceScaleFactor: number | undefined,
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
    maskEvidence: maskEvidenceFrom(value.maskEvidence),
    artifactPaths: {},
  };
}

async function readScore(
  outDir: string,
  expectedUrl: string,
  deviceScaleFactor?: number,
): Promise<DashboardScore | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await fs.readFile(path.join(outDir, "visual-score.json"), "utf8"),
    );
    const score = visualScoreArtifactSchema.parse(raw);
    return {
      score,
      captureEvidence: captureEvidenceFrom(score.captureEvidence, expectedUrl, deviceScaleFactor),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.error(
      `framelia dashboard: failed to read visual-score.json in ${outDir}: ${String(error)}`,
    );
    return undefined;
  }
}

function targetExpectedUrl(target: VerificationRequest["target"]): string {
  return target.url;
}

function provenance(
  score: VisualScoreArtifact,
  contract: VerificationRequest["contracts"][number],
): string {
  if (score.baseline?.kind === "figma") {
    const fileKey = score.baseline.fileKey ?? contract.baseline.fileKey;
    const nodeId = score.baseline.nodeId ?? contract.baseline.nodeId;
    return `figma://${fileKey}/${nodeId}`;
  }
  return score.baseline?.url ?? "Figma baseline";
}

interface ContractResultInput {
  contract: VerificationRequest["contracts"][number];
  result: VerificationArtifact["results"][number];
  score: VisualScoreArtifact | undefined;
  captureEvidence: DashboardCaptureEvidence | undefined;
  rawTargetUrl: string;
  createdAt: string;
}

interface ContractResultProjection {
  result: DashboardContractResult;
  files: readonly (readonly [string, string])[];
}

/**
 * Pure projection: diagnostics, status, and evidence shaping for one contract.
 * No I/O — score/captureEvidence must already be resolved by the caller, so this
 * can be exercised directly with in-memory fixtures instead of files on disk.
 */
function deriveContractResult(input: ContractResultInput): ContractResultProjection {
  const { contract, result, score, captureEvidence, rawTargetUrl, createdAt } = input;
  const diagnostics: DashboardDiagnostic[] = score?.diagnostics ? [...score.diagnostics] : [];
  if (result.ok) {
    if (!captureEvidence)
      diagnostics.push({
        kind: "warning",
        code: "CAPTURE_EVIDENCE_MISSING",
        message:
          "Capture evidence is missing or malformed; visual result cannot be treated as a clean pass.",
        blocking: true,
      });
    else {
      if (captureEvidence.redirectMismatch)
        diagnostics.push({
          kind: "warning",
          code: "REDIRECT_MISMATCH",
          message: `Expected ${captureEvidence.expectedUrl}; captured ${captureEvidence.finalUrl}.`,
          blocking: true,
        });
      const fontDiagnosticPresent = diagnostics.some(
        (diagnostic) => diagnostic.code === "FONT_FALLBACK_OR_LOAD_FAILURE",
      );
      if (
        !fontDiagnosticPresent &&
        (!captureEvidence.fonts.supported ||
          captureEvidence.fonts.status !== "loaded" ||
          captureEvidence.fonts.failed.length)
      )
        diagnostics.push({
          kind: "font-fallback",
          code: "FONT_FALLBACK_OR_LOAD_FAILURE",
          message: `Font readiness: ${captureEvidence.fonts.status}; failed faces: ${captureEvidence.fonts.failed.join(", ") || "none reported"}.`,
          blocking: false,
        });
      if (captureEvidence.readiness?.status === "failed")
        diagnostics.push({
          kind: "warning",
          code: "READINESS_FAILED",
          message: "Target readiness did not pass before capture.",
          blocking: true,
        });
      for (const action of captureEvidence.actions.filter(
        (failedAction) => failedAction.status === "failed",
      ))
        diagnostics.push({
          kind: "warning",
          code: "NAVIGATION_ACTION_FAILED",
          message: `Action ${action.index + 1} (${action.kind}) failed after ${action.attempts} attempt(s): ${action.error ?? "unknown error"}.`,
          blocking: true,
        });
      if (captureEvidence.maskEvidence && captureEvidence.maskEvidence.status !== "applied")
        diagnostics.push({
          kind: "warning",
          code: captureEvidence.maskEvidence.code ?? "MASK_EVIDENCE_INCOMPLETE",
          message:
            captureEvidence.maskEvidence.message ??
            `Mask evidence ${captureEvidence.maskEvidence.status}.`,
          blocking: captureEvidence.maskEvidence.status === "failed",
        });
    }
  }
  if (
    !result.ok &&
    contract.scope.kind === "region" &&
    (result.error === "SELECTOR_NOT_FOUND" || result.error === "SELECTOR_AMBIGUOUS")
  ) {
    diagnostics.push({
      kind: "unmatched-region",
      code: result.error,
      message: result.message ?? "Region selector did not resolve to exactly one rendered element.",
      blocking: true,
    });
  }
  const hasMask =
    diagnostics.some((diagnostic) => diagnostic.kind === "masked-pass") ||
    captureEvidence?.maskEvidence?.status === "applied";
  const status: DashboardVerdict =
    !result.ok || diagnostics.some((diagnostic) => diagnostic.blocking)
      ? "blocked"
      : result.pass
        ? hasMask
          ? "masked-pass"
          : "passed"
        : "failed";
  const baselinePath = score?.artifacts?.baseline ?? score?.baseline?.path;
  const actualPath = score?.artifacts?.actual ?? path.join(result.outDir, "actual.png");
  const diffPath = score?.artifacts?.diff ?? null;
  const baselineVirtual = virtualPath(contract.id, "baseline.png");
  const actualVirtual = virtualPath(contract.id, "actual.png");
  const diffVirtual = virtualPath(contract.id, "diff.png");
  const scoreVirtual = virtualPath(contract.id, "visual-score.json");
  const files: (readonly [string, string])[] = [];
  if (score)
    files.push([scoreVirtual, path.resolve(path.join(result.outDir, "visual-score.json"))]);
  if (baselinePath) files.push([baselineVirtual, path.resolve(baselinePath)]);
  if (score) files.push([actualVirtual, path.resolve(actualPath)]);
  if (diffPath) files.push([diffVirtual, path.resolve(diffPath)]);
  const artifactPaths = {
    ...(score ? { score: scoreVirtual } : {}),
    ...(baselinePath ? { baseline: baselineVirtual } : {}),
    ...(score ? { actual: actualVirtual } : {}),
    ...(diffPath ? { diff: diffVirtual } : {}),
  };
  const projectedCaptureEvidence = captureEvidence
    ? { ...captureEvidence, artifactPaths }
    : undefined;
  const maskEvidence = projectedCaptureEvidence?.maskEvidence;
  const hashes = score?.evidenceHashes;
  const evidenceHash = hashes
    ? `sha256:${crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex")}`
    : undefined;
  const dashboardResult: DashboardContractResult = {
    id: contract.id,
    name: contract.id,
    tags: [contract.viewport.name, contract.scope.kind],
    status,
    phase: "complete",
    baselineKind: contract.baseline.kind,
    ...(score && baselinePath
      ? {
          baseline: {
            path: baselineVirtual,
            hash: hashes?.baseline,
            width: score.goldSize?.width,
            height: score.goldSize?.height,
            revision: score.baseline?.fetchedAt,
            provenance: provenance(score, contract),
          },
          actual: {
            path: actualVirtual,
            hash: hashes?.actual,
            width: score.actualSize?.width,
            height: score.actualSize?.height,
            url: rawTargetUrl,
          },
        }
      : {}),
    ...(diffPath ? { diff: { path: diffVirtual, hash: hashes?.diff ?? undefined } } : {}),
    capture: {
      kind: contract.scope.kind === "page" ? "viewport" : "element",
      viewport: { width: contract.viewport.width, height: contract.viewport.height },
      ...(contract.scope.kind === "region"
        ? {
            target: {
              definition: { kind: "css" as const, value: contract.scope.selector },
              matchCount: result.ok ? 1 : 0,
              stable: score?.stability === "stable",
              ...(contract.scope.expectSize ? { expectedSize: contract.scope.expectSize } : {}),
              ...(projectedCaptureEvidence?.scope.kind === "region" &&
              projectedCaptureEvidence.elementRect
                ? { actualSize: projectedCaptureEvidence.elementRect }
                : {}),
              ...(!result.ok
                ? { reason: result.message ?? result.error ?? "Region selector did not resolve." }
                : {}),
            },
          }
        : {}),
    },
    ...(score
      ? {
          comparison: {
            algorithm: "framelia-multi-signal",
            diffPixels: score.diffPixels ?? null,
            diffRatio: score.matchRatio == null ? null : 1 - score.matchRatio,
            matchRatio: score.matchRatio ?? null,
            ssim: score.ssim ?? null,
            avgDeltaE: score.avgDeltaE ?? null,
            sizeMatch:
              score.goldSize?.width === score.actualSize?.width &&
              score.goldSize?.height === score.actualSize?.height,
          },
        }
      : {}),
    ...(maskEvidence ? { maskEvidence } : {}),
    ...(projectedCaptureEvidence ? { captureEvidence: projectedCaptureEvidence } : {}),
    blockers: result.ok
      ? []
      : [
          {
            code: result.error ?? "VERIFY_FAILED",
            message: result.message ?? "Verification blocked.",
          },
        ],
    ...(diagnostics.length ? { diagnostics } : {}),
    ...(evidenceHash ? { evidenceHash } : {}),
    finishedAt: createdAt,
  };
  return { result: dashboardResult, files };
}

export async function projectArtifact(
  artifact: VerificationArtifact,
  suiteName?: string,
  defaults: ContractDefaults = {},
): Promise<DashboardProjection> {
  const resultById = new Map(artifact.results.map((result) => [result.id, result]));
  const rawTargetUrl = artifact.request.target.url;
  const expectedUrl = targetExpectedUrl(artifact.request.target);
  const projections = await Promise.all(
    artifact.request.contracts.map(async (contract) => {
      const result = resultById.get(contract.id);
      if (!result)
        throw new Error(`Verification artifact has no result for contract "${contract.id}".`);
      const dashboardScore = await readScore(
        result.outDir,
        expectedUrl,
        defaults.deviceScaleFactor,
      );
      return deriveContractResult({
        contract,
        result,
        score: dashboardScore?.score,
        captureEvidence: dashboardScore?.captureEvidence,
        rawTargetUrl,
        createdAt: artifact.createdAt,
      });
    }),
  );
  const files: DashboardFileMap = new Map();
  const contracts = projections.map((projection) => {
    for (const [key, value] of projection.files) files.set(key, value);
    return projection.result;
  });
  const summary = summarize(contracts);
  return {
    files,
    run: {
      schemaVersion: 1,
      runId: runIdFor(artifact),
      ...(suiteName ? { suiteName } : {}),
      status: overallStatus(summary),
      summary,
      contracts,
      startedAt: artifact.createdAt,
      updatedAt: artifact.createdAt,
      finishedAt: artifact.createdAt,
    },
  };
}
