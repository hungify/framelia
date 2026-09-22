import * as fs from "node:fs";
import * as path from "node:path";

import {
  attemptRecordSchema,
  attemptScoreSchema,
  isTerminalRunStatus,
  type AttemptRecord,
} from "@framelia/contracts/workflow";

import { sha256Hex } from "../hash.ts";
import { AppError } from "../types.ts";
import {
  ATTEMPT_EVIDENCE_FILE,
  ATTEMPT_RECORD_FILE_NAME,
  attemptDir,
  runRecordPath,
  toProjectRelative,
} from "./layout.ts";
import { withRunLock } from "./lock.ts";
import { readRunPlan, readRunRecord } from "./run.ts";
import { publishBundleUnit, type StagedFile } from "./staged-write.ts";

export interface AttemptEvidenceFiles {
  expected?: Buffer;
  actual?: Buffer;
  diff?: Buffer;
  score?: Buffer;
}

/**
 * Publishes one attempt's evidence + its own `attemptRecordSchema`-validated JSON as a
 * single immutable bundle unit under `.framelia/runs/<runId>/cases/<caseId>/attempts/<attemptId>/`.
 * Evidence digests are computed here (from the actual bytes about to be staged), not
 * trusted from the caller, so `record.evidence` can never disagree with what's really on
 * disk. Rejects (via `publishBundleUnit`) if `attempt.attemptId` already has a published
 * bundle for this case -- attempts are immutable once published; a retry or a second
 * concurrent writer for the same identity never overwrites or merges.
 *
 * `attempt.caseId`/`attempt.casePlanDigest` are cross-checked against the run's own
 * frozen `RunPlan` (`readRunPlan`) -- a caseId the plan never selected, or a
 * `casePlanDigest` that disagrees with what was frozen for it, is rejected outright,
 * rather than silently accepted and only ever discovered later by `readRunBundle`.
 *
 * Also rejects publishing once the run's own coordination record has any terminal
 * status (`finalized`, `incomplete`, or `error`). Finalization seals authoritative
 * membership even when diagnostics prevented a clean final verdict, so a late worker
 * cannot add evidence absent from the sealed `RunRecord`. The whole function body
 * (this check included) runs inside `withRunLock`, the same lock `finalizeRunRecord`
 * takes for its own attempts-directory scan + publish -- so this check is never racing
 * finalization's own scan: whichever of the two acquires the lock first runs to
 * completion before the other starts, closing the check-then-act window a bare status
 * check alone would leave open.
 *
 * `attempt` omits `evidence`: this function is the sole author of that field, derived
 * from `files`. Passing a `visualVerdict: "passed"` attempt with no `actual` capture is
 * refused outright -- a real, completed comparison always produces an actual-capture
 * image; a claimed pass with nothing behind it is exactly the "reuse an old image"/silent
 * fabrication failure mode #77's acceptance criteria rule out.
 */
export function publishAttempt(
  root: string,
  runId: string,
  attempt: Omit<AttemptRecord, "evidence">,
  files: AttemptEvidenceFiles = {},
): Promise<AttemptRecord> {
  return withRunLock(root, runId, () => {
    const plan = readRunPlan(root, runId);
    if (attempt.runId !== runId) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Attempt "${attempt.attemptId}" belongs to run "${attempt.runId}", not run "${runId}".`,
      );
    }
    const selected = plan.selectedCases.find((entry) => entry.caseId === attempt.caseId);
    if (!selected) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Attempt "${attempt.attemptId}" references case "${attempt.caseId}", which is not part of run "${runId}"'s selected cases in its frozen plan.`,
      );
    }
    if (selected.casePlanDigest !== attempt.casePlanDigest) {
      throw new AppError(
        "RUN_BUNDLE_DIGEST_MISMATCH",
        `Attempt "${attempt.attemptId}"'s casePlanDigest (${attempt.casePlanDigest}) does not match run "${runId}"'s frozen plan digest for case "${attempt.caseId}" (${selected.casePlanDigest}).`,
      );
    }
    const existingRecord = fs.existsSync(runRecordPath(root, runId))
      ? readRunRecord(root, runId)
      : undefined;
    if (existingRecord && isTerminalRunStatus(existingRecord.status)) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Run "${runId}" is already terminal (${existingRecord.status}); attempt "${attempt.attemptId}" cannot be published after finalization sealed the run's membership.`,
      );
    }

    // Test-only seam: widens the window between the terminal-status check above and the
    // publish below, so a test can force real, deterministic lock contention against a
    // concurrent `finalizeRunRecord` call (see lock.test.ts) -- inert unless a test sets
    // this env var. Never set outside tests.
    const testHoldMs = Number(process.env.FRAMELIA_TEST_ATTEMPT_HOLD_MS ?? "0");
    if (testHoldMs > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, testHoldMs);
    }

    const targetDir = attemptDir(root, runId, attempt.caseId, attempt.attemptId);
    const evidence: NonNullable<AttemptRecord["evidence"]> = {};
    const staged: StagedFile[] = [];

    for (const key of Object.keys(
      ATTEMPT_EVIDENCE_FILE,
    ) as (keyof typeof ATTEMPT_EVIDENCE_FILE)[]) {
      const buffer = files[key];
      if (!buffer) continue;
      const fileName = ATTEMPT_EVIDENCE_FILE[key];
      evidence[key] = {
        path: toProjectRelative(root, path.join(targetDir, fileName)),
        digest: `sha256:${sha256Hex(buffer)}`,
      };
      staged.push({ relativePath: fileName, content: buffer });
    }

    const record = attemptRecordSchema.parse({ ...attempt, evidence });
    if (record.executionState === "completed" && record.visualVerdict !== "not-evaluated") {
      for (const required of ["expected", "actual", "score"] as const) {
        if (!record.evidence[required]) {
          throw new AppError(
            "RUN_BUNDLE_INVALID",
            `Attempt ${record.attemptId} is completed/evaluated but publishes no ${required} evidence.`,
          );
        }
      }
      try {
        attemptScoreSchema.parse(JSON.parse(files.score!.toString("utf8")));
      } catch (error) {
        throw new AppError(
          "RUN_BUNDLE_INVALID",
          `Attempt ${record.attemptId} score evidence is not a valid versioned score: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
    }

    staged.push({
      relativePath: ATTEMPT_RECORD_FILE_NAME,
      content: `${JSON.stringify(record, null, 2)}\n`,
    });
    publishBundleUnit(targetDir, staged);
    return record;
  });
}
