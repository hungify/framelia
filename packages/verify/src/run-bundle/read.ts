import * as fs from "node:fs";
import * as path from "node:path";

import {
  attemptRecordSchema,
  casePlanSchema,
  type AttemptRecord,
  type CasePlan,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { fileHash } from "../hash.ts";
import { AppError } from "../types.ts";
import { ATTEMPT_RECORD_FILE_NAME, attemptsDir, casePlansDir } from "./layout.ts";
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
  }

  const attempts = new Map<string, AttemptRecord>();
  for (const selected of plan.selectedCases) {
    const dir = attemptsDir(root, runId, selected.caseId);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const attemptPath = path.join(dir, entry.name, ATTEMPT_RECORD_FILE_NAME);
      if (!fs.existsSync(attemptPath)) continue;
      const attempt = readAttemptRecord(attemptPath);
      validateAttemptEvidence(root, attempt);
      attempts.set(attempt.attemptId, attempt);
    }
  }

  for (const caseEntry of record.cases) {
    for (const attemptId of caseEntry.attemptIds) {
      if (!attempts.has(attemptId)) {
        throw new AppError(
          "RUN_BUNDLE_MISSING",
          `Run "${runId}" record references attempt "${attemptId}" for case "${caseEntry.caseId}", but no such attempt bundle exists on disk.`,
        );
      }
    }
  }

  return { plan, record, casePlans, attempts };
}

function readCasePlans(root: string, runId: string): Map<string, CasePlan> {
  const dir = casePlansDir(root, runId);
  const casePlans = new Map<string, CasePlan>();
  if (!fs.existsSync(dir)) return casePlans;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    const casePlan = casePlanSchema.parse(parsed);
    casePlans.set(casePlan.caseId, casePlan);
  }
  return casePlans;
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

function validateAttemptEvidence(root: string, attempt: AttemptRecord): void {
  for (const [key, reference] of Object.entries(attempt.evidence)) {
    if (!reference) continue;
    const absolutePath = path.join(root, reference.path);
    if (!fs.existsSync(absolutePath)) {
      throw new AppError(
        "RUN_BUNDLE_MISSING",
        `Attempt "${attempt.attemptId}" evidence "${key}" is missing at ${absolutePath}.`,
      );
    }
    const digest = fileHash(absolutePath);
    if (digest !== reference.digest) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Attempt "${attempt.attemptId}" evidence "${key}" at ${absolutePath} does not match its recorded digest: expected ${reference.digest}, recomputed ${digest}.`,
      );
    }
  }
}
