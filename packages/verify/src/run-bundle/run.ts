import * as fs from "node:fs";
import * as path from "node:path";

import {
  attemptRecordSchema,
  casePlanSchema,
  RUN_FORMAT_VERSION,
  runPlanSchema,
  runRecordSchema,
  type AttemptRecord,
  type CasePlan,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { writeFileAtomic } from "../fs-atomic.ts";
import type { RetryAcceptancePolicy } from "../project-policy.ts";
import { AppError } from "../types.ts";
import {
  ATTEMPT_RECORD_FILE_NAME,
  attemptsDir,
  planDir,
  runPlanPath,
  runRecordPath,
  slug,
} from "./layout.ts";
import { publishBundleUnit, type StagedFile } from "./staged-write.ts";

/**
 * Freezes a run's required/selected membership and every collected case's own plan
 * before any execution happens, as one immutable bundle unit -- `plan.json` plus every
 * `case-plans/<caseId>.json` land together, or not at all. Throws `RUN_BUNDLE_ALREADY_PUBLISHED`
 * if this `plan.runId` was already frozen (a run plan never changes mid-run).
 *
 * Every `casePlans` entry's own recomputed digest must match the digest recorded for it
 * in `plan.availableCases` -- a defensive cross-check against a caller bug that would
 * otherwise let a run-plan's own membership disagree with the full case-plan records
 * meant to back it up.
 */
export function freezeRunPlan(root: string, plan: RunPlan, casePlans: readonly CasePlan[]): void {
  const validatedPlan = runPlanSchema.parse(plan);
  const availableDigests = new Map(
    validatedPlan.availableCases.map((entry) => [entry.caseId, entry.casePlanDigest]),
  );

  const files: StagedFile[] = casePlans.map((casePlan) => {
    const validated = casePlanSchema.parse(casePlan);
    const digest = canonicalJsonDigest(validated);
    const expected = availableDigests.get(validated.caseId);
    if (expected !== digest) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan ${validated.caseId} recomputes to digest ${digest}, which does not match its entry in the run plan's availableCases (${expected ?? "missing"}).`,
      );
    }
    return {
      relativePath: `case-plans/${slug(validated.caseId)}.json`,
      content: `${JSON.stringify(validated, null, 2)}\n`,
    };
  });
  files.push({ relativePath: "plan.json", content: `${JSON.stringify(validatedPlan, null, 2)}\n` });

  publishBundleUnit(planDir(root, validatedPlan.runId), files);
}

/** Reads the frozen `RunPlan` published by `freezeRunPlan`. */
export function readRunPlan(root: string, runId: string): RunPlan {
  const filePath = runPlanPath(root, runId);
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "RUN_BUNDLE_MISSING",
      `No frozen run plan for run "${runId}" at ${filePath}. freezeRunPlan() must run before any attempt is published or the run is finalized.`,
    );
  }
  return parseJsonFile(
    filePath,
    runPlanSchema,
    "RUN_BUNDLE_INVALID",
    `run plan for run "${runId}"`,
  );
}

/**
 * Publishes/overwrites the run's own coordination record (`run.json`). Unlike a run plan
 * or an attempt, this record is *not* immutable: it starts at `status: "running"` when the
 * run begins and is republished at `status: "finalized"` once every attempt has landed.
 * This mutability is safe because exactly one process -- the run's own coordinator/
 * finalizer -- ever calls this function for a given `runId`; workers publish attempts
 * (via `publishAttempt`), never `run.json` itself, so there is no concurrent-writer race
 * on this file to guard against. Each call is still a single-file atomic write
 * (`writeFileAtomic`), so a reader never observes a torn `run.json`.
 */
export function publishRunRecord(root: string, record: RunRecord): void {
  const validated = runRecordSchema.parse(record);
  writeFileAtomic(runRecordPath(root, validated.runId), `${JSON.stringify(validated, null, 2)}\n`);
}

/** Publishes the initial `status: "running"` run record right after `freezeRunPlan`. */
export function startRunRecord(root: string, plan: RunPlan, createdAt: string): RunRecord {
  const record = runRecordSchema.parse({
    formatVersion: RUN_FORMAT_VERSION,
    kind: "framelia.run",
    runId: plan.runId,
    planDigest: canonicalJsonDigest(runPlanSchema.parse(plan)),
    status: "running",
    createdAt,
    cases: plan.selectedCases.map((entry) => ({ caseId: entry.caseId, attemptIds: [] })),
  });
  publishRunRecord(root, record);
  return record;
}

