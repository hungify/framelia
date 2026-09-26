import * as fs from "node:fs";
import * as path from "node:path";

import { resolveDisplayThreshold, resolveStyleGateEligible } from "@framelia/contracts";
import {
  authoritativeRunRequirementsSchema,
  attemptScoreSchema,
  type AttemptRecord,
  type AttemptScore,
  type AuthoritativeRunRequirements,
  type CasePlan,
  type Diagnostic,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { SEVERITY_RANK, STYLE_GATE_BLOCKING_KINDS, STYLE_GATE_MIN_SEVERITY } from "../constants.ts";
import { sha256Hex } from "../hash.ts";
import { AppError } from "../types.ts";
import { computeCaseId } from "./layout.ts";
import { readRunBundleRecords } from "./read.ts";

export type EvidenceAvailability = "available" | "missing" | "invalid" | "not-recorded";

export interface SelectedEvidence {
  kind: "expected" | "actual" | "diff" | "score";
  availability: EvidenceAvailability;
  portablePath?: string;
  digest?: string;
  message?: string;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateAuthoritativeAttempt(
  casePlan: CasePlan,
  attempt: SelectedAttempt,
  trustedObservedOrigin: string,
): string[] {
  const score = attempt.score;
  if (!score) return ["versioned score is unavailable"];
  const contract = casePlan.contract.authored;
  const profile =
    contract.profile ?? (contract.scope.kind === "page" ? "page" : "component/strict");
  const resolved = resolveDisplayThreshold({
    profile,
    profileOverrides: contract.profileOverrides,
  });
  const expectedThreshold = {
    ...resolved,
    gateEligible: contract.gateEligible ?? resolved.gateEligible,
    styleGateEligible: resolveStyleGateEligible({
      profile,
      styleGateEligible: contract.styleGateEligible,
    }),
  };
  const expectedScope =
    contract.scope.kind === "page"
      ? { kind: "page" }
      : {
          kind: "region",
          selector: contract.scope.selector,
          ...(contract.scope.expectSize ? { expectedSize: contract.scope.expectSize } : {}),
        };
  const scoreScope =
    score.scope.kind === "page"
      ? { kind: "page" }
      : {
          kind: "region",
          selector: score.scope.selector,
          ...(score.scope.expectedSize ? { expectedSize: score.scope.expectedSize } : {}),
        };
  const reasons: string[] = [];
  const expectedEvidence = attempt.evidence.expected;
  if (
    expectedEvidence.availability !== "available" ||
    expectedEvidence.digest !== casePlan.expectedDigest
  ) {
    reasons.push("expected image evidence does not match the frozen baseline image digest");
  }
  const targetUrl = new URL(score.targetUrl);
  if (targetUrl.origin !== trustedObservedOrigin) {
    reasons.push("score target URL origin does not match the trusted observed served origin");
  }
  const capturedFinalOrigin = score.captureEvidence
    ? new URL(score.captureEvidence.finalUrl).origin
    : undefined;
  if (capturedFinalOrigin !== trustedObservedOrigin) {
    reasons.push("captured final URL origin does not match the trusted observed served origin");
  }
  if (`${targetUrl.pathname}${targetUrl.search}` !== contract.target.path) {
    reasons.push("score target URL path does not match the frozen contract target");
  }
  if (
    score.baseline.snapshotDigest !== casePlan.snapshotDigest ||
    score.baseline.kind !== casePlan.baselineSource.kind ||
    score.baseline.fileKey !== casePlan.baselineSource.fileKey ||
    score.baseline.nodeId !== casePlan.baselineSource.nodeId
  ) {
    reasons.push("score baseline identity does not match the frozen baseline");
  }
  if (!sameJson(score.baselineSize, casePlan.expectedSize)) {
    reasons.push("score baseline size does not match the frozen expected image size");
  }
  if (
    score.profile !== profile ||
    !sameJson(score.profileOverrides, contract.profileOverrides) ||
    !sameJson(score.styleToleranceOverrides, contract.styleToleranceOverrides) ||
    score.gateEligible !== contract.gateEligible ||
    score.styleGateEligible !== contract.styleGateEligible ||
    !sameJson(score.resolvedThreshold, expectedThreshold)
  ) {
    reasons.push("score profile or resolved threshold facts do not match the frozen contract");
  }
  if (!expectedThreshold.gateEligible) {
    reasons.push("frozen contract is not gate eligible");
  }
  if (
    !sameJson(scoreScope, expectedScope) ||
    !sameJson(score.masks ?? [], contract.masks ?? []) ||
    score.maxMaskedAreaRatio !== casePlan.maxMaskedAreaRatio
  ) {
    reasons.push("score scope, selector, size, or mask facts do not match the frozen contract");
  }
  const stabilityHashes = score.captureEvidence?.screenshotHashes ?? [];
  if (
    score.stability !== "stable" ||
    score.stabilitySampleCount !== casePlan.stabilitySamples ||
    stabilityHashes.length !== casePlan.stabilitySamples ||
    new Set(stabilityHashes).size !== 1
  ) {
    reasons.push("capture stability does not match the frozen sample count");
  }
  if (score.diagnostics.some((diagnostic) => diagnostic.blocking)) {
    reasons.push("score contains blocking capture diagnostics");
  }
  if (score.topIssues.some((issue) => issue.blocking)) {
    reasons.push("score contains blocking pixel or style issues");
  }
  if (
    expectedThreshold.styleGateEligible &&
    score.topIssues.some(
      (issue) =>
        STYLE_GATE_BLOCKING_KINDS.includes(
          issue.kind as (typeof STYLE_GATE_BLOCKING_KINDS)[number],
        ) && SEVERITY_RANK[issue.severity] <= SEVERITY_RANK[STYLE_GATE_MIN_SEVERITY],
    )
  ) {
    reasons.push("score contains a style-gate blocking issue");
  }
  if (contract.masks?.length) {
    const mask = score.maskEvidence;
    if (
      !mask ||
      mask.status !== "applied" ||
      !sameJson(
        mask.requested.map(({ selector, reason, maxMatches }) => ({
          selector,
          reason,
          maxMatches,
        })),
        contract.masks,
      ) ||
      mask.maskedAreaRatio > casePlan.maxMaskedAreaRatio
    ) {
      reasons.push("complete applied mask evidence does not match the frozen masks");
    }
  }
  if (score.pass) {
    if (
      score.matchRatio === null ||
      score.ssim === null ||
      score.avgDeltaE === null ||
      score.diffPixels === null
    ) {
      reasons.push("passing score is missing measured comparison metrics");
    } else {
      if (score.matchRatio < expectedThreshold.minMatch) {
        reasons.push("passing score matchRatio is below the resolved threshold");
      }
      if (score.ssim < expectedThreshold.minSSIM) {
        reasons.push("passing score SSIM is below the resolved threshold");
      }
      if (score.avgDeltaE > expectedThreshold.maxAvgDeltaE) {
        reasons.push("passing score average DeltaE exceeds the resolved threshold");
      }
      if (
        expectedThreshold.maxDiffPixels !== null &&
        score.diffPixels > expectedThreshold.maxDiffPixels
      ) {
        reasons.push("passing score diffPixels exceeds the resolved threshold");
      }
    }
    const expectedArea = score.baselineSize.width * score.baselineSize.height;
    const actualArea = score.actualSize.width * score.actualSize.height;
    const areaGapPercent =
      expectedArea === 0
        ? Number.POSITIVE_INFINITY
        : (Math.abs(actualArea - expectedArea) / expectedArea) * 100;
    if (areaGapPercent > expectedThreshold.maxAreaGapPercent) {
      reasons.push("passing score size gap exceeds the resolved threshold");
    }
  }
  return reasons;
}

export interface SelectedAttempt {
  record: AttemptRecord;
  score?: AttemptScore;
  evidence: Record<SelectedEvidence["kind"], SelectedEvidence>;
  integrityIssues: Diagnostic[];
}

export interface SelectedCase {
  runId: string;
  caseId: string;
  plan: CasePlan;
  selectedAttemptId?: string;
  selectedAttempt?: SelectedAttempt;
  attempts: SelectedAttempt[];
  missingAttemptIds: string[];
  invalidAttempts: Array<{ attemptId: string; issues: Diagnostic[] }>;
}

export interface SelectedRun {
  runId: string;
  plan: RunPlan;
  record: RunRecord;
  coverage: {
    availableCaseIds: string[];
    requiredCaseIds: string[];
    selectedCaseIds: string[];
    selectionMode: "all" | "subset";
  };
  executionState: "running" | "completed" | "incomplete" | "error";
  visualVerdict: "passed" | "mismatched" | "not-evaluated";
  cases: SelectedCase[];
  integrityIssues: Diagnostic[];
}

const EVIDENCE_KINDS = ["expected", "actual", "diff", "score"] as const;

function readEvidence(
  root: string,
  attempt: AttemptRecord,
): {
  evidence: SelectedAttempt["evidence"];
  score?: AttemptScore;
  issues: Diagnostic[];
} {
  const issues: Diagnostic[] = [];
  const evidence = {} as SelectedAttempt["evidence"];
  let score: AttemptScore | undefined;

  for (const kind of EVIDENCE_KINDS) {
    const reference = attempt.evidence[kind];
    if (!reference) {
      evidence[kind] = { kind, availability: "not-recorded" };
      continue;
    }
    const absolutePath = path.resolve(root, reference.path);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(absolutePath);
    } catch {
      evidence[kind] = {
        kind,
        availability: "missing",
        portablePath: reference.path,
        digest: reference.digest,
        message: `EVIDENCE_MISSING: ${reference.path}`,
      };
      issues.push({
        code: "evidence-missing",
        stage: "evidence",
        message: `${kind} evidence is missing at ${reference.path}.`,
      });
      continue;
    }
    const actualDigest = `sha256:${sha256Hex(bytes)}` as const;
    if (actualDigest !== reference.digest) {
      evidence[kind] = {
        kind,
        availability: "invalid",
        portablePath: reference.path,
        digest: reference.digest,
        message: `digest ${actualDigest} does not match ${reference.digest}`,
      };
      issues.push({
        code: "evidence-digest-mismatch",
        stage: "evidence",
        message: `${kind} evidence digest does not match its attempt record.`,
      });
      continue;
    }
    if (kind === "score") {
      try {
        score = attemptScoreSchema.parse(JSON.parse(bytes.toString("utf8")));
      } catch {
        evidence[kind] = {
          kind,
          availability: "invalid",
          portablePath: reference.path,
          digest: reference.digest,
          message: "SCORE_SCHEMA_INVALID",
        };
        issues.push({
          code: "score-invalid",
          stage: "evidence",
          message: `score evidence at ${reference.path} is not a valid versioned attempt score.`,
        });
        continue;
      }
    }
    evidence[kind] = {
      kind,
      availability: "available",
      portablePath: reference.path,
      digest: reference.digest,
    };
  }

  if (attempt.executionState === "completed" && attempt.visualVerdict !== "not-evaluated") {
    for (const required of ["expected", "actual", "score"] as const) {
      if (evidence[required].availability === "not-recorded") {
        issues.push({
          code: "required-evidence-not-recorded",
          stage: "evidence",
          message: `Completed evaluated attempt omitted required ${required} evidence.`,
        });
      }
    }
  }
  if (
    score &&
    ((score.pass && attempt.visualVerdict !== "passed") ||
      (!score.pass && attempt.visualVerdict !== "mismatched"))
  ) {
    issues.push({
      code: "score-verdict-mismatch",
      stage: "evidence",
      message: "Versioned score pass state disagrees with the attempt visual verdict.",
    });
  }

  return { evidence, ...(score ? { score } : {}), issues };
}

/**
 * Reads one explicit run and no other. Structural membership/digest tampering throws;
 * missing or hash-invalid evidence is retained as per-attempt availability diagnostics.
 */
export function readSelectedRun(root: string, runId: string): SelectedRun {
  const { bundle, missingAttemptIds, attemptReadIssues } = readRunBundleRecords(
    root,
    runId,
    false,
    true,
  );
  const { plan, record, casePlans, attempts } = bundle;
  const recordByCase = new Map(record.cases.map((entry) => [entry.caseId, entry]));
  const issues: Diagnostic[] = [
    ...record.diagnostics,
    ...attemptReadIssues.map((issue) => issue.diagnostic),
  ];

  const cases = plan.selectedCases.map((selected): SelectedCase => {
    const casePlan = casePlans.get(selected.caseId)!;
    if (
      canonicalJsonDigest(casePlan.contract.authored) !== casePlan.contract.digest ||
      canonicalJsonDigest(casePlan.binding) !== casePlan.bindingDigest ||
      casePlan.registration.specFile !== casePlan.specFile ||
      casePlan.registration.specDigest !== casePlan.specFileDigest
    ) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Case plan "${casePlan.caseId}" embedded authored contract/binding/registration identity is inconsistent with its claimed digests.`,
      );
    }
    const canonicalCaseId = computeCaseId({
      contractId: casePlan.contract.id,
      projectName: casePlan.project.name,
      repeatIndex: casePlan.repeatIndex,
    });
    if (canonicalCaseId !== casePlan.caseId) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan "${casePlan.caseId}" identity does not match its contract/project/repeat tuple (${canonicalCaseId}).`,
      );
    }
    const caseRecord = recordByCase.get(selected.caseId);
    const caseAttempts = [...attempts.values()]
      .filter((attempt) => attempt.caseId === selected.caseId)
      .toSorted((a, b) => a.retryIndex - b.retryIndex || a.attemptId.localeCompare(b.attemptId))
      .map((attempt): SelectedAttempt => {
        const loaded = readEvidence(root, attempt);
        issues.push(...loaded.issues);
        const selectedAttempt: SelectedAttempt = {
          record: attempt,
          evidence: loaded.evidence,
          integrityIssues: loaded.issues,
        };
        if (loaded.score) selectedAttempt.score = loaded.score;
        return selectedAttempt;
      });
    const selectedAttemptId = caseRecord?.selectedAttemptId;
    const selectedAttempt = selectedAttemptId
      ? caseAttempts.find((attempt) => attempt.record.attemptId === selectedAttemptId)
      : bundle.record.status === "running"
        ? caseAttempts.at(-1)
        : undefined;
    const caseMissingAttemptIds = (caseRecord?.attemptIds ?? []).filter((id) =>
      missingAttemptIds.has(id),
    );
    const invalidAttempts = attemptReadIssues
      .filter((issue) => issue.caseId === selected.caseId)
      .map((issue) => ({ attemptId: issue.attemptId, issues: [issue.diagnostic] }));
    for (const attemptId of caseMissingAttemptIds) {
      issues.push({
        code: "attempt-missing",
        stage: "execution",
        message: `Run record references missing attempt "${attemptId}" for case "${selected.caseId}".`,
      });
    }
    return {
      runId,
      caseId: selected.caseId,
      plan: casePlan,
      attempts: caseAttempts,
      missingAttemptIds: caseMissingAttemptIds,
      invalidAttempts,
      ...(selectedAttemptId ? { selectedAttemptId } : {}),
      ...(selectedAttempt ? { selectedAttempt } : {}),
    };
  });

  const selectedAttempts = cases.map((entry) => entry.selectedAttempt).filter(Boolean);
  const executionState =
    record.status === "running" || record.status === "planned"
      ? "running"
      : record.status === "finalized" &&
          issues.length === 0 &&
          selectedAttempts.length === cases.length &&
          selectedAttempts.every((attempt) => attempt!.record.executionState === "completed")
        ? "completed"
        : record.status === "error"
          ? "error"
          : "incomplete";
  const visualVerdict = cases.some(
    (entry) => entry.selectedAttempt?.record.visualVerdict === "mismatched",
  )
    ? "mismatched"
    : cases.length > 0 &&
        cases.every((entry) => entry.selectedAttempt?.record.visualVerdict === "passed")
      ? "passed"
      : "not-evaluated";

  return {
    runId,
    plan,
    record,
    coverage: {
      availableCaseIds: plan.availableCases.map((entry) => entry.caseId),
      requiredCaseIds: plan.requiredCases.map((entry) => entry.caseId),
      selectedCaseIds: plan.selectedCases.map((entry) => entry.caseId),
      selectionMode: plan.selection.mode,
    },
    executionState,
    visualVerdict,
    cases,
    integrityIssues: issues,
  };
}

