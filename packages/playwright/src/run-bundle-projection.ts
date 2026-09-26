import * as fs from "node:fs";

import {
  captureEvidenceSchema,
  deriveCaptureEvidenceDiagnostics,
  projectCaptureEvidence,
  resolveDisplayThreshold,
  resolveStyleGateEligible,
} from "@framelia/contracts";
import {
  ATTEMPT_FORMAT_VERSION,
  ATTEMPT_SCORE_FORMAT_VERSION,
  attemptScoreSchema,
  type AttemptRecord,
  type AttemptScore,
  type CasePlan,
  type Diagnostic,
  type SourceIdentity,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, sanitizePortableValue } from "@framelia/verify";
import type { ResolvedProjectPolicy } from "@framelia/verify/project-policy";
import {
  buildCasePlanForCollectedCase,
  computeAttemptId,
  type AttemptEvidenceFiles,
} from "@framelia/verify/run-bundle";
import type { TestCase, TestResult } from "@playwright/test/reporter";

import { projectCollectedCase } from "./collection.ts";
import { attachmentPath, readScoreAttachments } from "./report-projection.ts";
import type { FrameliaScoreAttachment } from "./score-attachment.ts";

export interface CasePlanBuildResult {
  testId: string;
  caseId: string;
  casePlan: CasePlan;
}

export interface CasePlanBuildContext {
  projectRoot: string;
  runId: string;
  policy: ResolvedProjectPolicy;
  source: SourceIdentity;
}

/**
 * Projects documented Playwright TestCase/FullProject metadata into a versioned CollectedCase,
 * then delegates all runner-independent contract/baseline/policy planning to @framelia/verify.
 */
export async function buildCasePlanForTest(
  test: TestCase,
  context: CasePlanBuildContext,
): Promise<CasePlanBuildResult> {
  const collected = projectCollectedCase(test, context.projectRoot, { strictAnnotation: true });
  if (!collected) {
    throw new Error(`buildCasePlanForTest: test ${test.id} has no framelia.contract annotation.`);
  }
  const casePlan = await buildCasePlanForCollectedCase(collected, context);
  return { testId: test.id, caseId: casePlan.caseId, casePlan };
}

export {
  computeProjectRuntimeDigest,
  contractAnnotatedTests,
  readContractRegistration,
} from "./collection.ts";

function mapAttemptOutcome(
  status: TestResult["status"],
  score: FrameliaScoreAttachment | undefined,
): Pick<AttemptRecord, "executionState" | "visualVerdict"> {
  switch (status) {
    case "passed":
      // A "passed" Playwright result with no score attachment at all (an annotated test
      // whose body never actually ran runFigmaContractTest) has nothing to evaluate.
      return {
        executionState: "completed",
        visualVerdict: score ? (score.pass ? "passed" : "mismatched") : "not-evaluated",
      };
    case "failed":
      // score.pass can disagree with the coarse pass/fail label (a non-visual assertion
      // failed after a passing comparison) -- visualVerdict is specifically about
      // whether the *visual* comparison passed, so the score is authoritative here. No
      // score at all means the failure happened before any comparison ran (navigation,
      // prepare(), a thrown setup error): that's "error", never a definitive verdict.
      return score
        ? { executionState: "completed", visualVerdict: score.pass ? "passed" : "mismatched" }
        : { executionState: "error", visualVerdict: "not-evaluated" };
    case "timedOut":
    case "interrupted":
      return { executionState: "incomplete", visualVerdict: "not-evaluated" };
    case "skipped":
      return { executionState: "blocked", visualVerdict: "not-evaluated" };
    default:
      return { executionState: "error", visualVerdict: "not-evaluated" };
  }
}

function sanitizeExecutionMessage(message: string, projectRoot: string): string {
  return sanitizePortableValue(message, projectRoot);
}

