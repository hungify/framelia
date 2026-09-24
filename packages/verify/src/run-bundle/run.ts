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
  type Diagnostic,
  type RunPlan,
  type RunRecord,
} from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";
import { writeFileAtomic } from "../fs-atomic.ts";
import { portableErrorMessage } from "../portable.ts";
import type { RetryAcceptancePolicy } from "../project-policy.ts";
import { AppError } from "../types.ts";
import { readCasePlans } from "./case-plans.ts";
import { validateAttemptEvidence } from "./evidence.ts";
import {
  ATTEMPT_RECORD_FILE_NAME,
  attemptsDir,
  planDir,
  runPlanPath,
  runRecordPath,
  slug,
} from "./layout.ts";
import { withRunLock } from "./lock.ts";
import { reconcileCasePlan } from "./reconcile.ts";
import { publishBundleUnit, type StagedFile } from "./staged-write.ts";

/**
 * Freezes a run's required/selected membership and every collected case's own plan
 * before any execution happens, as one immutable bundle unit -- `plan.json` plus every
 * `case-plans/<caseId>.json` land together, or not at all. Throws `RUN_BUNDLE_ALREADY_PUBLISHED`
 * if this `plan.runId` was already frozen (a run plan never changes mid-run).
 *
 * `casePlans` must supply exactly one record per `plan.availableCases` entry -- no
 * duplicates, no case missing a plan, and no plan for a case the run plan never listed
 * -- and every supplied record's own recomputed digest must match the digest recorded
 * for it in `plan.availableCases`. Without this, a caller could freeze a `RunPlan` whose
 * `availableCases` promises a case's plan exists while never actually publishing that
 * plan record, silently deferring the failure to a much later `readRunBundle()` call.
 */
export function freezeRunPlan(root: string, plan: RunPlan, casePlans: readonly CasePlan[]): void {
  const validatedPlan = runPlanSchema.parse(plan);
  const availableDigests = new Map(
    validatedPlan.availableCases.map((entry) => [entry.caseId, entry.casePlanDigest]),
  );

  const seenCaseIds = new Set<string>();
  const files: StagedFile[] = casePlans.map((casePlan) => {
    const validated = casePlanSchema.parse(casePlan);
    if (validated.runId !== validatedPlan.runId) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan "${validated.caseId}" belongs to run "${validated.runId}", not run "${validatedPlan.runId}".`,
      );
    }
    if (seenCaseIds.has(validated.caseId)) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Duplicate case plan supplied for case "${validated.caseId}".`,
      );
    }
    seenCaseIds.add(validated.caseId);
    const expected = availableDigests.get(validated.caseId);
    if (expected === undefined) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan "${validated.caseId}" was supplied but is not listed in the run plan's availableCases.`,
      );
    }
    const digest = canonicalJsonDigest(validated);
    if (expected !== digest) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan ${validated.caseId} recomputes to digest ${digest}, which does not match its entry in the run plan's availableCases (${expected}).`,
      );
    }
    return {
      relativePath: `case-plans/${slug(validated.caseId)}.json`,
      content: `${JSON.stringify(validated, null, 2)}\n`,
    };
  });

  const missingCaseIds = [...availableDigests.keys()].filter((caseId) => !seenCaseIds.has(caseId));
  if (missingCaseIds.length > 0) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Run plan's availableCases lists case(s) with no supplied case-plan record: ${missingCaseIds.join(", ")}.`,
    );
  }

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
 * or an attempt, this record is *not* immutable while work is active: it starts at
 * `status: "running"` and is sealed as `finalized`, `incomplete`, or `error` once every
 * attempt publication has settled. This mutability is safe because exactly one process --
 * the run's own coordinator/finalizer -- ever calls this function for a given `runId`;
 * workers publish attempts (via `publishAttempt`), never `run.json` itself, so there is
 * no concurrent-writer race on this file to guard against. Each call is still a
 * single-file atomic write (`writeFileAtomic`), so a reader never observes a torn
 * `run.json`.
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
    diagnostics: [],
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
 * - `"require-first-attempt"`: only the very first attempt (`retryIndex` exactly `0`)
 *   counts, and only if it was actually published -- a later retry can never rescue a
 *   case whose first attempt failed OR was never published at all. This deliberately
 *   does not fall back to whatever the lowest-numbered *published* attempt happens to
 *   be: `attempts` here has already been filtered to evidence-verified attempts (see
 *   `finalizeRunRecord`), so a missing/rejected retry-0 must never let retry-1 stand in
 *   for it.
 * - `"allow-passed-after-retry"`: the highest-`retryIndex` attempt that passed, if any;
 *   otherwise the highest-`retryIndex` attempt overall (so a case that never passed still
 *   has a definitive "final" attempt representing its ultimate outcome).
 */
