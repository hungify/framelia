import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ATTEMPT_FORMAT_VERSION,
  CASE_PLAN_FORMAT_VERSION,
  RUN_PLAN_FORMAT_VERSION,
  type AttemptRecord,
  type CasePlan,
  type RunPlan,
} from "@framelia/contracts/workflow";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJsonDigest } from "../src/canonical-json.ts";
import {
  computeAttemptId,
  computeCaseId,
  finalizeRunRecord,
  freezeRunPlan,
  publishAttempt,
  readRunBundle,
  readRunRecord,
  startRunRecord,
} from "../src/run-bundle/index.ts";
import { AppError } from "../src/types.ts";

const A_DIGEST = `sha256:${"a".repeat(64)}`;

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirectories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-run-bundle-"));
  temporaryDirectories.push(root);
  return root;
}

function casePlanFixture(overrides: Partial<CasePlan> = {}): CasePlan {
  return {
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    caseId: computeCaseId({ contractId: "login.desktop", projectName: "chromium", repeatIndex: 0 }),
    contract: { id: "login.desktop", file: "contracts/login.json", digest: A_DIGEST },
    snapshotDigest: A_DIGEST,
    policyDigest: A_DIGEST,
    bindingDigest: A_DIGEST,
    specFileDigest: A_DIGEST,
    project: { name: "chromium", runtimeDigest: A_DIGEST },
    repeatIndex: 0,
    source: {},
    ...overrides,
  };
}

function runPlanFixture(runId: string, casePlans: readonly CasePlan[]): RunPlan {
  const planned = casePlans.map((casePlan) => ({
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
  }));
  return {
    formatVersion: RUN_PLAN_FORMAT_VERSION,
    kind: "framelia.run-plan",
    runId,
    policyDigest: A_DIGEST,
    selection: { mode: "all", contracts: [...new Set(casePlans.map((c) => c.contract.id))] },
    availableCases: planned,
    requiredCases: planned,
    selectedCases: planned,
  };
}

function attemptFixture(
  caseId: string,
  retryIndex: number,
  overrides: Partial<Omit<AttemptRecord, "evidence">> = {},
): Omit<AttemptRecord, "evidence"> {
  return {
    formatVersion: ATTEMPT_FORMAT_VERSION,
    kind: "framelia.attempt",
    attemptId: computeAttemptId(caseId, retryIndex),
    caseId,
    casePlanDigest: A_DIGEST,
    retryIndex,
    executionState: "completed",
    visualVerdict: "passed",
    startedAt: "2026-09-14T12:00:00.000Z",
    completedAt: "2026-09-14T12:00:01.000Z",
    diagnostics: [],
    ...overrides,
  };
}

function setUpRun(root: string, runId: string, casePlans: readonly CasePlan[]): RunPlan {
  const plan = runPlanFixture(runId, casePlans);
  freezeRunPlan(root, plan, casePlans);
  startRunRecord(root, plan, "2026-09-14T12:00:00.000Z");
  return plan;
}

describe("publishAttempt", () => {
  it("publishes two attempts for the same case at different retryIndex independently, without collapsing either", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-retries";
    setUpRun(root, runId, [casePlan]);

    publishAttempt(
      root,
      runId,
      attemptFixture(casePlan.caseId, 0, { visualVerdict: "mismatched" }),
      {
        actual: Buffer.from("attempt-0-actual"),
      },
    );
    publishAttempt(root, runId, attemptFixture(casePlan.caseId, 1), {
      actual: Buffer.from("attempt-1-actual"),
    });

    const bundle = readRunBundle(root, runId);
    expect(bundle.attempts.size).toBe(2);
    const attempt0 = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0));
    const attempt1 = bundle.attempts.get(computeAttemptId(casePlan.caseId, 1));
    expect(attempt0?.visualVerdict).toBe("mismatched");
    expect(attempt1?.visualVerdict).toBe("passed");
  });

  it("rejects publishing the same attemptId twice with a clear, attributable error", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-collision";
    setUpRun(root, runId, [casePlan]);

    publishAttempt(root, runId, attemptFixture(casePlan.caseId, 0), {
      actual: Buffer.from("first-actual"),
    });

    expect(() =>
      publishAttempt(root, runId, attemptFixture(casePlan.caseId, 0), {
        actual: Buffer.from("second-actual-should-never-land"),
      }),
    ).toThrow(/already published/i);

    // The rejected second write must never have mutated the first attempt's own evidence.
    const bundle = readRunBundle(root, runId);
    const attempt = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0));
    expect(attempt?.evidence.actual?.digest).toBe(
      `sha256:${crypto.createHash("sha256").update("first-actual").digest("hex")}`,
    );
  });

  it("refuses to publish a claimed visual pass with no actual-capture evidence behind it", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-no-evidence";
    setUpRun(root, runId, [casePlan]);

    expect(() => publishAttempt(root, runId, attemptFixture(casePlan.caseId, 0), {})).toThrow(
      AppError,
    );

    // The rejected publish must leave no trace -- no attempt directory, no partial files.
    const bundle = readRunBundle(root, runId);
    expect(bundle.attempts.size).toBe(0);
  });

  it("never lets a skipped/blocked test appear as a visual pass (schema-level guard)", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-blocked";
    setUpRun(root, runId, [casePlan]);

    expect(() =>
      publishAttempt(
        root,
        runId,
        attemptFixture(casePlan.caseId, 0, {
          executionState: "blocked",
          visualVerdict: "passed",
          completedAt: undefined,
        }),
        { actual: Buffer.from("actual") },
      ),
    ).toThrow(/visual verdict requires executionState/);
  });
});

