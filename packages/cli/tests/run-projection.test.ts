import { describe, expect, it } from "vitest";

import { nextForRun, type RunProjection } from "../src/internal/run-projection.ts";

function projection(
  mode: "all" | "subset",
  cases: Array<{ contractId: string; project: string }>,
): RunProjection {
  const caseIds = cases.map(
    ({ contractId, project }, index) => `${contractId}::${project}::${index}`,
  );
  return {
    runId: "run-next-action",
    bundlePath: ".framelia/runs/run-next-action",
    selection: {
      mode,
      availableCaseIds: caseIds,
      requiredCaseIds: caseIds,
      selectedCaseIds: caseIds,
      selectedCount: caseIds.length,
      fullRequiredCount: caseIds.length,
    },
    executionState: "incomplete",
    visualVerdict: "not-evaluated",
    cases: cases.map(({ contractId, project }, index) => ({
      caseId: caseIds[index]!,
      contractId,
      project,
      repeatIndex: 0,
      attempts: [],
      missingAttemptIds: [],
      diagnostics: [],
    })),
    diagnostics: [],
  };
}

describe("nextForRun", () => {
  it("re-runs full coverage with --all and no project narrowing", () => {
    const next = nextForRun(
      projection("all", [
        { contractId: "account.desktop", project: "chromium" },
        { contractId: "account.mobile", project: "webkit" },
      ]),
      "/repo",
    );

    expect(next).toEqual({
      command: "framelia",
      argv: ["check", "--all", "--project-root", "/repo"],
    });
    expect(next.argv).not.toContain("--project");
  });

  it("replays a subset with its exact unique contracts and projects", () => {
    const next = nextForRun(
      projection("subset", [
        { contractId: "account.desktop", project: "chromium" },
        { contractId: "account.desktop", project: "webkit" },
        { contractId: "account.mobile", project: "webkit" },
      ]),
    );

    expect(next).toEqual({
      command: "framelia",
      argv: [
        "check",
        "--contract",
        "account.desktop",
        "--contract",
        "account.mobile",
        "--project",
        "chromium",
        "--project",
        "webkit",
      ],
    });
  });
});