/**
 * Selects which of a case's (possibly several, retried) attempts is authoritative,
 * following the project's own `retryAcceptance` policy (already resolved and included in
 * every case plan's `policyDigest` -- see project-policy.ts's `RetryAcceptancePolicy`):
 *
 * - `"require-first-attempt"`: only the very first attempt (`retryIndex` 0) counts; a
 *   later retry can never rescue a case that failed on its first try.
 * - `"allow-passed-after-retry"`: the highest-`retryIndex` attempt that passed, if any;
 *   otherwise the highest-`retryIndex` attempt overall (so a case that never passed still
 *   has a definitive "final" attempt representing its ultimate outcome).
 */
function selectFinalAttempt(
  attempts: readonly AttemptRecord[],
  policy: RetryAcceptancePolicy,
): string | undefined {
  if (attempts.length === 0) return undefined;
  const byRetry = [...attempts].toSorted((a, b) => a.retryIndex - b.retryIndex);
  if (policy === "require-first-attempt") return byRetry[0]?.attemptId;
  const passed = byRetry.filter((attempt) => attempt.visualVerdict === "passed");
  return (passed.at(-1) ?? byRetry.at(-1))?.attemptId;
}

/**
 * Authoritative finalization: recomputes every selected case's `attemptIds` (and its
 * `selectedAttemptId`, per `retryAcceptance`) by scanning each case's own attempts
 * directory on disk, rather than trusting an incrementally-mutated in-memory list --
 * this is what lets multiple workers publish attempts for the same run concurrently
 * without any of them needing to touch `run.json` themselves or coordinate through a
 * shared, lockable list. `child exit alone is not successful finalization`: only this
 * call, republishing `run.json` with `status: "finalized"`, counts -- a crashed or
 * killed coordinator that never reaches this call leaves `run.json` at `"running"`
 * forever, correctly signaling "never authoritatively finalized" to any reader.
 */
export function finalizeRunRecord(
  root: string,
  runId: string,
  options: { retryAcceptance: RetryAcceptancePolicy; now?: () => Date },
): RunRecord {
  const plan = readRunPlan(root, runId);
  const previous = fs.existsSync(runRecordPath(root, runId))
    ? readRunRecord(root, runId)
    : undefined;
  const now = options.now?.() ?? new Date();

  const cases: RunRecord["cases"] = plan.selectedCases.map((selected) => {
    const dir = attemptsDir(root, runId, selected.caseId);
    const attempts: AttemptRecord[] = [];
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const attemptPath = path.join(dir, entry.name, ATTEMPT_RECORD_FILE_NAME);
        if (!fs.existsSync(attemptPath)) continue;
        attempts.push(
          parseJsonFile(
            attemptPath,
            attemptRecordSchema,
            "RUN_BUNDLE_INVALID",
            `attempt bundle at ${attemptPath}`,
          ),
        );
      }
    }
    const selectedAttemptId = selectFinalAttempt(attempts, options.retryAcceptance);
    return {
      caseId: selected.caseId,
      attemptIds: attempts.map((attempt) => attempt.attemptId),
      ...(selectedAttemptId ? { selectedAttemptId } : {}),
    };
  });

  const record = runRecordSchema.parse({
    formatVersion: RUN_FORMAT_VERSION,
    kind: "framelia.run",
    runId,
    planDigest: canonicalJsonDigest(plan),
    status: "finalized",
    createdAt: previous?.createdAt ?? now.toISOString(),
    finalizedAt: now.toISOString(),
    cases,
  });
  publishRunRecord(root, record);
  return record;
}

/** Reads the run's current coordination record (`run.json`), whatever its `status`. */
export function readRunRecord(root: string, runId: string): RunRecord {
  const filePath = runRecordPath(root, runId);
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "RUN_BUNDLE_MISSING",
      `No run record for run "${runId}" at ${filePath}. startRunRecord() must run before this call.`,
    );
  }
  return parseJsonFile(
    filePath,
    runRecordSchema,
    "RUN_BUNDLE_INVALID",
    `run record for run "${runId}"`,
  );
}

function parseJsonFile<T>(
  filePath: string,
  schema: { parse: (input: unknown) => T },
  errorCode: "RUN_BUNDLE_INVALID",
  label: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AppError(
      errorCode,
      `${label} at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  try {
    return schema.parse(parsed);
  } catch (error) {
    throw new AppError(
      errorCode,
      `${label} at ${filePath} failed schema validation: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}
