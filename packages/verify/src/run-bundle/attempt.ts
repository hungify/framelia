import * as fs from "node:fs";
import * as path from "node:path";

import { attemptRecordSchema, type AttemptRecord } from "@framelia/contracts/workflow";

import { sha256Hex } from "../hash.ts";
import { AppError } from "../types.ts";
import {
  ATTEMPT_EVIDENCE_FILE,
  ATTEMPT_RECORD_FILE_NAME,
  attemptDir,
  runRecordPath,
  toProjectRelative,
} from "./layout.ts";
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
 * Also rejects publishing once the run's own coordination record already reads
 * `status: "finalized"` -- finalization is meant to seal a run's authoritative
 * membership, so a late worker publishing after that point is refused rather than
 * silently accepted and never reflected in the sealed `RunRecord`. This check-then-act
 * is a best-effort guard, not a full lock: a publish whose staging/rename was already
 * in flight when finalization ran can still land a moment after the check passes.
 * Closing that narrow race completely would need a real cross-process lock around the
 * run's own attempts directory, which this module does not implement.
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
): AttemptRecord {
  const plan = readRunPlan(root, runId);
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
  if (
    fs.existsSync(runRecordPath(root, runId)) &&
    readRunRecord(root, runId).status === "finalized"
  ) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Run "${runId}" is already finalized; attempt "${attempt.attemptId}" cannot be published after finalization sealed the run's membership.`,
    );
  }

  const targetDir = attemptDir(root, runId, attempt.caseId, attempt.attemptId);
  const evidence: NonNullable<AttemptRecord["evidence"]> = {};
  const staged: StagedFile[] = [];

  for (const key of Object.keys(ATTEMPT_EVIDENCE_FILE) as (keyof typeof ATTEMPT_EVIDENCE_FILE)[]) {
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
  if (record.visualVerdict === "passed" && !record.evidence.actual) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Attempt ${record.attemptId} claims visualVerdict "passed" but publishes no actual-capture evidence; refusing to publish a pass with no capture behind it.`,
    );
  }

  staged.push({
    relativePath: ATTEMPT_RECORD_FILE_NAME,
    content: `${JSON.stringify(record, null, 2)}\n`,
  });
  publishBundleUnit(targetDir, staged);
  return record;
}
