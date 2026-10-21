import type { DashboardAttempt, DashboardContractResult } from "@framelia/contracts";

/** The attempt a contract's own baseline/actual/diff fields describe. */
export function isDefaultAttempt(contract: DashboardContractResult, attempt: DashboardAttempt) {
  return contract.selectedAttemptId
    ? attempt.attemptId === contract.selectedAttemptId
    : attempt.selected;
}

/** The non-default attempt being inspected, if `attemptId` names one. */
export function inspectedAttempt(
  contract: DashboardContractResult,
  attemptId: string | undefined,
): DashboardAttempt | undefined {
  if (!attemptId) return undefined;
  const attempt = contract.attempts?.find((candidate) => candidate.attemptId === attemptId);
  return attempt && !isDefaultAttempt(contract, attempt) ? attempt : undefined;
}

function image(attempt: DashboardAttempt, kind: "expected" | "actual" | "diff") {
  const evidence = attempt.evidence[kind];
  if (evidence.availability !== "available" || !evidence.path) return undefined;
  return { path: evidence.path, ...(evidence.digest ? { hash: evidence.digest } : {}) };
}

/**
 * The contract as the inspector should show it for one attempt: the selected attempt is
 * the contract itself; any other (an earlier retry) swaps in that attempt's own
 * expected/actual/diff evidence (sizes come from the images), and its unavailable
 * evidence becomes the "why is this empty" message.
 */
export function contractForAttempt(
  contract: DashboardContractResult,
  attemptId: string | undefined,
): DashboardContractResult {
  const attempt = inspectedAttempt(contract, attemptId);
  if (!attempt) return contract;
  const baseline = image(attempt, "expected");
  const actual = image(attempt, "actual");
  const diff = image(attempt, "diff");
  const { baseline: _baseline, actual: _actual, diff: _diff, ...rest } = contract;
  return {
    ...rest,
    ...(baseline
      ? {
          baseline: { ...baseline, provenance: contract.baseline?.provenance ?? attempt.attemptId },
        }
      : {}),
    ...(actual ? { actual: { ...actual, url: contract.actual?.url ?? "" } } : {}),
    ...(diff ? { diff } : {}),
    blockers: (["expected", "actual"] as const)
      .filter((kind) => attempt.evidence[kind].availability !== "available")
      .map((kind) => ({
        code: `ATTEMPT_${kind.toUpperCase()}_${attempt.evidence[kind].availability.toUpperCase()}`,
        message:
          attempt.evidence[kind].message ??
          `${attempt.attemptId}: ${kind} evidence is ${attempt.evidence[kind].availability}.`,
      })),
  };
}
