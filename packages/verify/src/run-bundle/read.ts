import * as fs from "node:fs";
import * as path from "node:path";

import {
  attemptRecordSchema,
  type AttemptRecord,
  type CasePlan,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { AppError } from "../types.ts";
import { readCasePlans } from "./case-plans.ts";
import { validateAttemptEvidence } from "./evidence.ts";
import { ATTEMPT_RECORD_FILE_NAME, attemptsDir } from "./layout.ts";
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
  const plan = readRunPlan(root, runId);
  const record = readRunRecord(root, runId);

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
    const digest = canonicalJsonDigest(casePlan);
    if (digest !== available.casePlanDigest) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Case plan "${available.caseId}" recomputes to digest ${digest}, which does not match the run plan's recorded digest (${available.casePlanDigest}).`,
      );
    }
    casePlanDigestByCaseId.set(available.caseId, digest);
  }

  const attempts = new Map<string, AttemptRecord>();
  const onDiskAttemptIdsByCase = new Map<string, Set<string>>();
  for (const selected of plan.selectedCases) {
    const onDiskAttemptIds = new Set<string>();
    onDiskAttemptIdsByCase.set(selected.caseId, onDiskAttemptIds);
    const dir = attemptsDir(root, runId, selected.caseId);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const attemptPath = path.join(dir, entry.name, ATTEMPT_RECORD_FILE_NAME);
      if (!fs.existsSync(attemptPath)) continue;
      const attempt = readAttemptRecord(attemptPath);
      if (attempt.caseId !== selected.caseId) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Attempt bundle at ${attemptPath} is filed under case "${selected.caseId}" but its own record claims caseId "${attempt.caseId}".`,
        );
      }
      if (attempt.casePlanDigest !== casePlanDigestByCaseId.get(selected.caseId)) {
        throw new AppError(
          "RUN_BUNDLE_DIGEST_MISMATCH",
          `Attempt "${attempt.attemptId}" casePlanDigest (${attempt.casePlanDigest}) does not match case "${selected.caseId}"'s plan digest.`,
        );
      }
      validateAttemptEvidence(root, attempt);
      attempts.set(attempt.attemptId, attempt);
      onDiskAttemptIds.add(attempt.attemptId);
    }
  }

  const selectedCaseIds = new Set(plan.selectedCases.map((entry) => entry.caseId));
  const recordCaseIds = new Set<string>();
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
        throw new AppError(
          "RUN_BUNDLE_MISSING",
          `Run "${runId}" record references attempt "${attemptId}" for case "${caseEntry.caseId}", but no such attempt bundle exists on disk.`,
        );
      }
      if (attempt.caseId !== caseEntry.caseId) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Run "${runId}" record lists attempt "${attemptId}" under case "${caseEntry.caseId}", but the attempt's own record belongs to case "${attempt.caseId}".`,
        );
      }
    }
    // A finalized record is the authoritative membership snapshot: its own attemptIds
    // must exactly equal what's actually published on disk for this case -- neither
    // omitting a published attempt nor claiming one that was never really published.
    if (record.status === "finalized") {
      const onDisk = onDiskAttemptIdsByCase.get(caseEntry.caseId) ?? new Set<string>();
      const recorded = new Set(caseEntry.attemptIds);
      const missingFromRecord = [...onDisk].filter((id) => !recorded.has(id));
      if (missingFromRecord.length > 0) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Run "${runId}" is finalized but case "${caseEntry.caseId}"'s record omits published attempt(s): ${missingFromRecord.join(", ")}.`,
        );
      }
    }
  }
  if (record.status === "finalized") {
    const missingCases = [...selectedCaseIds].filter((caseId) => !recordCaseIds.has(caseId));
    if (missingCases.length > 0) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Run "${runId}" is finalized but its record omits selected case(s): ${missingCases.join(", ")}.`,
      );
    }
  }

  return { plan, record, casePlans, attempts };
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
