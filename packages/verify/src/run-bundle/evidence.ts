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
 *
 * Also reapplies `publishAttempt`'s own "a visual pass always has an actual capture"
 * invariant -- `publishAttempt` only enforces it at publish time; a later hand-edit of
 * `attempt.json` that drops `evidence.actual` while keeping `visualVerdict: "passed"`
 * would otherwise sail through this function's own file-level checks (which only
 * validate references that are actually present, not that a required one exists).
 */
export function validateAttemptEvidence(root: string, attempt: AttemptRecord): void {
  if (attempt.visualVerdict === "passed" && !attempt.evidence.actual) {
    throw new AppError(
      "RUN_BUNDLE_INVALID",
      `Attempt "${attempt.attemptId}" claims visualVerdict "passed" but its record carries no actual-capture evidence reference.`,
    );
  }
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