function buildDiagnostics(
  result: TestResult,
  score: FrameliaScoreAttachment | undefined,
  projectRoot: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (result.error?.message) {
    diagnostics.push({
      code: "test-error",
      stage: "execution",
      message: sanitizeExecutionMessage(result.error.message, projectRoot),
    });
  }
  for (const issue of score?.topIssues ?? []) {
    diagnostics.push({
      code: issue.kind,
      stage: "compare",
      message: sanitizeExecutionMessage(issue.message, projectRoot),
      ...(issue.selector
        ? { selector: sanitizeExecutionMessage(issue.selector, projectRoot) }
        : {}),
    });
  }
  for (const warning of score?.warnings ?? []) {
    diagnostics.push({
      code: "warning",
      stage: "capture",
      message: sanitizeExecutionMessage(warning, projectRoot),
    });
  }
  return diagnostics;
}

export interface AttemptBuildResult {
  record: Omit<AttemptRecord, "evidence">;
  files: AttemptEvidenceFiles;
}

function portableCaptureEvidence(
  evidence: NonNullable<FrameliaScoreAttachment["captureEvidence"]>,
): unknown {
  return {
    finalUrl: evidence.finalUrl,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    capturedAt: evidence.capturedAt,
    viewport: evidence.viewport,
    scope: evidence.scope,
    elementRect: evidence.elementRect,
    readiness: evidence.readiness,
    fonts: {
      supported: evidence.fonts.supported,
      status: evidence.fonts.status,
      failed: evidence.fonts.failed,
    },
    screenshotHashes: evidence.screenshotHashes,
    warnings: evidence.warnings,
    actions: evidence.actions,
    ...(evidence.maskEvidence !== undefined ? { maskEvidence: evidence.maskEvidence } : {}),
  };
}

function buildPortableScore(
  score: FrameliaScoreAttachment,
  casePlan: CasePlan,
  projectRoot: string,
): AttemptScore {
  const contract = casePlan.contract.authored;
  const scope =
    score.scope ??
    (contract.scope.kind === "page"
      ? { kind: "page" as const, fullPage: false }
      : {
          kind: "region" as const,
          selector: contract.scope.selector,
          ...(contract.scope.expectSize ? { expectedSize: contract.scope.expectSize } : {}),
        });
  const profile =
    score.profile ??
    contract.profile ??
    (contract.scope.kind === "page" ? "page" : "component/strict");
  const resolvedThreshold = resolveDisplayThreshold({
    profile,
    profileOverrides: score.profileOverrides,
    clusterCheck: score.clusterCheck,
  });
  const screenshotHashes = score.captureEvidence?.screenshotHashes ?? [];
  const stability =
    screenshotHashes.length !== casePlan.stabilitySamples
      ? "unknown"
      : new Set(screenshotHashes).size === 1
        ? "stable"
        : "borderline";
  const diagnostics = deriveCaptureEvidenceDiagnostics(
    score.captureEvidence
      ? projectCaptureEvidence(captureEvidenceSchema.parse(score.captureEvidence), score.targetUrl)
      : undefined,
    [],
  );
  return attemptScoreSchema.parse(
    sanitizePortableValue(
      {
        formatVersion: ATTEMPT_SCORE_FORMAT_VERSION,
        kind: "framelia.attempt-score",
        runType: "final",
        pass: score.pass,
        matchRatio: score.matchRatio,
        ssim: score.ssim,
        avgDeltaE: score.avgDeltaE,
        diffPixels: score.diffPixels,
        baselineSize: score.baselineSize,
        actualSize: score.actualSize,
        targetUrl: score.targetUrl,
        baseline: {
          snapshotDigest: casePlan.snapshotDigest,
          kind: score.baselineKind,
          ...(score.fileKey ? { fileKey: score.fileKey } : {}),
          ...(score.nodeId ? { nodeId: score.nodeId } : {}),
          ...(score.baselineFetchedAt ? { fetchedAt: score.baselineFetchedAt } : {}),
          ...(score.baselineLastModified !== undefined
            ? { lastModified: score.baselineLastModified }
            : {}),
          ...(score.baselinePromotedAt ? { promotedAt: score.baselinePromotedAt } : {}),
          ...(score.baselinePromotedBy ? { promotedBy: score.baselinePromotedBy } : {}),
          ...(score.baselineVersion ? { version: score.baselineVersion } : {}),
          ...(score.baselineRunId ? { sourceRunId: score.baselineRunId } : {}),
        },
        resolvedThreshold: {
          ...resolvedThreshold,
          gateEligible:
            score.gateEligible ?? contract.gateEligible ?? resolvedThreshold.gateEligible,
          styleGateEligible: resolveStyleGateEligible({
            profile,
            styleGateEligible: score.styleGateEligible ?? contract.styleGateEligible,
          }),
        },
        attachmentBaseName: score.attachmentBaseName ?? "framelia-score",
        profile,
        ...(score.clusterCheck !== undefined ? { clusterCheck: score.clusterCheck } : {}),
        ...(score.styleToleranceOverrides
          ? { styleToleranceOverrides: score.styleToleranceOverrides }
          : {}),
        ...(score.profileOverrides ? { profileOverrides: score.profileOverrides } : {}),
        ...(score.gateEligible !== undefined ? { gateEligible: score.gateEligible } : {}),
        ...(score.styleGateEligible !== undefined
          ? { styleGateEligible: score.styleGateEligible }
          : {}),
        scope,
        ...(score.masks ? { masks: score.masks } : {}),
        maxMaskedAreaRatio: score.maxMaskedAreaRatio ?? casePlan.maxMaskedAreaRatio,
        ...(score.captureEvidence
          ? { captureEvidence: portableCaptureEvidence(score.captureEvidence) }
          : {}),
        ...(score.captureEvidence?.maskEvidence
          ? { maskEvidence: score.captureEvidence.maskEvidence }
          : {}),
        stability,
        stabilitySampleCount: screenshotHashes.length,
        topIssues: score.topIssues ?? [],
        diagnostics,
        warnings: score.warnings ?? [],
      },
      projectRoot,
    ),
  );
}