function selectFinalAttempt(
  attempts: readonly AttemptRecord[],
  policy: RetryAcceptancePolicy,
): string | undefined {
  if (attempts.length === 0) return undefined;
  if (policy === "require-first-attempt") {
    return attempts.find((attempt) => attempt.retryIndex === 0)?.attemptId;
  }
  const byRetry = [...attempts].toSorted((a, b) => a.retryIndex - b.retryIndex);
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
 * call, republishing `run.json` with a sealed terminal status, counts -- a crashed or
 * killed coordinator that never reaches this call leaves `run.json` at `"running"`
 * forever, correctly signaling "never authoritatively finalized" to any reader.
 *
 * Runs its whole body inside `withRunLock` -- the same lock `publishAttempt` takes for
 * its own terminal-status check + publish -- so this scan is never racing a concurrent
 * attempt publication: whichever of the two acquires the lock first runs to completion
 * before the other starts (see lock.ts's own doc comment for why a bare status check
 * alone isn't enough).
 *
 * Also reconciles each selected case's frozen `CasePlan` against current on-disk reality
 * (`reconcileCasePlan`: re-reads the contract file, pinned baseline, project policy, and
 * spec file this case plan was frozen from) -- framelia/#77's own "changed planning
 * inputs invalidate the run even when IDs/commit strings are unchanged" acceptance
 * criterion. A case whose frozen inputs no longer match disk never gets a
 * `selectedAttemptId`, regardless of what its attempts' own `visualVerdict`s were: its
 * `attemptIds` are still recorded (retry history/audit trail preserved, same as the
 * evidence-tamper case above), but nothing about it can read as an authoritative pass.
 */
export async function finalizeRunRecord(
  root: string,
  runId: string,
  options: {
    retryAcceptance: RetryAcceptancePolicy;
    now?: () => Date;
    diagnostics?: readonly Diagnostic[];
    transport?: {
      exitCode: number | null;
      signal: string | null;
      cancelled: boolean;
      reporterCompleted: boolean;
      resultStatus?: "passed" | "failed" | "timedout" | "interrupted";
    };
  },
): Promise<RunRecord> {
  try {
    return await withRunLock(root, runId, async () => {
      const plan = readRunPlan(root, runId);
      if (options.retryAcceptance !== plan.retryAcceptance) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Finalization retry policy "${options.retryAcceptance}" does not match frozen run policy "${plan.retryAcceptance}".`,
        );
      }
      const casePlans = readCasePlans(root, runId);
      const previous = fs.existsSync(runRecordPath(root, runId))
        ? readRunRecord(root, runId)
        : undefined;
      const now = options.now?.() ?? new Date();

      const caseResults = await Promise.all(
        plan.selectedCases.map(async (selected) => {
          const diagnostics: Diagnostic[] = [];
          const dir = attemptsDir(root, runId, selected.caseId);
          const attempts: AttemptRecord[] = [];
          const evidenceVerifiedAttempts: AttemptRecord[] = [];
          if (fs.existsSync(dir)) {
            for (const entry of fs
              .readdirSync(dir, { withFileTypes: true })
              .toSorted((left, right) => left.name.localeCompare(right.name))) {
              if (!entry.isDirectory()) continue;
              const attemptPath = path.join(dir, entry.name, ATTEMPT_RECORD_FILE_NAME);
              if (!fs.existsSync(attemptPath)) {
                diagnostics.push({
                  code: "attempt-publication-partial",
                  stage: "publication",
                  message: `Case "${selected.caseId}" contains partial attempt directory "${entry.name}".`,
                });
                continue;
              }
              let attempt: AttemptRecord;
              try {
                attempt = parseJsonFile(
                  attemptPath,
                  attemptRecordSchema,
                  "RUN_BUNDLE_INVALID",
                  `attempt bundle at ${attemptPath}`,
                );
              } catch (error) {
                diagnostics.push({
                  code: "attempt-record-invalid",
                  stage: "publication",
                  message: portableErrorMessage(error, root),
                });
                continue;
              }
              if (
                attempt.runId !== runId ||
                attempt.caseId !== selected.caseId ||
                attempt.casePlanDigest !== selected.casePlanDigest
              ) {
                diagnostics.push({
                  code: "attempt-identity-invalid",
                  stage: "publication",
                  message: `Attempt "${attempt.attemptId}" does not match run/case/frozen-plan identity.`,
                });
                continue;
              }
              attempts.push(attempt);
              try {
                validateAttemptEvidence(root, attempt);
                evidenceVerifiedAttempts.push(attempt);
              } catch (error) {
                diagnostics.push({
                  code: "attempt-evidence-invalid",
                  stage: "evidence",
                  message: portableErrorMessage(error, root),
                });
              }
            }
          }
          attempts.sort(
            (left, right) =>
              left.retryIndex - right.retryIndex || left.attemptId.localeCompare(right.attemptId),
          );
          evidenceVerifiedAttempts.sort(
            (left, right) =>
              left.retryIndex - right.retryIndex || left.attemptId.localeCompare(right.attemptId),
          );

          const casePlan = casePlans.get(selected.caseId);
          const reconciliation = casePlan
            ? await reconcileCasePlan(root, casePlan)
            : {
                consistent: false,
                reasons: [`case "${selected.caseId}" has no full CasePlan record in the bundle`],
              };
          if (!reconciliation.consistent) {
            diagnostics.push(
              ...reconciliation.reasons.map((message) => ({
                code: "case-plan-reconciliation-failed",
                stage: "reconciliation",
                message,
              })),
            );
          }

          const selectedAttemptId = reconciliation.consistent
            ? selectFinalAttempt(evidenceVerifiedAttempts, options.retryAcceptance)
            : undefined;
          const selectedAttempt = selectedAttemptId
            ? evidenceVerifiedAttempts.find((attempt) => attempt.attemptId === selectedAttemptId)
            : undefined;
          const runnerAttempt = evidenceVerifiedAttempts.at(-1);
          if (options.transport && !selectedAttempt) {
            diagnostics.push({
              code: "selected-attempt-missing",
              stage: "execution",
              message: `Case "${selected.caseId}" has no complete, evidence-verified attempt accepted by the frozen retry policy.`,
            });
          }
          return {
            entry: {
              caseId: selected.caseId,
              attemptIds: attempts.map((attempt) => attempt.attemptId),
              ...(selectedAttemptId ? { selectedAttemptId } : {}),
            },
            diagnostics,
            selectedAttempt,
            runnerAttempt,
          };
        }),
      );
      const transportDiagnostics: Diagnostic[] = [];
      if (options.transport) {
        const runnerAttempts = caseResults
          .map((result) => result.runnerAttempt)
          .filter((attempt): attempt is AttemptRecord => attempt !== undefined);
        const allRunnerCasesComplete =
          runnerAttempts.length === plan.selectedCases.length &&
          runnerAttempts.every((attempt) => attempt.executionState === "completed");
        const runnerVisualVerdict = allRunnerCasesComplete
          ? runnerAttempts.some((attempt) => attempt.visualVerdict === "mismatched")
            ? "mismatched"
            : runnerAttempts.every((attempt) => attempt.visualVerdict === "passed")
              ? "passed"
              : "not-evaluated"
          : "not-evaluated";
        const expectedExitCode =
          runnerVisualVerdict === "mismatched" ? 1 : runnerVisualVerdict === "passed" ? 0 : null;
        const expectedResultStatus =
          runnerVisualVerdict === "mismatched"
            ? "failed"
            : runnerVisualVerdict === "passed"
              ? "passed"
              : undefined;
        if (options.transport.cancelled) {
          transportDiagnostics.push({
            code: "execution-cancelled",
            stage: "execution",
            message: "The test-runner child was cancelled after graceful SIGINT forwarding.",
          });
        }
        if (!options.transport.reporterCompleted) {
          transportDiagnostics.push({
            code: "reporter-lifecycle-incomplete",
            stage: "execution",
            message:
              "The Framelia reporter did not publish a completed execution lifecycle summary.",
          });
        }
        if (
          options.transport.signal !== null ||
          expectedExitCode === null ||
          options.transport.exitCode !== expectedExitCode ||
          (expectedResultStatus !== undefined &&
            options.transport.resultStatus !== expectedResultStatus)
        ) {
          transportDiagnostics.push({
            code: "execution-exit-unexplained",
            stage: "execution",
            message: `Test runner exit ${options.transport.exitCode ?? options.transport.signal ?? "unknown"} / result ${options.transport.resultStatus ?? "missing"} is not explained by the latest complete published visual attempts.`,
          });
        }
      }
      const publicationDiagnostics = [
        ...(options.diagnostics ?? []),
        ...transportDiagnostics,
      ].toSorted(
        (left, right) =>
          left.code.localeCompare(right.code) ||
          left.stage.localeCompare(right.stage) ||
          left.message.localeCompare(right.message),
      );
      const diagnostics = [
        ...publicationDiagnostics,
        ...caseResults.flatMap((result) => result.diagnostics),
      ];
      const status =
        publicationDiagnostics.length > 0
          ? "error"
          : diagnostics.length > 0
            ? "incomplete"
            : "finalized";
      const record = runRecordSchema.parse({
        formatVersion: RUN_FORMAT_VERSION,
        kind: "framelia.run",
        runId,
        planDigest: canonicalJsonDigest(plan),
        status,
        createdAt: previous?.createdAt ?? now.toISOString(),
        finalizedAt: now.toISOString(),
        diagnostics,
        cases: caseResults.map((result) => result.entry),
      });
      publishRunRecord(root, record);
      return record;
    });
  } catch (error) {
    const previous = readRunRecord(root, runId);
    const now = options.now?.() ?? new Date();
    const record = runRecordSchema.parse({
      ...previous,
      status: "error",
      finalizedAt: now.toISOString(),
      diagnostics: [
        ...(options.diagnostics ?? []),
        {
          code: "run-finalization-failed",
          stage: "finalization",
          message: portableErrorMessage(error, root),
        },
      ],
    });
    publishRunRecord(root, record);
    throw error;
  }
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
