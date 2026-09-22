import type { SelectedRun } from "@framelia/verify/run-bundle";
import { describe, expect, it } from "vitest";

import { overallStatus, projectSelectedRun, summarize } from "../src/model.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;

function selectedRunFixture(): SelectedRun {
  const authored = {
    formatVersion: 1 as const,
    kind: "framelia.contract" as const,
    id: "home",
    name: "Home page",
    revision: 1,
    target: { path: "/home" },
    viewport: { preset: "desktop", width: 320, height: 240 },
    scope: { kind: "page" as const, pageReason: "release page" },
    baseline: { snapshotDigest: DIGEST },
    required: true,
  };
  const binding = {
    formatVersion: 1 as const,
    kind: "framelia.contract-binding" as const,
    contractId: "home",
    contractFile: "contracts/home.json",
    contractDigest: DIGEST,
  };
  const casePlan = {
    formatVersion: 2 as const,
    kind: "framelia.case-plan" as const,
    runId: "run-42",
    caseId: "home@chromium#0",
    contract: { id: "home", file: "contracts/home.json", digest: DIGEST, authored },
    snapshotDigest: DIGEST,
    expectedDigest: DIGEST,
    expectedSize: { width: 320, height: 240 },
    baselineSource: { kind: "figma" as const, fileKey: "file-key", nodeId: "1:2" },
    maxMaskedAreaRatio: 0.25,
    stabilitySamples: 2,
    policyDigest: DIGEST,
    bindingDigest: DIGEST,
    binding,
    registration: {
      specFile: "tests/home.spec.ts",
      specDigest: DIGEST,
      titlePath: ["chromium", "home"],
    },
    specFile: "tests/home.spec.ts",
    specFileDigest: DIGEST,
    project: { name: "chromium", runtimeDigest: DIGEST },
    repeatIndex: 0,
    retryAcceptance: "require-first-attempt" as const,
    source: { sourceDigest: DIGEST, buildDigest: DIGEST, dirty: false },
  };
  const score = {
    formatVersion: 1 as const,
    kind: "framelia.attempt-score" as const,
    runType: "final" as const,
    pass: true,
    matchRatio: 0.995,
    ssim: 0.99,
    avgDeltaE: 1.2,
    diffPixels: 10,
    baselineSize: { width: 320, height: 240 },
    actualSize: { width: 320, height: 240 },
    targetUrl: "https://example.test/home",
    baseline: {
      snapshotDigest: DIGEST,
      kind: "figma" as const,
      fileKey: "file-key",
      nodeId: "1:2",
    },
    attachmentBaseName: "home",
    resolvedThreshold: {
      name: "page" as const,
      minMatch: 0.99,
      maxDiffPixels: null,
      minSSIM: 0.97,
      maxAvgDeltaE: 4,
      maxAreaGapPercent: 5,
      cluster: true,
      stabilityMaxDiffRatio: 0.002,
      gateEligible: true,
      styleGateEligible: false,
    },
    profile: "page" as const,
    scope: { kind: "page" as const, fullPage: false },
    captureEvidence: {
      finalUrl: "https://example.test/home",
      startedAt: "2026-09-15T00:00:00.000Z",
      finishedAt: "2026-09-15T00:00:01.000Z",
      capturedAt: "2026-09-15T00:00:01.000Z",
      viewport: { width: 320, height: 240 },
      scope: { kind: "page" as const, fullPage: false },
      elementRect: null,
      readiness: { status: "passed" as const },
      fonts: { supported: true, status: "loaded" as const, failed: [] },
      screenshotHashes: [DIGEST, DIGEST],
      warnings: [],
      actions: [],
    },
    stability: "stable" as const,
    stabilitySampleCount: 2,
    topIssues: [
      {
        severity: "low" as const,
        kind: "style-color" as const,
        message: "expected black, rendered gray",
        repairCandidate: true,
        blocking: false,
        selector: "header",
      },
    ],
    diagnostics: [],
    warnings: [],
  };
  const evidence = {
    expected: {
      kind: "expected" as const,
      availability: "available" as const,
      portablePath: ".framelia/runs/run/cases/home/attempts/0/expected.png",
      digest: DIGEST,
    },
    actual: {
      kind: "actual" as const,
      availability: "available" as const,
      portablePath: ".framelia/runs/run/cases/home/attempts/0/actual.png",
      digest: DIGEST,
    },
    diff: { kind: "diff" as const, availability: "not-recorded" as const },
    score: {
      kind: "score" as const,
      availability: "available" as const,
      portablePath: ".framelia/runs/run/cases/home/attempts/0/score.json",
      digest: DIGEST,
    },
  };
  const attemptRecord = {
    formatVersion: 2 as const,
    kind: "framelia.attempt" as const,
    runId: "run-42",
    attemptId: "home@chromium#0::attempt-0",
    caseId: "home@chromium#0",
    casePlanDigest: DIGEST,
    retryIndex: 0,
    executionState: "completed" as const,
    visualVerdict: "passed" as const,
    startedAt: "2026-09-15T00:00:00.000Z",
    completedAt: "2026-09-15T00:00:01.000Z",
    diagnostics: [],
    evidence: {
      expected: { path: evidence.expected.portablePath, digest: DIGEST },
      actual: { path: evidence.actual.portablePath, digest: DIGEST },
      score: { path: evidence.score.portablePath, digest: DIGEST },
    },
  };
  const attempt = { record: attemptRecord, score, evidence, integrityIssues: [] };
  return {
    runId: "run-42",
    plan: {
      formatVersion: 1,
      kind: "framelia.run-plan",
      runId: "run-42",
      policyDigest: DIGEST,
      retryAcceptance: "require-first-attempt",
      selection: { mode: "all", contracts: ["home"] },
      availableCases: [{ caseId: casePlan.caseId, casePlanDigest: DIGEST }],
      requiredCases: [{ caseId: casePlan.caseId, casePlanDigest: DIGEST }],
      selectedCases: [{ caseId: casePlan.caseId, casePlanDigest: DIGEST }],
    },
    record: {
      formatVersion: 2,
      kind: "framelia.run",
      runId: "run-42",
      planDigest: DIGEST,
      status: "finalized",
      createdAt: "2026-09-15T00:00:00.000Z",
      finalizedAt: "2026-09-15T00:00:02.000Z",
      diagnostics: [],
      cases: [
        {
          caseId: casePlan.caseId,
          attemptIds: [attemptRecord.attemptId],
          selectedAttemptId: attemptRecord.attemptId,
        },
      ],
    },
    coverage: {
      availableCaseIds: [casePlan.caseId],
      requiredCaseIds: [casePlan.caseId],
      selectedCaseIds: [casePlan.caseId],
      selectionMode: "all",
    },
    executionState: "completed",
    visualVerdict: "passed",
    cases: [
      {
        runId: "run-42",
        caseId: casePlan.caseId,
        plan: casePlan,
        selectedAttemptId: attemptRecord.attemptId,
        selectedAttempt: attempt,
        attempts: [attempt],
        missingAttemptIds: [],
        invalidAttempts: [],
      },
    ],
    integrityIssues: [],
  };
}

