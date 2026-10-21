import * as path from "node:path";

import { sha256Hex } from "../hash.ts";

/**
 * On-disk layout for a run bundle, rooted at `.framelia/runs/<runId>/`:
 *
 * ```
 * .framelia/runs/<runId>/
 *   plan/                          <- published once via publishBundleUnit; immutable
 *     plan.json                    <- RunPlan
 *     case-plans/<caseSlug>.json   <- full CasePlan records (RunPlan only carries digests)
 *   run.json                       <- RunRecord; single-writer (the run's one coordinator/
 *                                      finalizer), mutates status "running" -> "finalized"
 *   cases/<caseSlug>/attempts/<attemptSlug>/
 *     attempt.json                 <- AttemptRecord
 *     expected.png / actual.png / diff.png / score.json (whichever evidence was captured)
 *   shards/<current>-of-<total>/   <- sharded direct runs only (see sharded-run.ts)
 *     plan/fragment.json           <- RunPlanFragment; published once by that shard's onBegin
 *     completion/completion.json   <- ShardCompletion; published once by that shard's onEnd
 * ```
 *
 * A sharded run has no `plan/` or `run.json` until every shard completed: the run's plan is
 * then composed from the fragments and the run finalized once. Shard files are keyed by shard
 * and attempts by case, so per-shard copies of one run directory merge without collisions.
 *
 * Every path recorded *inside* a JSON record (case-plan/attempt evidence pointers) is
 * project-root-relative (see @framelia/contracts's `projectRelativePathSchema`), matching
 * every other portable path convention already used across the schema (contractFile,
 * baseline snapshot paths, etc.) -- never an absolute path tied to the writer's own
 * checkout. A reader only needs the project root a copied `.framelia/runs/<runId>` subtree
 * was placed under, never the original writer's filesystem layout.
 *
 * `runId`/`caseId`/`attemptId` are free-form identifiers (see workflow-records.ts's
 * `nonEmptyTrimmed` schemas) and are not necessarily filesystem-safe on their own -- two
 * distinct ids could sanitize to the same string, or contain characters an OS path
 * disallows. `slug()` derives a filesystem-safe, collision-resistant directory name from
 * an arbitrary id: a human-readable sanitized prefix (for `ls`-ability) plus a content
 * hash suffix (so two different ids can never collide on the same directory name). The
 * raw id always stays recoverable from the record's own JSON content; the slug is purely
 * a directory-naming device.
 */
export function slug(id: string): string {
  const sanitized = id.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const digest = sha256Hex(id).slice(0, 12);
  return sanitized ? `${sanitized}-${digest}` : digest;
}

export const RUN_BUNDLE_DIR_SEGMENTS = [".framelia", "runs"] as const;
export const PLAN_DIR_NAME = "plan";
export const RUN_PLAN_FILE_NAME = "plan.json";
export const CASE_PLANS_DIR_NAME = "case-plans";
export const RUN_RECORD_FILE_NAME = "run.json";
export const CASES_DIR_NAME = "cases";
export const ATTEMPTS_DIR_NAME = "attempts";
export const ATTEMPT_RECORD_FILE_NAME = "attempt.json";
export const SHARDS_DIR_NAME = "shards";
export const PLAN_FRAGMENT_FILE_NAME = "fragment.json";
export const SHARD_COMPLETION_FILE_NAME = "completion.json";

/** Evidence file names within one attempt's own directory. */
export const ATTEMPT_EVIDENCE_FILE = {
  expected: "expected.png",
  actual: "actual.png",
  diff: "diff.png",
  score: "score.json",
} as const;

export function runDir(root: string, runId: string): string {
  return path.join(root, ...RUN_BUNDLE_DIR_SEGMENTS, slug(runId));
}

export function planDir(root: string, runId: string): string {
  return path.join(runDir(root, runId), PLAN_DIR_NAME);
}

export function runPlanPath(root: string, runId: string): string {
  return path.join(planDir(root, runId), RUN_PLAN_FILE_NAME);
}

export function casePlansDir(root: string, runId: string): string {
  return path.join(planDir(root, runId), CASE_PLANS_DIR_NAME);
}

export function casePlanPath(root: string, runId: string, caseId: string): string {
  return path.join(casePlansDir(root, runId), `${slug(caseId)}.json`);
}

export function runRecordPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), RUN_RECORD_FILE_NAME);
}

export function caseDir(root: string, runId: string, caseId: string): string {
  return path.join(runDir(root, runId), CASES_DIR_NAME, slug(caseId));
}

export function attemptsDir(root: string, runId: string, caseId: string): string {
  return path.join(caseDir(root, runId, caseId), ATTEMPTS_DIR_NAME);
}

export function attemptDir(root: string, runId: string, caseId: string, attemptId: string): string {
  return path.join(attemptsDir(root, runId, caseId), slug(attemptId));
}

export function shardsDir(root: string, runId: string): string {
  return path.join(runDir(root, runId), SHARDS_DIR_NAME);
}

/** One shard's own directory name: Playwright's one-based `--shard=current/total`. */
export function shardDirName(shard: { current: number; total: number }): string {
  return `${shard.current}-of-${shard.total}`;
}

export function shardDir(
  root: string,
  runId: string,
  shard: { current: number; total: number },
): string {
  return path.join(shardsDir(root, runId), shardDirName(shard));
}

export function planFragmentDir(
  root: string,
  runId: string,
  shard: { current: number; total: number },
): string {
  return path.join(shardDir(root, runId, shard), PLAN_DIR_NAME);
}

export function planFragmentPath(
  root: string,
  runId: string,
  shard: { current: number; total: number },
): string {
  return path.join(planFragmentDir(root, runId, shard), PLAN_FRAGMENT_FILE_NAME);
}

export function shardCompletionDir(
  root: string,
  runId: string,
  shard: { current: number; total: number },
): string {
  return path.join(shardDir(root, runId, shard), "completion");
}

export function shardCompletionPath(
  root: string,
  runId: string,
  shard: { current: number; total: number },
): string {
  return path.join(shardCompletionDir(root, runId, shard), SHARD_COMPLETION_FILE_NAME);
}

/** Portable, forward-slash, project-root-relative path for a file already inside the bundle. */
export function toProjectRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

/** Stable case identity: contract + project + repeat slot (see #77's contract text). Retries
 *  of the same case share this `caseId` and are distinguished by `attemptId`/`retryIndex`. */
export interface CaseIdentity {
  contractId: string;
  projectName: string;
  repeatIndex: number;
}

export function computeCaseId(identity: CaseIdentity): string {
  return `${identity.contractId}@${identity.projectName}#${identity.repeatIndex}`;
}

/** Deterministic per-retry attempt identity: same case, distinct retry -> distinct, stable id. */
export function computeAttemptId(caseId: string, retryIndex: number): string {
  return `${caseId}::attempt-${retryIndex}`;
}
