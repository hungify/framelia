/**
 * Immutable run/case/attempt bundle publication (framelia/#77, WP4). Adds a new, parallel
 * publication path alongside the existing `VerificationArtifact`/`writeVerificationArtifact`
 * pipeline (verify.ts, untouched) -- this module owns nothing the dashboard/gate reads
 * today; see @framelia/playwright's Reporter for how it's wired into a real Playwright run.
 */
export { publishAttempt } from "./attempt.ts";
export type { AttemptEvidenceFiles } from "./attempt.ts";
export {
  ATTEMPT_EVIDENCE_FILE,
  attemptDir,
  attemptsDir,
  caseDir,
  casePlanPath,
  casePlansDir,
  computeAttemptId,
  computeCaseId,
  planDir,
  runDir,
  runPlanPath,
  runRecordPath,
  slug,
  toProjectRelative,
} from "./layout.ts";
export type { CaseIdentity } from "./layout.ts";
export { readRunBundle } from "./read.ts";
export type { RunBundle } from "./read.ts";
export {
  finalizeRunRecord,
  freezeRunPlan,
  publishRunRecord,
  readRunPlan,
  readRunRecord,
  startRunRecord,
} from "./run.ts";
export { publishBundleUnit } from "./staged-write.ts";
export type { StagedFile } from "./staged-write.ts";