describe("projectSelectedRun", () => {
  it("keeps run/case/attempt identity, measured diagnostics, and portable evidence together", () => {
    const projection = projectSelectedRun("/copied-root", selectedRunFixture());
    expect(projection.run).toMatchObject({
      schemaVersion: 2,
      runId: "run-42",
      coverage: { available: 1, required: 1, selected: 1 },
      executionState: "completed",
      visualVerdict: "passed",
      contracts: [
        {
          sourceRunId: "run-42",
          caseId: "home@chromium#0",
          contractId: "home",
          projectName: "chromium",
          repeatIndex: 0,
          targetPath: "/home",
          comparison: { matchRatio: 0.995, ssim: 0.99, diffPixels: 10 },
          topIssues: [expect.objectContaining({ kind: "style-color", selector: "header" })],
          attempts: [
            expect.objectContaining({ attemptId: "home@chromium#0::attempt-0", selected: true }),
          ],
          provenance: {
            policyDigest: DIGEST,
            retryAcceptance: "require-first-attempt",
            bindingDigest: DIGEST,
            specFile: "tests/home.spec.ts",
            specFileDigest: DIGEST,
            titlePath: ["chromium", "home"],
          },
        },
      ],
    });
    expect([...projection.files.keys()]).toEqual([
      ".framelia/runs/run/cases/home/attempts/0/expected.png",
      ".framelia/runs/run/cases/home/attempts/0/actual.png",
      ".framelia/runs/run/cases/home/attempts/0/score.json",
    ]);
  });

  it("never projects a score with blocking diagnostics as passed", () => {
    const selectedRun = selectedRunFixture();
    selectedRun.cases[0]!.selectedAttempt!.score!.diagnostics = [
      { kind: "warning", code: "READINESS_FAILED", message: "not ready", blocking: true },
    ];
    const projection = projectSelectedRun("/copied-root", selectedRun);
    expect(projection.run.contracts[0]).toMatchObject({
      status: "blocked",
      attempts: [
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ code: "READINESS_FAILED", blocking: true })],
        }),
      ],
    });
  });

  it("projects persisted run publication diagnostics as blocking dashboard warnings", () => {
    const selectedRun = selectedRunFixture();
    const diagnostic = {
      code: "attempt-publication-failed",
      stage: "publication" as const,
      message: "attempt evidence could not be committed",
    };
    selectedRun.record.status = "error";
    selectedRun.record.diagnostics = [diagnostic];
    selectedRun.integrityIssues = [diagnostic];
    selectedRun.executionState = "error";

    const projection = projectSelectedRun("/copied-root", selectedRun);
    expect(projection.run.status).toBe("blocked");
    expect(projection.run.contracts[0]?.status).toBe("blocked");

    expect(projection.run.diagnostics).toEqual([
      {
        kind: "warning",
        code: diagnostic.code,
        message: diagnostic.message,
        blocking: true,
      },
    ]);
  });
});

describe("summarize / overallStatus", () => {
  it("prioritizes running over queued over blocked over failed over masked-pass", () => {
    const base = {
      id: "a",
      name: "a",
      tags: [],
      phase: "complete" as const,
      baselineKind: "figma" as const,
      capture: { kind: "viewport" as const, viewport: { width: 1, height: 1 } },
      blockers: [],
    };
    const summary = summarize([
      { ...base, status: "running" },
      { ...base, status: "queued" },
      { ...base, status: "blocked" },
      { ...base, status: "failed" },
      { ...base, status: "masked-pass" },
    ]);
    expect(overallStatus(summary)).toBe("running");
  });
});
