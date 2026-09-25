import {
  runProjectionSchema,
  type NextOperation,
  type RunProjection,
} from "@framelia/contracts/workflow";
import {
  readSelectedRun,
  runDir,
  toProjectRelative,
  type SelectedRun,
} from "@framelia/verify/run-bundle";

export type { RunProjection } from "@framelia/contracts/workflow";

function projectSelectedRun(root: string, selected: SelectedRun): RunProjection {
  return runProjectionSchema.parse({
    runId: selected.runId,
    bundlePath: toProjectRelative(root, runDir(root, selected.runId)),
    selection: {
      mode: selected.coverage.selectionMode,
      availableCaseIds: selected.coverage.availableCaseIds,
      requiredCaseIds: selected.coverage.requiredCaseIds,
      selectedCaseIds: selected.coverage.selectedCaseIds,
      selectedCount: selected.coverage.selectedCaseIds.length,
      fullRequiredCount: selected.coverage.requiredCaseIds.length,
    },
    executionState: selected.executionState,
    visualVerdict: selected.visualVerdict,
    cases: selected.cases.map((selectedCase) => ({
      caseId: selectedCase.caseId,
      contractId: selectedCase.plan.contract.id,
      project: selectedCase.plan.project.name,
      repeatIndex: selectedCase.plan.repeatIndex,
      ...(selectedCase.selectedAttemptId
        ? { chosenAttemptId: selectedCase.selectedAttemptId }
        : {}),
      attempts: selectedCase.attempts.map((attempt) => ({
        attemptId: attempt.record.attemptId,
        retryIndex: attempt.record.retryIndex,
        chosen: attempt.record.attemptId === selectedCase.selectedAttemptId,
        executionState: attempt.record.executionState,
        visualVerdict: attempt.record.visualVerdict,
        diagnostics: [...attempt.record.diagnostics, ...attempt.integrityIssues],
        evidence: {
          expected: {
            availability: attempt.evidence.expected.availability,
            ...(attempt.evidence.expected.portablePath
              ? { path: attempt.evidence.expected.portablePath }
              : {}),
            ...(attempt.evidence.expected.digest
              ? { digest: attempt.evidence.expected.digest }
              : {}),
            ...(attempt.evidence.expected.message
              ? { message: attempt.evidence.expected.message }
              : {}),
          },
          actual: {
            availability: attempt.evidence.actual.availability,
            ...(attempt.evidence.actual.portablePath
              ? { path: attempt.evidence.actual.portablePath }
              : {}),
            ...(attempt.evidence.actual.digest ? { digest: attempt.evidence.actual.digest } : {}),
            ...(attempt.evidence.actual.message
              ? { message: attempt.evidence.actual.message }
              : {}),
          },
          diff: {
            availability: attempt.evidence.diff.availability,
            ...(attempt.evidence.diff.portablePath
              ? { path: attempt.evidence.diff.portablePath }
              : {}),
            ...(attempt.evidence.diff.digest ? { digest: attempt.evidence.diff.digest } : {}),
            ...(attempt.evidence.diff.message ? { message: attempt.evidence.diff.message } : {}),
          },
          score: {
            availability: attempt.evidence.score.availability,
            ...(attempt.evidence.score.portablePath
              ? { path: attempt.evidence.score.portablePath }
              : {}),
            ...(attempt.evidence.score.digest ? { digest: attempt.evidence.score.digest } : {}),
            ...(attempt.evidence.score.message ? { message: attempt.evidence.score.message } : {}),
          },
        },
      })),
      missingAttemptIds: selectedCase.missingAttemptIds,
      diagnostics: selectedCase.invalidAttempts.flatMap((entry) => entry.issues),
    })),
    diagnostics: selected.integrityIssues,
  });
}

/** Reads and projects exactly one explicit durable run; it never scans for a latest run. */
export function readRunProjection(root: string, runId: string): RunProjection {
  return projectSelectedRun(root, readSelectedRun(root, runId));
}

export function nextForRun(projection: RunProjection, projectRoot?: string): NextOperation {
  if (projection.executionState === "completed" && projection.visualVerdict === "mismatched") {
    return {
      command: "framelia",
      argv: [
        "open",
        "--run",
        projection.runId,
        ...(projectRoot ? ["--project-root", projectRoot] : []),
      ],
    };
  }
  if (projection.selection.mode === "all") {
    return {
      command: "framelia",
      argv: ["check", "--all", ...(projectRoot ? ["--project-root", projectRoot] : [])],
    };
  }
  const contracts = [...new Set(projection.cases.map((entry) => entry.contractId))];
  const projects = [...new Set(projection.cases.map((entry) => entry.project))];
  return {
    command: "framelia",
    argv: [
      "check",
      ...contracts.flatMap((contract) => ["--contract", contract]),
      ...projects.flatMap((project) => ["--project", project]),
      ...(projectRoot ? ["--project-root", projectRoot] : []),
    ],
  };
}
