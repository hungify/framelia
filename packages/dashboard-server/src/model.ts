import * as crypto from "node:crypto";
import * as path from "node:path";

import {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
  type DashboardContractResult,
  type DashboardDiagnostic,
  type DashboardRun,
  type DashboardSummary,
  type DashboardVerdict,
} from "@framelia/contracts";
import { sanitizePortableValue } from "@framelia/verify";
import type { SelectedAttempt, SelectedCase, SelectedRun } from "@framelia/verify/run-bundle";

export interface SelectedRunDashboardProjection {
  run: DashboardRun;
  /** Portable evidence key to current-machine absolute path; never serialized. */
  files: Map<string, string>;
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

function evidenceFiles(root: string, selected: SelectedAttempt | undefined): Map<string, string> {
  const files = new Map<string, string>();
  if (!selected) return files;
  for (const evidence of Object.values(selected.evidence)) {
    if (evidence.availability === "available" && evidence.portablePath) {
      files.set(evidence.portablePath, path.resolve(root, evidence.portablePath));
    }
  }
  return files;
}

function projectedStatus(
  selectedCase: SelectedCase,
  diagnostics: DashboardDiagnostic[],
  runStatus: SelectedRun["record"]["status"],
): DashboardVerdict {
  if (runStatus === "error" || runStatus === "incomplete") return "blocked";
  const attempt = selectedCase.selectedAttempt;
  if (!attempt) return runStatus === "running" ? "queued" : "blocked";
  if (attempt.record.executionState !== "completed") {
    return attempt.record.executionState === "incomplete" && runStatus === "running"
      ? "running"
      : "blocked";
  }
  if (!attempt.score || attempt.integrityIssues.length > 0) return "blocked";
  return deriveDashboardVerdict({
    resultOk: true,
    pass: attempt.score.pass,
    diagnostics,
    maskApplied: attempt.score.maskEvidence?.status === "applied",
  });
}

function image(
  selected: SelectedAttempt | undefined,
  kind: "expected" | "actual" | "diff",
): { path: string; hash?: string } | undefined {
  const evidence = selected?.evidence[kind];
  if (evidence?.availability !== "available" || !evidence.portablePath) return undefined;
  return { path: evidence.portablePath, ...(evidence.digest ? { hash: evidence.digest } : {}) };
}

function projectCase(
  root: string,
  selectedCase: SelectedCase,
  runStatus: SelectedRun["record"]["status"],
): DashboardContractResult {
  const contract = selectedCase.plan.contract.authored;
  const selected = selectedCase.selectedAttempt;
  const score = selected?.score;
  const baselineImage = image(selected, "expected");
  const actualImage = image(selected, "actual");
  const diffImage = image(selected, "diff");
  const projectedCaptureEvidence = score?.captureEvidence
    ? projectCaptureEvidence(score.captureEvidence, score.targetUrl)
    : undefined;
  const scoreDiagnostics: DashboardDiagnostic[] = score?.diagnostics ? [...score.diagnostics] : [];
  const diagnostics = [
    ...scoreDiagnostics,
    ...(selected?.record.executionState === "completed"
      ? deriveCaptureEvidenceDiagnostics(projectedCaptureEvidence, scoreDiagnostics)
      : []),
  ];
  const blockers = [
    ...(selected?.integrityIssues ?? []).map((issue) => ({
      code: issue.code,
      message: issue.message,
    })),
    ...(!selected
      ? [{ code: "ATTEMPT_MISSING", message: "This selected case has no published attempt." }]
      : selected.record.executionState !== "completed"
        ? selected.record.diagnostics.map((issue) => ({ code: issue.code, message: issue.message }))
        : []),
    ...selectedCase.invalidAttempts.flatMap((attempt) =>
      attempt.issues.map((issue) => ({
        code: issue.code,
        message: `${attempt.attemptId}: ${issue.message}`,
      })),
    ),
  ];
  const status = projectedStatus(selectedCase, diagnostics, runStatus);
  const baselineKind = score?.baseline.kind === "web" ? "page" : "figma";
  const projected = assembleContractResult({
    id: selectedCase.caseId,
    name: contract.name,
    tags: [contract.viewport.preset, contract.scope.kind, selectedCase.plan.project.name],
    status,
    baselineKind,
    ...(baselineImage
      ? {
          baseline: {
            ...baselineImage,
            width: score?.baselineSize.width,
            height: score?.baselineSize.height,
            provenance:
              score?.baseline.kind === "figma" && score.baseline.fileKey && score.baseline.nodeId
                ? `figma://${score.baseline.fileKey}/${score.baseline.nodeId}`
                : score?.baseline.sourceRunId
                  ? `run://${score.baseline.sourceRunId}`
                  : `snapshot://${selectedCase.plan.snapshotDigest}`,
            ...(score?.baseline.fetchedAt ? { revision: score.baseline.fetchedAt } : {}),
            ...(score?.baseline.promotedAt ? { promotedAt: score.baseline.promotedAt } : {}),
            ...(score?.baseline.promotedBy ? { promotedBy: score.baseline.promotedBy } : {}),
            ...(score?.baseline.sourceRunId ? { runId: score.baseline.sourceRunId } : {}),
          },
        }
      : {}),
    ...(actualImage && score
      ? {
          actual: {
            ...actualImage,
            width: score.actualSize.width,
            height: score.actualSize.height,
            url: score.targetUrl,
          },
        }
      : {}),
    ...(diffImage ? { diff: diffImage } : {}),
    capture: projectCapture({
      viewport: { width: contract.viewport.width, height: contract.viewport.height },
      region:
        contract.scope.kind === "region"
          ? {
              selector: contract.scope.selector,
              matchCount: selected?.record.executionState === "completed" ? 1 : 0,
              stable: score?.stability === "stable",
              expectedSize: contract.scope.expectSize,
              actualSize:
                projectedCaptureEvidence?.scope.kind === "region"
                  ? (projectedCaptureEvidence.elementRect ?? undefined)
                  : undefined,
            }
          : undefined,
    }),
    ...(score ? { score } : {}),
    ...(score?.maskEvidence ? { maskEvidence: score.maskEvidence } : {}),
    ...(projectedCaptureEvidence ? { captureEvidence: projectedCaptureEvidence } : {}),
    blockers,
    diagnostics,
    topIssues: score?.topIssues ?? [],
    ...(selected
      ? {
          evidenceHash: `sha256:${crypto
            .createHash("sha256")
            .update(
              JSON.stringify(
                Object.values(selected.evidence)
                  .map((entry) => entry.digest)
                  .filter(Boolean)
                  .toSorted(),
              ),
            )
            .digest("hex")}`,
        }
      : {}),
    finishedAt:
      selected?.record.completedAt ?? selected?.record.startedAt ?? new Date(0).toISOString(),
  });

  return sanitizePortableValue(
    {
      ...projected,
      sourceRunId: selectedCase.runId,
      caseId: selectedCase.caseId,
      contractId: contract.id,
      projectName: selectedCase.plan.project.name,
      repeatIndex: selectedCase.plan.repeatIndex,
      targetPath: contract.target.path,
      executionState: selected?.record.executionState ?? "incomplete",
      visualVerdict: selected?.record.visualVerdict ?? "not-evaluated",
      provenance: {
        policyDigest: selectedCase.plan.policyDigest,
        retryAcceptance: selectedCase.plan.retryAcceptance,
        ...(selectedCase.plan.source.sourceDigest
          ? { sourceDigest: selectedCase.plan.source.sourceDigest }
          : {}),
        ...(selectedCase.plan.source.buildDigest
          ? { buildDigest: selectedCase.plan.source.buildDigest }
          : {}),
        ...(selectedCase.plan.source.dirty !== undefined
          ? { dirty: selectedCase.plan.source.dirty }
          : {}),
        bindingDigest: selectedCase.plan.bindingDigest,
        specFile: selectedCase.plan.registration.specFile,
        specFileDigest: selectedCase.plan.registration.specDigest,
        titlePath: selectedCase.plan.registration.titlePath,
      },
      ...(selectedCase.selectedAttemptId
        ? { selectedAttemptId: selectedCase.selectedAttemptId }
        : selected
          ? { selectedAttemptId: selected.record.attemptId }
          : {}),
      attempts: selectedCase.attempts.map((attempt) => ({
        runId: selectedCase.runId,
        attemptId: attempt.record.attemptId,
        casePlanDigest: attempt.record.casePlanDigest,
        retryIndex: attempt.record.retryIndex,
        selected: attempt.record.attemptId === selected?.record.attemptId,
        executionState: attempt.record.executionState,
        visualVerdict: attempt.record.visualVerdict,
        baseline: attempt.score
          ? {
              snapshotDigest: attempt.score.baseline.snapshotDigest,
              kind: attempt.score.baseline.kind,
              ...(attempt.score.baseline.fileKey
                ? { fileKey: attempt.score.baseline.fileKey }
                : {}),
              ...(attempt.score.baseline.nodeId ? { nodeId: attempt.score.baseline.nodeId } : {}),
              ...(attempt.score.baseline.sourceRunId
                ? { sourceRunId: attempt.score.baseline.sourceRunId }
                : {}),
            }
          : undefined,
        scoreProvenance: attempt.evidence.score.digest
          ? {
              formatVersion: attempt.score?.formatVersion,
              digest: attempt.evidence.score.digest,
            }
          : undefined,
        evidence: Object.fromEntries(
          Object.entries(attempt.evidence).map(([kind, evidence]) => [
            kind,
            {
              availability: evidence.availability,
              ...(evidence.portablePath ? { path: evidence.portablePath } : {}),
              ...(evidence.digest ? { digest: evidence.digest } : {}),
              ...(evidence.message ? { message: evidence.message } : {}),
            },
          ]),
        ) as NonNullable<DashboardContractResult["attempts"]>[number]["evidence"],
        ...(attempt.score
          ? {
              comparison: {
                matchRatio: attempt.score.matchRatio,
                ssim: attempt.score.ssim,
                avgDeltaE: attempt.score.avgDeltaE,
                diffPixels: attempt.score.diffPixels,
              },
            }
          : {}),
        topIssues: attempt.score?.topIssues ?? [],
        diagnostics: attempt.score?.diagnostics ?? [],
        warnings: attempt.score?.warnings ?? [],
      })),
    },
    root,
  );
}

/** Projects exactly one already-validated selected run into the shared live/static wire model. */
export function projectSelectedRun(
  root: string,
  selectedRun: SelectedRun,
  suiteName?: string,
): SelectedRunDashboardProjection {
  const files = new Map<string, string>();
  const contracts = selectedRun.cases.map((selectedCase) => {
    for (const attempt of selectedCase.attempts) {
      for (const [key, value] of evidenceFiles(root, attempt)) files.set(key, value);
    }
    return projectCase(root, selectedCase, selectedRun.record.status);
  });
  const summary = summarize(contracts);
  return {
    files,
    run: {
      schemaVersion: 2,
      runId: selectedRun.runId,
      coverage: {
        available: selectedRun.coverage.availableCaseIds.length,
        required: selectedRun.coverage.requiredCaseIds.length,
        selected: selectedRun.coverage.selectedCaseIds.length,
        selectionMode: selectedRun.coverage.selectionMode,
        availableCaseIds: selectedRun.coverage.availableCaseIds,
        requiredCaseIds: selectedRun.coverage.requiredCaseIds,
        selectedCaseIds: selectedRun.coverage.selectedCaseIds,
      },
      executionState: selectedRun.executionState,
      visualVerdict: selectedRun.visualVerdict,
      ...(selectedRun.integrityIssues.length > 0
        ? {
            diagnostics: selectedRun.integrityIssues.map((issue) => ({
              kind: "warning" as const,
              code: issue.code,
              message: issue.message,
              blocking: true,
            })),
          }
        : {}),
      ...(suiteName ? { suiteName } : {}),
      status: overallStatus(summary),
      summary,
      contracts,
      startedAt: selectedRun.record.createdAt,
      updatedAt: selectedRun.record.finalizedAt ?? selectedRun.record.createdAt,
      ...(selectedRun.record.finalizedAt ? { finishedAt: selectedRun.record.finalizedAt } : {}),
    },
  };
}