describe("two runs in one project root", () => {
  it("coexist without interfering, each fully readable on its own", () => {
    const root = temporaryRoot();
    const casePlanA = casePlanFixture({
      caseId: computeCaseId({ contractId: "a", projectName: "chromium", repeatIndex: 0 }),
      contract: { id: "a", file: "contracts/a.json", digest: A_DIGEST },
    });
    const casePlanB = casePlanFixture({
      caseId: computeCaseId({ contractId: "b", projectName: "chromium", repeatIndex: 0 }),
      contract: { id: "b", file: "contracts/b.json", digest: A_DIGEST },
    });

    setUpRun(root, "run-a", [casePlanA]);
    setUpRun(root, "run-b", [casePlanB]);

    publishAttempt(root, "run-a", attemptFixture(casePlanA.caseId, 0), {
      actual: Buffer.from("run-a-actual"),
    });
    publishAttempt(root, "run-b", attemptFixture(casePlanB.caseId, 0), {
      actual: Buffer.from("run-b-actual"),
    });

    const bundleA = readRunBundle(root, "run-a");
    const bundleB = readRunBundle(root, "run-b");
    expect(bundleA.attempts.size).toBe(1);
    expect(bundleB.attempts.size).toBe(1);
    expect(bundleA.plan.runId).toBe("run-a");
    expect(bundleB.plan.runId).toBe("run-b");
  });
});

describe("readRunBundle after copying the bundle elsewhere", () => {
  it("resolves every evidence reference from the copy alone, with no absolute-path leakage from the writer", () => {
    const writerRoot = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-portable";
    setUpRun(writerRoot, runId, [casePlan]);
    publishAttempt(writerRoot, runId, attemptFixture(casePlan.caseId, 0), {
      actual: Buffer.from("portable-actual"),
      diff: Buffer.from("portable-diff"),
    });
    finalizeRunRecord(writerRoot, runId, { retryAcceptance: "require-first-attempt" });

    // Simulate "a different machine": copy only the `.framelia` subtree to a brand-new
    // root that shares nothing with the writer's own absolute checkout path.
    const copiedRoot = temporaryRoot();
    fs.cpSync(path.join(writerRoot, ".framelia"), path.join(copiedRoot, ".framelia"), {
      recursive: true,
    });
    fs.rmSync(writerRoot, { recursive: true, force: true });

    const bundle = readRunBundle(copiedRoot, runId);
    expect(bundle.record.status).toBe("finalized");
    const attempt = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0));
    expect(attempt?.evidence.actual?.path.startsWith(".framelia/")).toBe(true);
  });
});

describe("finalizeRunRecord", () => {
  it("selects the highest passing retry under allow-passed-after-retry, and never rescues a first-attempt failure under require-first-attempt", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-retry-policy";
    setUpRun(root, runId, [casePlan]);
    publishAttempt(
      root,
      runId,
      attemptFixture(casePlan.caseId, 0, { visualVerdict: "mismatched" }),
      {
        actual: Buffer.from("attempt-0"),
      },
    );
    publishAttempt(root, runId, attemptFixture(casePlan.caseId, 1), {
      actual: Buffer.from("attempt-1"),
    });

    const allowRetry = finalizeRunRecord(root, runId, {
      retryAcceptance: "allow-passed-after-retry",
    });
    expect(allowRetry.cases[0]?.selectedAttemptId).toBe(computeAttemptId(casePlan.caseId, 1));
    expect(allowRetry.cases[0]?.attemptIds).toHaveLength(2);

    const firstOnly = finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });
    expect(firstOnly.cases[0]?.selectedAttemptId).toBe(computeAttemptId(casePlan.caseId, 0));
  });

  it("finalizes with status finalized and finalizedAt regardless of prior running state", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-finalize";
    setUpRun(root, runId, [casePlan]);
    expect(readRunRecord(root, runId).status).toBe("running");

    publishAttempt(root, runId, attemptFixture(casePlan.caseId, 0), {
      actual: Buffer.from("actual"),
    });
    const finalized = finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalizedAt).toBeDefined();
    expect(readRunRecord(root, runId).status).toBe("finalized");
  });

  it("finalizes a case with zero published attempts (writer failure/cancellation) with an empty attemptIds list, never a selectedAttemptId", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-no-attempts";
    setUpRun(root, runId, [casePlan]);

    const finalized = finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });
    expect(finalized.cases[0]).toEqual({ caseId: casePlan.caseId, attemptIds: [] });
  });
});

describe("freezeRunPlan", () => {
  it("rejects freezing the same runId twice -- a run plan is immutable once frozen", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-immutable-plan";
    const plan = runPlanFixture(runId, [casePlan]);
    freezeRunPlan(root, plan, [casePlan]);
    expect(() => freezeRunPlan(root, plan, [casePlan])).toThrow(/already published/i);
  });

  it("rejects a case-plan whose digest disagrees with the run plan's own availableCases entry", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const plan = runPlanFixture("run-mismatch", [casePlan]);
    const tamperedCasePlan = { ...casePlan, repeatIndex: 99 };
    expect(() => freezeRunPlan(root, plan, [tamperedCasePlan])).toThrow(AppError);
  });
});

describe("readRunBundle tamper detection", () => {
  it("throws when an evidence file's bytes no longer match its recorded digest", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-tampered";
    setUpRun(root, runId, [casePlan]);
    publishAttempt(root, runId, attemptFixture(casePlan.caseId, 0), {
      actual: Buffer.from("original-actual"),
    });

    const bundle = readRunBundle(root, runId);
    const attempt = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0))!;
    fs.writeFileSync(path.join(root, attempt.evidence.actual!.path), "tampered-bytes");

    expect(() => readRunBundle(root, runId)).toThrow(/does not match its recorded digest/);
  });
});
