import * as fs from "node:fs";
import * as path from "node:path";

import {
  attemptRecordSchema,
  isTerminalRunStatus,
  type AttemptRecord,
  type CasePlan,
  type Diagnostic,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { portableErrorMessage } from "../portable.ts";
import { AppError } from "../types.ts";
import { readCasePlans } from "./case-plans.ts";
import { validateAttemptEvidence } from "./evidence.ts";
import {
  ATTEMPT_EVIDENCE_FILE,
  CASES_DIR_NAME,
  ATTEMPT_RECORD_FILE_NAME,
  attemptDir,
  computeAttemptId,
  attemptsDir,
  runDir,
  slug,
  toProjectRelative,
} from "./layout.ts";
import { readRunPlan, readRunRecord } from "./run.ts";

export interface RunBundle {
  plan: RunPlan;
  record: RunRecord;
  /** Full `CasePlan` records, keyed by `caseId` -- `RunPlan.availableCases` only carries digests. */
  casePlans: Map<string, CasePlan>;
  /** Every published attempt reachable from `plan.selectedCases`, keyed by `attemptId`. */
  attempts: Map<string, AttemptRecord>;
}

/**
 * Resolves and validates an entire run bundle from disk, the same way `readPinnedBaseline`
 * resolves and validates a pinned baseline: parse, schema-validate, then recompute and
 * cross-check every digest this bundle's own records claim about each other and about the
 * evidence files they reference, throwing a descriptive `AppError` the moment anything
 * disagrees. Every evidence/case-plan file is resolved as `path.join(root, <recorded
 * project-relative path>)` -- `root` is the only filesystem input this function takes
 * beyond `runId`, so a `.framelia/runs/<runId>` subtree copied verbatim under a fresh
 * `root` (a different machine, a different checkout, no access to the original writer's
 * absolute paths at all) resolves identically to the original.
 */
export function readRunBundle(root: string, runId: string): RunBundle {
  return readRunBundleRecords(root, runId, true).bundle;
}

export interface AttemptReadIssue {
  caseId: string;
  attemptId: string;
  diagnostic: Diagnostic;
}

export interface RunBundleRecordRead {
  bundle: RunBundle;
  missingAttemptIds: ReadonlySet<string>;
  attemptReadIssues: readonly AttemptReadIssue[];
}

/**
 * Shared structural loader for strict verification and the selected-run projection.
 * Structural/digest identity tampering always throws. The selected reader passes
 * `validateEvidenceFiles=false` so missing evidence remains per-item availability data;
 * the strict public `readRunBundle` preserves its fail-fast evidence semantics.
 */
export function readRunBundleRecords(
  root: string,
  runId: string,
  validateEvidenceFiles: boolean,
  tolerateMalformedAttempts = false,
): RunBundleRecordRead {
  const plan = readRunPlan(root, runId);
  const record = readRunRecord(root, runId);
  const terminal = isTerminalRunStatus(record.status);
  if (plan.runId !== runId || record.runId !== runId) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Requested run "${runId}" but loaded plan/record identity "${plan.runId}"/"${record.runId}".`,
    );
  }

  const recomputedPlanDigest = canonicalJsonDigest(plan);
  if (recomputedPlanDigest !== record.planDigest) {
    throw new AppError(
      "RUN_BUNDLE_DIGEST_MISMATCH",
      `Run "${runId}"'s record.planDigest (${record.planDigest}) does not match the frozen plan's recomputed digest (${recomputedPlanDigest}).`,
    );
  }

  const casePlans = readCasePlans(root, runId);
  const casePlanDigestByCaseId = new Map<string, `sha256:${string}`>();
  for (const available of plan.availableCases) {
    const casePlan = casePlans.get(available.caseId);
    if (!casePlan) {
      throw new AppError(
        "RUN_BUNDLE_MISSING",
        `Run "${runId}" plan references case "${available.caseId}", but no case-plan record for it exists in the bundle.`,
      );
    }
    if (casePlan.runId !== runId || casePlan.caseId !== available.caseId) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan "${available.caseId}" does not belong to requested run "${runId}".`,
      );
    }
    const digest = canonicalJsonDigest(casePlan);
    if (digest !== available.casePlanDigest) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Case plan "${available.caseId}" recomputes to digest ${digest}, which does not match the run plan's recorded digest (${available.casePlanDigest}).`,
      );
    }
    casePlanDigestByCaseId.set(available.caseId, digest);
  }
  if (casePlans.size !== plan.availableCases.length) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Run "${runId}" contains case-plan records outside its frozen availableCases membership.`,
    );
  }

  const selectedCaseSlugs = new Set(plan.selectedCases.map((entry) => slug(entry.caseId)));
  const casesRoot = path.join(runDir(root, runId), CASES_DIR_NAME);
  if (fs.existsSync(casesRoot)) {
    for (const entry of fs.readdirSync(casesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !selectedCaseSlugs.has(entry.name)) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Run "${runId}" contains unexpected case attempt directory "${entry.name}".`,
        );
      }
    }
  }
  const attempts = new Map<string, AttemptRecord>();
  const attemptReadIssues: AttemptReadIssue[] = [];
  const onDiskAttemptIdsByCase = new Map<string, Set<string>>();
  for (const selected of plan.selectedCases) {
    const onDiskAttemptIds = new Set<string>();
    const retryIndexes = new Set<number>();
    onDiskAttemptIdsByCase.set(selected.caseId, onDiskAttemptIds);
    const dir = attemptsDir(root, runId, selected.caseId);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const attemptPath = path.join(dir, entry.name, ATTEMPT_RECORD_FILE_NAME);
      if (!fs.existsSync(attemptPath)) {
        if (!tolerateMalformedAttempts) {
          throw new AppError(
            "RUN_BUNDLE_INVALID",
            `Attempt directory "${entry.name}" for case "${selected.caseId}" is missing attempt.json.`,
          );
        }
        attemptReadIssues.push({
          caseId: selected.caseId,
          attemptId: entry.name,
          diagnostic: {
            code: "attempt-publication-partial",
            stage: "publication",
            message: `Attempt directory "${entry.name}" is missing attempt.json.`,
          },
        });
        continue;
      }
      let attempt: AttemptRecord;
      try {
        attempt = readAttemptRecord(attemptPath);
      } catch (error) {
        if (!tolerateMalformedAttempts) throw error;
        attemptReadIssues.push({
          caseId: selected.caseId,
          attemptId: entry.name,
          diagnostic: {
            code: "attempt-record-invalid",
            stage: "publication",
            message: portableErrorMessage(error, root),
          },
        });
        continue;
      }
      if (attempt.runId !== runId || attempt.caseId !== selected.caseId) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Attempt bundle at ${attemptPath} does not belong to run/case "${runId}"/"${selected.caseId}".`,
        );
      }
      const canonicalAttemptId = computeAttemptId(selected.caseId, attempt.retryIndex);
      if (attempt.attemptId !== canonicalAttemptId || entry.name !== slug(canonicalAttemptId)) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Attempt bundle at ${attemptPath} does not use canonical identity "${canonicalAttemptId}".`,
        );
      }
      if (retryIndexes.has(attempt.retryIndex)) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Case "${selected.caseId}" contains duplicate retryIndex ${attempt.retryIndex}.`,
        );
      }
      retryIndexes.add(attempt.retryIndex);
      if (attempt.casePlanDigest !== casePlanDigestByCaseId.get(selected.caseId)) {
        throw new AppError(
          "RUN_BUNDLE_DIGEST_MISMATCH",
          `Attempt "${attempt.attemptId}" casePlanDigest (${attempt.casePlanDigest}) does not match case "${selected.caseId}"'s plan digest.`,
        );
      }
      if (attempts.has(attempt.attemptId)) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Run "${runId}" contains duplicate attempt identity "${attempt.attemptId}".`,
        );
      }
      for (const [kind, reference] of Object.entries(attempt.evidence)) {
        if (!reference) continue;
        const expected = toProjectRelative(
          root,
          path.join(
            attemptDir(root, runId, selected.caseId, attempt.attemptId),
            ATTEMPT_EVIDENCE_FILE[kind as keyof typeof ATTEMPT_EVIDENCE_FILE],
          ),
        );
        if (reference.path !== expected) {
          throw new AppError(
            "RUN_BUNDLE_INVALID",
            `Attempt "${attempt.attemptId}" ${kind} evidence path is not its canonical portable bundle path.`,
          );
        }
      }
      if (validateEvidenceFiles) validateAttemptEvidence(root, attempt);
      attempts.set(attempt.attemptId, attempt);
      onDiskAttemptIds.add(attempt.attemptId);
    }
  }

  const selectedCaseIds = new Set(plan.selectedCases.map((entry) => entry.caseId));
  const recordCaseIds = new Set<string>();
  const missingAttemptIds = new Set<string>();
  for (const caseEntry of record.cases) {
    recordCaseIds.add(caseEntry.caseId);
    if (!selectedCaseIds.has(caseEntry.caseId)) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Run "${runId}" record references case "${caseEntry.caseId}", which is not part of the frozen plan's selectedCases.`,
      );
    }
    for (const attemptId of caseEntry.attemptIds) {
      const attempt = attempts.get(attemptId);
      if (!attempt) {
        if (validateEvidenceFiles) {
          throw new AppError(
            "RUN_BUNDLE_MISSING",
            `Run "${runId}" record references attempt "${attemptId}" for case "${caseEntry.caseId}", but no such attempt bundle exists on disk.`,
          );
        }
        missingAttemptIds.add(attemptId);
        continue;
      }
      if (attempt.caseId !== caseEntry.caseId) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Run "${runId}" record lists attempt "${attemptId}" under case "${caseEntry.caseId}", but the attempt's own record belongs to case "${attempt.caseId}".`,
        );
      }
    }
    if (terminal) {
      const onDisk = onDiskAttemptIdsByCase.get(caseEntry.caseId) ?? new Set<string>();
      const recorded = new Set(caseEntry.attemptIds);
      const missingFromRecord = [...onDisk].filter((id) => !recorded.has(id));
      if (missingFromRecord.length > 0) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Terminal run "${runId}" (${record.status}) case "${caseEntry.caseId}" record omits published attempt(s): ${missingFromRecord.join(", ")}.`,
        );
      }
    }
  }
  if (terminal) {
    const missingCases = [...selectedCaseIds].filter((caseId) => !recordCaseIds.has(caseId));
    if (missingCases.length > 0) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Terminal run "${runId}" (${record.status}) record omits selected case(s): ${missingCases.join(", ")}.`,
      );
    }
  }

  return {
    bundle: { plan, record, casePlans, attempts },
    missingAttemptIds,
    attemptReadIssues,
  };
}

function readAttemptRecord(filePath: string): AttemptRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Attempt record at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  return attemptRecordSchema.parse(parsed);
}