export interface AuthoritativeRunIssue {
  code: string;
  message: string;
  caseId?: string;
  attemptId?: string;
}

export interface AuthoritativeCaseVerdict {
  caseId: string;
  visualVerdict: "passed" | "mismatched" | "not-evaluated";
  acceptedAttemptId?: string;
  attempts: Array<{
    attemptId: string;
    retryIndex: number;
    executionState: AttemptRecord["executionState"];
    visualVerdict: AttemptRecord["visualVerdict"];
  }>;
  issues: AuthoritativeRunIssue[];
}

export interface AuthoritativeRunVerdict {
  runId: string;
  executionState: "completed" | "incomplete";
  visualVerdict: "passed" | "mismatched" | "not-evaluated";
  exitCode: 0 | 1 | 2;
  servedBuild: AuthoritativeRunRequirements["servedBuild"];
  authority: {
    runId: string;
    issuedAt: string;
    expiresAt: string;
    jobIdentity: string;
    audience: string;
  };
  issues: AuthoritativeRunIssue[];
  cases: AuthoritativeCaseVerdict[];
  next?: { command: string; argv: string[] };
}

/**
 * Loads and integrity-checks the selected bundle itself before applying independently
 * supplied authority. Callers cannot pass a forged in-memory SelectedRun projection.
 */
