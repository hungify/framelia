import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveComparisonSummary,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
  visualScoreArtifactSchema,
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
import { FIGMA_BASELINE_ARTIFACT, RUN_ARTIFACT, type ContractDefaults } from "@framelia/verify";

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

interface DashboardScore {
  score: VisualScoreArtifact;
  captureEvidence?: DashboardCaptureEvidence;
}

async function readScore(
  outDir: string,
  expectedUrl: string,
  deviceScaleFactor?: number,
): Promise<DashboardScore | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await fs.readFile(path.join(outDir, RUN_ARTIFACT.score), "utf8"),
    );
    const score = visualScoreArtifactSchema.parse(raw);
    return {
      score,
      captureEvidence: projectCaptureEvidence(
        score.captureEvidence,
        expectedUrl,
        deviceScaleFactor,
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.error(
      `framelia dashboard: failed to read ${RUN_ARTIFACT.score} in ${outDir}: ${String(error)}`,
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

function unmatchedRegionDiagnostic(
  contract: VerificationRequest["contracts"][number],
  result: VerificationArtifact["results"][number],
): DashboardDiagnostic | null {
  if (result.ok) return null;
  if (contract.scope.kind !== "region") return null;
  if (result.error !== "SELECTOR_NOT_FOUND" && result.error !== "SELECTOR_AMBIGUOUS") return null;
  return {
    kind: "unmatched-region",
    code: result.error,
    message: result.message ?? "Region selector did not resolve to exactly one rendered element.",
    blocking: true,
  };
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
  const scoreDiagnostics = score?.diagnostics ? [...score.diagnostics] : [];
  const diagnostics: DashboardDiagnostic[] = [
    ...scoreDiagnostics,
    ...(result.ok ? deriveCaptureEvidenceDiagnostics(captureEvidence, scoreDiagnostics) : []),
    ...(!result.ok
      ? [unmatchedRegionDiagnostic(contract, result)].filter(
          (diagnostic): diagnostic is DashboardDiagnostic => diagnostic !== null,
        )
      : []),
  ];
  const hasMask =
    diagnostics.some((diagnostic) => diagnostic.kind === "masked-pass") ||
    captureEvidence?.maskEvidence?.status === "applied";
  const status: DashboardVerdict = deriveDashboardVerdict({
    resultOk: result.ok,
    pass: result.pass,
    diagnostics,
    maskApplied: hasMask,
  });
  const baselinePath = score?.artifacts?.baseline ?? score?.baseline?.path;
  const actualPath = score?.artifacts?.actual ?? path.join(result.outDir, RUN_ARTIFACT.actual);
  const diffPath = score?.artifacts?.diff ?? null;
  const baselineVirtual = virtualPath(contract.id, FIGMA_BASELINE_ARTIFACT.image);
  const actualVirtual = virtualPath(contract.id, RUN_ARTIFACT.actual);
  const diffVirtual = virtualPath(contract.id, RUN_ARTIFACT.diff);
  const scoreVirtual = virtualPath(contract.id, RUN_ARTIFACT.score);
  const files: (readonly [string, string])[] = [];
  if (score) files.push([scoreVirtual, path.resolve(path.join(result.outDir, RUN_ARTIFACT.score))]);
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
  const dashboardResult = assembleContractResult({
    id: contract.id,
    name: contract.id,
    tags: [contract.viewport.name, contract.scope.kind],
    status,
    baselineKind: contract.baseline.kind,
    ...(score && baselinePath
      ? {
          baseline: {
            path: baselineVirtual,
            hash: hashes?.baseline,
            width: score.baselineSize?.width,
            height: score.baselineSize?.height,
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
    capture: projectCapture({
      viewport: { width: contract.viewport.width, height: contract.viewport.height },
      region:
        contract.scope.kind === "region"
          ? {
              selector: contract.scope.selector,
              matchCount: result.ok ? 1 : 0,
              stable: score?.stability === "stable",
              expectedSize: contract.scope.expectSize,
              actualSize:
                projectedCaptureEvidence?.scope.kind === "region"
                  ? (projectedCaptureEvidence.elementRect ?? undefined)
                  : undefined,
              reason: !result.ok
                ? (result.message ?? result.error ?? "Region selector did not resolve.")
                : undefined,
            }
          : undefined,
    }),
    ...(score ? { comparison: deriveComparisonSummary(score) } : {}),
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
    diagnostics,
    topIssues: score?.topIssues ?? [],
    ...(evidenceHash ? { evidenceHash } : {}),
    finishedAt: createdAt,
  });
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
