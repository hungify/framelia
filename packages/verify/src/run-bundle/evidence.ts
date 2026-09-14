import * as fs from "node:fs";
import * as path from "node:path";

import type { AttemptRecord } from "@framelia/contracts/workflow";

import { fileHash } from "../hash.ts";
import { AppError } from "../types.ts";

/**
 * Recomputes and cross-checks every evidence file an `AttemptRecord` references against
 * its recorded digest, resolving each `evidence.*.path` as `path.join(root, ...)` -- never
 * an absolute path stashed on the record itself, so this works identically against a
 * bundle copied to a fresh root. Shared by `readRunBundle` (read-time validation) and
 * `finalizeRunRecord` (so a tampered/deleted evidence file can never become an
 * authoritative `selectedAttemptId` -- see finalizeRunRecord's own doc comment).
 */
export function validateAttemptEvidence(root: string, attempt: AttemptRecord): void {
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