export function evaluateAuthoritativeRun(
  root: string,
  runId: string,
  trustedRequirements: AuthoritativeRunRequirements,
): AuthoritativeRunVerdict {
  const trusted = authoritativeRunRequirementsSchema.parse(trustedRequirements);
  const selected = readSelectedRun(root, runId);
  const issues: AuthoritativeRunIssue[] = [];
  for (const diagnostic of selected.record.diagnostics) {
    issues.push({ code: diagnostic.code, message: diagnostic.message });
  }
  const trustedByCase = new Map(trusted.requiredCases.map((entry) => [entry.caseId, entry]));
  const selectedByCase = new Map(selected.cases.map((entry) => [entry.caseId, entry]));
  if (trusted.runId !== runId) {
    issues.push({
      code: "trusted-run-mismatch",
      message: `Trusted requirements name run "${trusted.runId}", not selected run "${runId}".`,
    });
  }

  if (selected.record.status !== "finalized") {
    issues.push({ code: "run-not-finalized", message: "Selected run is not finalized." });
  }
  for (const required of trusted.requiredCases) {
    if (!selectedByCase.has(required.caseId)) {
      issues.push({
        code: "required-case-missing",
        caseId: required.caseId,
        message: `Trusted required case "${required.caseId}" is absent from the selected run.`,
      });
    }
  }
  for (const selectedCase of selected.cases) {
    if (!trustedByCase.has(selectedCase.caseId)) {
      issues.push({
        code: "unexpected-selected-case",
        caseId: selectedCase.caseId,
        message: `Selected case "${selectedCase.caseId}" is outside the trusted full matrix.`,
      });
    }
  }
  if (selected.plan.policyDigest !== trusted.policyDigest) {
    issues.push({
      code: "policy-mismatch",
      message: "Run policy digest does not match trusted policy.",
    });
  }
  if (selected.plan.retryAcceptance !== trusted.retryAcceptance) {
    issues.push({
      code: "retry-policy-mismatch",
      message: "Frozen run retry acceptance does not match trusted policy.",
    });
  }
  const observedBuildDigest =
    trusted.servedBuild.mode === "ci-owned"
      ? trusted.servedBuild.observedBuildDigest
      : trusted.servedBuild.attestation.observedBuildDigest;
  const observedOrigin =
    trusted.servedBuild.mode === "ci-owned"
      ? trusted.servedBuild.observedOrigin
      : trusted.servedBuild.attestation.observedOrigin;
  if (observedBuildDigest !== trusted.source.buildDigest) {
    issues.push({
      code: "served-build-mismatch",
      message: "Trusted observed served build does not match the protected expected build.",
    });
  }

  const cases: AuthoritativeCaseVerdict[] = trusted.requiredCases.map((required) => {
    const selectedCase = selectedByCase.get(required.caseId);
    const caseIssues: AuthoritativeRunIssue[] = [];
    if (!selectedCase) {
      return {
        caseId: required.caseId,
        visualVerdict: "not-evaluated",
        attempts: [],
        issues: [
          {
            code: "required-case-missing",
            caseId: required.caseId,
            message: "Required case has no selected-run evidence.",
          },
        ],
      };
    }

    const plan = selectedCase.plan;
    if (
      plan.bindingDigest !== required.bindingDigest ||
      plan.registration.specFile !== required.specFile ||
      plan.registration.specDigest !== required.specFileDigest ||
      JSON.stringify(plan.registration.titlePath) !== JSON.stringify(required.titlePath)
    ) {
      caseIssues.push({
        code: "registration-identity-mismatch",
        caseId: required.caseId,
        message: "Frozen binding/spec identity does not match trusted requirements.",
      });
    }
    if (
      plan.contract.id !== required.contractId ||
      plan.project.name !== required.projectName ||
      plan.repeatIndex !== required.repeatIndex
    ) {
      caseIssues.push({
        code: "case-identity-mismatch",
        caseId: required.caseId,
        message: "Case contract/project/repeat identity does not match trusted requirements.",
      });
    }
    const plannedDigest = selected.plan.selectedCases.find(
      (entry) => entry.caseId === required.caseId,
    )?.casePlanDigest;
    if (plannedDigest !== required.casePlanDigest) {
      caseIssues.push({
        code: "case-plan-digest-mismatch",
        caseId: required.caseId,
        message: "Case-plan digest does not match trusted requirements.",
      });
    }
    if (plan.contract.digest !== required.contractDigest) {
      caseIssues.push({
        code: "contract-digest-mismatch",
        caseId: required.caseId,
        message: "Authored contract digest does not match trusted requirements.",
      });
    }
    if (plan.policyDigest !== trusted.policyDigest) {
      caseIssues.push({
        code: "case-policy-mismatch",
        caseId: required.caseId,
        message: "Case policy digest does not match trusted policy.",
      });
    }
    if (plan.retryAcceptance !== trusted.retryAcceptance) {
      caseIssues.push({
        code: "case-retry-policy-mismatch",
        caseId: required.caseId,
        message: "Frozen case retry acceptance does not match trusted policy.",
      });
    }
    if (
      plan.source.sourceDigest !== trusted.source.sourceDigest ||
      plan.source.buildDigest !== trusted.source.buildDigest ||
      plan.source.dirty !== false
    ) {
      caseIssues.push({
        code: "source-build-untrusted",
        caseId: required.caseId,
        message: "Case source/build identity is unknown, dirty, or mismatched.",
      });
    }
    if (selectedCase.missingAttemptIds.length > 0) {
      caseIssues.push({
        code: "attempt-missing",
        caseId: required.caseId,
        message: "One or more recorded attempts are missing.",
      });
    }
    for (const attempt of selectedCase.attempts) {
      for (const integrity of attempt.integrityIssues) {
        caseIssues.push({
          code: integrity.code,
          caseId: required.caseId,
          attemptId: attempt.record.attemptId,
          message: integrity.message,
        });
      }
    }
    for (const invalidAttempt of selectedCase.invalidAttempts) {
      for (const integrity of invalidAttempt.issues) {
        caseIssues.push({
          code: integrity.code,
          caseId: required.caseId,
          attemptId: invalidAttempt.attemptId,
          message: integrity.message,
        });
      }
    }

    const completed = selectedCase.attempts.filter(
      (attempt) => attempt.record.executionState === "completed",
    );
    const observed =
      trusted.retryAcceptance === "require-first-attempt"
        ? selectedCase.attempts.find((attempt) => attempt.record.retryIndex === 0)
        : (completed.findLast((attempt) => attempt.record.visualVerdict === "passed") ??
          completed.at(-1));
    const authorityReasons = observed
      ? validateAuthoritativeAttempt(plan, observed, observedOrigin)
      : [];
    for (const reason of authorityReasons) {
      caseIssues.push({
        code: "attempt-authority-invalid",
        caseId: required.caseId,
        attemptId: observed?.record.attemptId,
        message: reason,
      });
    }
    if (!selectedCase.selectedAttemptId) {
      caseIssues.push({
        code: "selected-attempt-missing",
        caseId: required.caseId,
        message: "Finalized case has no reconciled selectedAttemptId.",
      });
    } else if (observed && selectedCase.selectedAttemptId !== observed.record.attemptId) {
      caseIssues.push({
        code: "selected-attempt-policy-mismatch",
        caseId: required.caseId,
        attemptId: observed.record.attemptId,
        message: "Recorded selected attempt does not agree with frozen trusted retry policy.",
      });
    }
    const authoritative =
      observed?.record.executionState === "completed" &&
      observed.integrityIssues.length === 0 &&
      authorityReasons.length === 0 &&
      selectedCase.selectedAttemptId === observed.record.attemptId
        ? observed
        : undefined;
    if (!authoritative) {
      caseIssues.push({
        code: "case-not-evaluated",
        caseId: required.caseId,
        message: "No complete attempt satisfies the trusted retry acceptance policy.",
      });
    }
    return {
      caseId: required.caseId,
      visualVerdict: observed?.record.visualVerdict ?? "not-evaluated",
      ...(authoritative ? { acceptedAttemptId: authoritative.record.attemptId } : {}),
      attempts: selectedCase.attempts.map((attempt) => ({
        attemptId: attempt.record.attemptId,
        retryIndex: attempt.record.retryIndex,
        executionState: attempt.record.executionState,
        visualVerdict: attempt.record.visualVerdict,
      })),
      issues: caseIssues,
    };
  });

  issues.push(...cases.flatMap((entry) => entry.issues));
  const visualVerdict = cases.some((entry) => entry.visualVerdict === "mismatched")
    ? "mismatched"
    : cases.length > 0 && cases.every((entry) => entry.visualVerdict === "passed")
      ? "passed"
      : "not-evaluated";
  const incomplete = issues.length > 0 || cases.some((entry) => !entry.acceptedAttemptId);
  if (visualVerdict === "mismatched") {
    issues.push(
      ...cases
        .filter((entry) => entry.visualVerdict === "mismatched")
        .map((entry) => ({
          code: "visual-mismatch",
          caseId: entry.caseId,
          message: `Required case "${entry.caseId}" does not match its frozen baseline.`,
        })),
    );
  }
  const exitCode = incomplete ? 2 : visualVerdict === "mismatched" ? 1 : 0;
  return {
    runId,
    executionState: incomplete ? "incomplete" : "completed",
    visualVerdict,
    exitCode,
    servedBuild: trusted.servedBuild,
    authority: {
      runId: trusted.runId,
      issuedAt: trusted.issuedAt,
      expiresAt: trusted.expiresAt,
      jobIdentity: trusted.jobIdentity,
      audience: trusted.audience,
    },
    issues,
    cases,
    ...(incomplete ? { next: { command: "pnpm", argv: ["exec", "playwright", "test"] } } : {}),
  };
}