/**
 * Builds one attempt's record + evidence buffers from a completed `TestResult`, reading
 * the exact same `-expected`/`-actual`/`-diff` image attachments and `*-framelia-score`
 * JSON attachment `defineFigmaTests`'s `runFigmaContractTest` already produces (via
 * `attachDiffTriplet`/`attachJson`) -- see `readScoreAttachments`/`attachmentPath` in
 * report-projection.ts, reused verbatim rather than a second attachment convention.
 * `retryIndex` (and therefore `attemptId`) comes from `result.retry`, matching
 * Playwright's own per-attempt retry counter.
 */
export function buildAttemptRecord(
  result: TestResult,
  runId: string,
  casePlan: CasePlan,
  projectRoot: string,
): AttemptBuildResult {
  const [score] = readScoreAttachments(result);
  const { executionState, visualVerdict } = mapAttemptOutcome(result.status, score);
  const attemptId = computeAttemptId(casePlan.caseId, result.retry);

  const record: Omit<AttemptRecord, "evidence"> = {
    formatVersion: ATTEMPT_FORMAT_VERSION,
    kind: "framelia.attempt",
    attemptId,
    runId,
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
    retryIndex: result.retry,
    executionState,
    visualVerdict,
    startedAt: result.startTime.toISOString(),
    ...(executionState === "completed"
      ? { completedAt: new Date(result.startTime.getTime() + result.duration).toISOString() }
      : {}),
    diagnostics: buildDiagnostics(result, score, projectRoot),
  };
  const files: AttemptEvidenceFiles = {};
  const baseName = score?.attachmentBaseName;
  if (baseName) {
    for (const [key, suffix] of [
      ["expected", "-expected"],
      ["actual", "-actual"],
      ["diff", "-diff"],
    ] as const) {
      const attachmentFilePath = attachmentPath(result, baseName, suffix);
      if (attachmentFilePath && fs.existsSync(attachmentFilePath)) {
        files[key] = fs.readFileSync(attachmentFilePath);
      }
    }
  }
  if (score) {
    files.score = Buffer.from(
      `${JSON.stringify(buildPortableScore(score, casePlan, projectRoot), null, 2)}\n`,
    );
  }

  return { record, files };
}
