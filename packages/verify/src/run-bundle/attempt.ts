import * as path from "node:path";

import { attemptRecordSchema, type AttemptRecord } from "@framelia/contracts/workflow";

import { sha256Hex } from "../hash.ts";
import { AppError } from "../types.ts";
import {
  ATTEMPT_EVIDENCE_FILE,
  ATTEMPT_RECORD_FILE_NAME,
  attemptDir,
  toProjectRelative,
} from "./layout.ts";
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
