/**
 * Immutable run/case/attempt bundle publication and the one selected-run consumer seam.
 * Readers always select one explicit run ID; no recursive survivor aggregation exists.
 */
export { publishAttempt } from "./attempt.ts";
export type { AttemptEvidenceFiles } from "./attempt.ts";
export { readCasePlans } from "./case-plans.ts";
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
export { reconcileCasePlan } from "./reconcile.ts";
export type { CasePlanReconciliation } from "./reconcile.ts";
export { readRunBundle } from "./read.ts";
export type { RunBundle } from "./read.ts";
export { evaluateAuthoritativeRun, readSelectedRun } from "./selected-run.ts";
export type {
  AuthoritativeCaseVerdict,
  AuthoritativeRunIssue,
  AuthoritativeRunVerdict,
  EvidenceAvailability,
  SelectedAttempt,
  SelectedCase,
  SelectedEvidence,
  SelectedRun,
} from "./selected-run.ts";
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
