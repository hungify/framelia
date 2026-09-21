import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ATTEMPT_FORMAT_VERSION,
  ATTEMPT_SCORE_FORMAT_VERSION,
  authoredContractSchema,
  baselineSnapshotSchema,
  CASE_PLAN_FORMAT_VERSION,
  casePlanSchema,
  contractBindingSchema,
  RUN_PLAN_FORMAT_VERSION,
  type AttemptRecord,
  type CasePlan,
  type RunPlan,
} from "@framelia/contracts/workflow";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJsonDigest } from "../src/canonical-json.ts";
import { resolveProjectPolicy } from "../src/project-policy.ts";
import {
  computeAttemptId,
  computeCaseId,
  finalizeRunRecord,
  freezeRunPlan,
  publishAttempt,
  publishBundleUnit,
  readRunBundle,
  readRunRecord,
  runRecordPath,
  startRunRecord,
} from "../src/run-bundle/index.ts";
import { makeSolidPng } from "../src/testing.ts";
import { AppError } from "../src/types.ts";

const A_DIGEST = `sha256:${"a".repeat(64)}`;
const EXPECTED_DIGEST =
  `sha256:${crypto.createHash("sha256").update("expected").digest("hex")}` as const;

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

/** Lightweight, fully synthetic case plan: no file backs any of its digests. Fine for
 *  every test that never calls `finalizeRunRecord` and checks `selectedAttemptId` --
 *  `finalizeRunRecord`'s own input reconciliation (see `reconcileCasePlan`) will always
 *  report this fixture's inputs as "changed" (nothing really exists at `contract.file`),
 *  which is irrelevant to those tests' own focus (immutability, collision, membership). */
function casePlanFixture(
  overrides: Partial<Omit<CasePlan, "contract">> & {
    contract?: Partial<CasePlan["contract"]>;
  } = {},
): CasePlan {
  const contractId = overrides.contract?.id ?? "login.desktop";
  const contractFile = overrides.contract?.file ?? "contracts/login.json";
  const authored = authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: contractId,
    name: contractId,
    revision: 1,
    target: { path: `/${contractId}` },
    viewport: { preset: "desktop", width: 10, height: 10 },
    scope: { kind: "page", pageReason: "fixture" },
    baseline: { snapshotDigest: A_DIGEST },
  });
  const binding = contractBindingSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract-binding",
    contractId,
    contractFile,
    contractDigest: overrides.contract?.digest ?? A_DIGEST,
  });
  const base: CasePlan = {
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    runId: "pending-test-run",
    caseId: computeCaseId({ contractId, projectName: "chromium", repeatIndex: 0 }),
    contract: {
      id: contractId,
      file: contractFile,
      digest: overrides.contract?.digest ?? A_DIGEST,
      authored,
    },
    snapshotDigest: A_DIGEST,
    expectedDigest: EXPECTED_DIGEST,
    expectedSize: { width: 10, height: 10 },
    baselineSource: { kind: "figma", fileKey: "fixture", nodeId: "1:2" },
    maxMaskedAreaRatio: 0.25,
    stabilitySamples: 2,
    policyDigest: A_DIGEST,
    bindingDigest: A_DIGEST,
    binding,
    registration: {
      specFile: "specs/fixture.spec.ts",
      specDigest: A_DIGEST,
      titlePath: ["fixture"],
    },
    specFile: "specs/fixture.spec.ts",
    specFileDigest: A_DIGEST,
    project: { name: "chromium", runtimeDigest: A_DIGEST },
    repeatIndex: 0,
    retryAcceptance: "require-first-attempt",
    source: {},
  };
  return { ...base, ...overrides, contract: { ...base.contract, ...overrides.contract } };
}

/**
 * A case plan whose every digest-bearing input genuinely exists on disk under `root` and
 * matches what's recorded -- `finalizeRunRecord`'s own input reconciliation reports this
 * as fully consistent. Used by the handful of tests that actually exercise selection
 * logic (`selectFinalAttempt`) or reconciliation itself, where a synthetic, always-
 * "changed" fixture would mask what's really being tested.
 */
async function realCasePlanFixture(
  root: string,
  options: { contractId?: string; projectName?: string; repeatIndex?: number } = {},
): Promise<CasePlan> {
  const contractId = options.contractId ?? "login.desktop";
  const projectName = options.projectName ?? "chromium";
  const repeatIndex = options.repeatIndex ?? 0;

  fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
  const policy = await resolveProjectPolicy({
    cwd: root,
    projectRoot: root,
    allowUninitialized: true,
  });

  const viewport = { width: 10, height: 10 };
  const imageBytes = PNG.sync.write(makeSolidPng(viewport.width, viewport.height, [1, 2, 3, 255]));
  const imageDigest: `sha256:${string}` = `sha256:${crypto.createHash("sha256").update(imageBytes).digest("hex")}`;
  const snapshot = baselineSnapshotSchema.parse({
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    rendering: { viewport: { preset: "desktop", ...viewport }, deviceScaleFactor: 1 },
    expected: {
      kind: "page",
      image: { path: `${contractId}.png`, digest: imageDigest, ...viewport },
    },
  });
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root, `${contractId}.png`), imageBytes);

  const contract = authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: contractId,
    name: contractId,
    revision: 1,
    target: { path: `/${contractId}` },
    viewport: { preset: "desktop", ...viewport },
    scope: { kind: "page", pageReason: "fixture" },
    baseline: { snapshotDigest },
  });
  const contractDigest = canonicalJsonDigest(contract);
  const contractFile = `contracts/${contractId}.json`;
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(root, contractFile), JSON.stringify(contract));

  const binding = contractBindingSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract-binding",
    contractId,
    contractFile,
    contractDigest,
  });

  const specFile = `specs/${contractId}.spec.ts`;
  fs.mkdirSync(path.join(root, "specs"), { recursive: true });
  fs.writeFileSync(path.join(root, specFile), "// fixture spec\n");
  const specFileDigest: `sha256:${string}` = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, specFile)))
    .digest("hex")}`;

  return casePlanSchema.parse({
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    runId: "pending-test-run",
    caseId: computeCaseId({ contractId, projectName, repeatIndex }),
    contract: { id: contractId, file: contractFile, digest: contractDigest, authored: contract },
    expectedDigest: imageDigest,
    expectedSize: viewport,
    baselineSource: snapshot.source,
    maxMaskedAreaRatio: 0.25,
    stabilitySamples: 2,
    snapshotDigest,
    policyDigest: policy.policyDigest!,
    bindingDigest: canonicalJsonDigest(binding),
    binding,
    registration: {
      specFile,
      specDigest: specFileDigest,
      titlePath: [projectName, specFile, contractId],
    },
    specFile,
    specFileDigest,
    project: { name: projectName, runtimeDigest: A_DIGEST },
    repeatIndex,
    retryAcceptance: "require-first-attempt",
    source: {},
  });
}

function runPlanFixture(runId: string, casePlans: readonly CasePlan[]): RunPlan {
  for (const casePlan of casePlans) casePlan.runId = runId;
  const planned = casePlans.map((casePlan) => ({
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
  }));
  return {
    formatVersion: RUN_PLAN_FORMAT_VERSION,
    kind: "framelia.run-plan",
    runId,
    retryAcceptance: casePlans[0]?.retryAcceptance ?? "require-first-attempt",
    policyDigest: A_DIGEST,
    selection: { mode: "all", contracts: [...new Set(casePlans.map((c) => c.contract.id))] },
    availableCases: planned,
    requiredCases: planned,
    selectedCases: planned,
  };
}

function attemptFixture(
  casePlan: CasePlan,
  retryIndex: number,
  overrides: Partial<Omit<AttemptRecord, "evidence">> = {},
): Omit<AttemptRecord, "evidence"> {
  return {
    formatVersion: ATTEMPT_FORMAT_VERSION,
    kind: "framelia.attempt",
    attemptId: computeAttemptId(casePlan.caseId, retryIndex),
    runId: casePlan.runId,
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
    retryIndex,
    executionState: "completed",
    visualVerdict: "passed",
    startedAt: "2026-09-14T12:00:00.000Z",
    completedAt: "2026-09-14T12:00:01.000Z",
    diagnostics: [],
    ...overrides,
  };
}

function completeEvidence(actual: Buffer): {
  expected: Buffer;
  actual: Buffer;
  score: Buffer;
} {
  return {
    expected: Buffer.from("expected"),
    actual,
    score: Buffer.from(
      JSON.stringify({
        formatVersion: ATTEMPT_SCORE_FORMAT_VERSION,
        kind: "framelia.attempt-score",
        pass: true,
        runType: "final",
        matchRatio: 1,
        ssim: 1,
        avgDeltaE: 0,
        diffPixels: 0,
        baselineSize: { width: 10, height: 10 },
        actualSize: { width: 10, height: 10 },
        targetUrl: "https://example.test/login",
        baseline: {
          snapshotDigest: A_DIGEST,
          kind: "figma",
          fileKey: "fixture",
          nodeId: "1:2",
        },
        attachmentBaseName: "fixture",
        resolvedThreshold: {
          name: "page",
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
        profile: "page",
        scope: { kind: "page", fullPage: true },
        captureEvidence: {
          finalUrl: "https://example.test/login",
          startedAt: "2026-09-14T12:00:00.000Z",
          finishedAt: "2026-09-14T12:00:01.000Z",
          capturedAt: "2026-09-14T12:00:01.000Z",
          viewport: { width: 10, height: 10 },
          scope: { kind: "page", fullPage: true },
          elementRect: null,
          readiness: { status: "passed" },
          fonts: { supported: true, status: "loaded", failed: [] },
          screenshotHashes: [A_DIGEST, A_DIGEST],
          warnings: [],
          actions: [],
        },
        stability: "stable",
        stabilitySampleCount: 2,
        topIssues: [],
        diagnostics: [],
        warnings: [],
      }),
    ),
  };
}

function setUpRun(root: string, runId: string, casePlans: readonly CasePlan[]): RunPlan {
  const plan = runPlanFixture(runId, casePlans);
  freezeRunPlan(root, plan, casePlans);
  startRunRecord(root, plan, "2026-09-14T12:00:00.000Z");
  return plan;
}

// Deliberate exception to "no real wall-clock timers in tests" (used only by the
// "cross-process lock" describe block below): those workers are genuinely separate OS
// processes coordinating through a real filesystem lock -- there is no fake-timer or
// in-process event to await instead, since neither process runs inside this test's own
// event loop. A short, real sleep is the only way to give the publish worker a reliable
// head start before the finalize worker starts.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("publishAttempt", () => {
  it("publishes two attempts for the same case at different retryIndex independently, without collapsing either", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-retries";
    setUpRun(root, runId, [casePlan]);

    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0, { visualVerdict: "mismatched" }),
      completeEvidence(Buffer.from("attempt-0-actual")),
    );
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 1),
      completeEvidence(Buffer.from("attempt-1-actual")),
    );

    const bundle = readRunBundle(root, runId);
    expect(bundle.attempts.size).toBe(2);
    const attempt0 = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0));
    const attempt1 = bundle.attempts.get(computeAttemptId(casePlan.caseId, 1));
    expect(attempt0?.visualVerdict).toBe("mismatched");
    expect(attempt1?.visualVerdict).toBe("passed");
  });

  it("rejects publishing the same attemptId twice with a clear, attributable error", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-collision";
    setUpRun(root, runId, [casePlan]);

    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("first-actual")),
    );

    await expect(
      publishAttempt(
        root,
        runId,
        attemptFixture(casePlan, 0),
        completeEvidence(Buffer.from("second-actual-should-never-land")),
      ),
    ).rejects.toThrow(/already published/i);

    // The rejected second write must never have mutated the first attempt's own evidence.
    const bundle = readRunBundle(root, runId);
    const attempt = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0));
    expect(attempt?.evidence.actual?.digest).toBe(
      `sha256:${crypto.createHash("sha256").update("first-actual").digest("hex")}`,
    );
  });

  it("refuses to publish a claimed visual pass with no actual-capture evidence behind it", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-no-evidence";
    setUpRun(root, runId, [casePlan]);

    await expect(publishAttempt(root, runId, attemptFixture(casePlan, 0), {})).rejects.toThrow(
      AppError,
    );

    // The rejected publish must leave no trace -- no attempt directory, no partial files.
    const bundle = readRunBundle(root, runId);
    expect(bundle.attempts.size).toBe(0);
  });

  it("never lets a skipped/blocked test appear as a visual pass (schema-level guard)", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-blocked";
    setUpRun(root, runId, [casePlan]);

    await expect(
      publishAttempt(
        root,
        runId,
        attemptFixture(casePlan, 0, {
          executionState: "blocked",
          visualVerdict: "passed",
          completedAt: undefined,
        }),
        completeEvidence(Buffer.from("actual")),
      ),
    ).rejects.toThrow(/visual verdict requires executionState/);
  });

  it("rejects an attempt whose casePlanDigest disagrees with the frozen plan's digest for that case", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-digest-mismatch";
    setUpRun(root, runId, [casePlan]);

    await expect(
      publishAttempt(
        root,
        runId,
        attemptFixture(casePlan, 0, { casePlanDigest: A_DIGEST }),
        completeEvidence(Buffer.from("actual")),
      ),
    ).rejects.toThrow(/casePlanDigest.*does not match/);
  });

  it("rejects an attempt for a caseId the frozen plan never selected", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-unknown-case";
    setUpRun(root, runId, [casePlan]);

    await expect(
      publishAttempt(
        root,
        runId,
        attemptFixture({ ...casePlan, caseId: "not-a-selected-case" }, 0),
        completeEvidence(Buffer.from("actual")),
      ),
    ).rejects.toThrow(/not part of run .* selected cases/);
  });

  it("rejects publishing a new attempt once the run has already been finalized", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-sealed";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("attempt-0")),
    );
    await finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });

    await expect(
      publishAttempt(
        root,
        runId,
        attemptFixture(casePlan, 1),
        completeEvidence(Buffer.from("attempt-1-too-late")),
      ),
    ).rejects.toThrow(/already finalized/);
  });
});

describe("two runs in one project root", () => {
  it("coexist without interfering, each fully readable on its own", async () => {
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

    await publishAttempt(
      root,
      "run-a",
      attemptFixture(casePlanA, 0),
      completeEvidence(Buffer.from("run-a-actual")),
    );
    await publishAttempt(
      root,
      "run-b",
      attemptFixture(casePlanB, 0),
      completeEvidence(Buffer.from("run-b-actual")),
    );

    const bundleA = readRunBundle(root, "run-a");
    const bundleB = readRunBundle(root, "run-b");
    expect(bundleA.attempts.size).toBe(1);
    expect(bundleB.attempts.size).toBe(1);
    expect(bundleA.plan.runId).toBe("run-a");
    expect(bundleB.plan.runId).toBe("run-b");
  });
});

describe("readRunBundle after copying the bundle elsewhere", () => {
  it("resolves every evidence reference from the copy alone, with no absolute-path leakage from the writer", async () => {
    const writerRoot = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-portable";
    setUpRun(writerRoot, runId, [casePlan]);
    await publishAttempt(writerRoot, runId, attemptFixture(casePlan, 0), {
      ...completeEvidence(Buffer.from("portable-actual")),
      diff: Buffer.from("portable-diff"),
    });
    await finalizeRunRecord(writerRoot, runId, { retryAcceptance: "require-first-attempt" });

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
  it("selects the highest passing retry only under the retry policy frozen into the run", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    casePlan.retryAcceptance = "allow-passed-after-retry";
    const runId = "run-retry-policy";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0, { visualVerdict: "mismatched" }),
      completeEvidence(Buffer.from("attempt-0")),
    );
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 1),
      completeEvidence(Buffer.from("attempt-1")),
    );

    await expect(
      finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" }),
    ).rejects.toThrow(/does not match frozen run policy/);
    const allowRetry = await finalizeRunRecord(root, runId, {
      retryAcceptance: "allow-passed-after-retry",
    });
    expect(allowRetry.cases[0]?.selectedAttemptId).toBe(computeAttemptId(casePlan.caseId, 1));
    expect(allowRetry.cases[0]?.attemptIds).toHaveLength(2);
  });

  it("finalizes with status finalized and finalizedAt regardless of prior running state", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-finalize";
    setUpRun(root, runId, [casePlan]);
    expect(readRunRecord(root, runId).status).toBe("running");

    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual")),
    );
    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalizedAt).toBeDefined();
    expect(readRunRecord(root, runId).status).toBe("finalized");
  });

  it("finalizes a case with zero published attempts (writer failure/cancellation) with an empty attemptIds list, never a selectedAttemptId", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-no-attempts";
    setUpRun(root, runId, [casePlan]);

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.cases[0]).toEqual({ caseId: casePlan.caseId, attemptIds: [] });
  });

  it("never lets a later retry rescue a missing first attempt under require-first-attempt", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    const runId = "run-missing-first-attempt";
    setUpRun(root, runId, [casePlan]);
    // Only retry 1 was ever published (e.g. the first attempt's own publish crashed) --
    // require-first-attempt must never treat this as if retry 1 were "the first attempt".
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 1),
      completeEvidence(Buffer.from("attempt-1")),
    );

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.cases[0]?.attemptIds).toEqual([computeAttemptId(casePlan.caseId, 1)]);
    expect(finalized.cases[0]?.selectedAttemptId).toBeUndefined();
  });

  it("excludes an attempt with tampered/deleted evidence from selection, while preserving it in attemptIds", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    const runId = "run-tampered-selection";
    setUpRun(root, runId, [casePlan]);
    const attempt = await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual-bytes")),
    );
    fs.writeFileSync(path.join(root, attempt.evidence.actual!.path), "tampered-after-publish");

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.cases[0]?.attemptIds).toEqual([attempt.attemptId]);
    expect(finalized.cases[0]?.selectedAttemptId).toBeUndefined();
  });
});

describe("finalizeRunRecord input reconciliation", () => {
  it("never selects an authoritative attempt for a case whose frozen contract changed after freezing (changed planning inputs invalidate the run)", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    const runId = "run-contract-drift";
    setUpRun(root, runId, [casePlan]);
    const attempt = await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual")),
    );

    // Edit the contract file on disk *after* the case plan was frozen -- its own digest
    // now disagrees with what `casePlan.contract.digest` recorded.
    const contractPath = path.join(root, casePlan.contract.file);
    const mutated = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    mutated.revision = 999;
    fs.writeFileSync(contractPath, JSON.stringify(mutated));

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    // Retry history is preserved (the attempt really was published)...
    expect(finalized.cases[0]?.attemptIds).toEqual([attempt.attemptId]);
    // ...but nothing about this case can read as an authoritative pass anymore, even
    // though the attempt's own visualVerdict is still "passed" and its own evidence is
    // untouched -- the IDs/commit strings never changed, only the contract's content did.
    expect(finalized.cases[0]?.selectedAttemptId).toBeUndefined();
  });

  it("never selects an authoritative attempt once the pinned baseline snapshot has been re-pinned to different bytes", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    const runId = "run-baseline-drift";
    setUpRun(root, runId, [casePlan]);
    const attempt = await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual")),
    );

    // Overwrite the pinned baseline's own image bytes in place (the same root-relative
    // path `realCasePlanFixture` pinned it at: `<contract-id>.png`) -- the snapshot
    // record's own recorded digest now disagrees with the real file underneath it,
    // exactly as if the baseline had been silently re-pinned without touching the
    // contract or the snapshot record itself.
    const imagePath = path.join(root, `${casePlan.contract.id}.png`);
    fs.writeFileSync(imagePath, PNG.sync.write(makeSolidPng(10, 10, [9, 9, 9, 255])));

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.cases[0]?.attemptIds).toEqual([attempt.attemptId]);
    expect(finalized.cases[0]?.selectedAttemptId).toBeUndefined();
  });

  it("does select an authoritative attempt when nothing about the case's frozen inputs has changed", async () => {
    const root = temporaryRoot();
    const casePlan = await realCasePlanFixture(root);
    const runId = "run-no-drift";
    setUpRun(root, runId, [casePlan]);
    const attempt = await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual")),
    );

    const finalized = await finalizeRunRecord(root, runId, {
      retryAcceptance: "require-first-attempt",
    });
    expect(finalized.cases[0]?.selectedAttemptId).toBe(attempt.attemptId);
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

  it("rejects when the run plan's availableCases lists a case with no supplied case-plan record", () => {
    const root = temporaryRoot();
    const casePlanA = casePlanFixture({
      caseId: computeCaseId({ contractId: "a", projectName: "chromium", repeatIndex: 0 }),
      contract: { id: "a", file: "contracts/a.json", digest: A_DIGEST },
    });
    const casePlanB = casePlanFixture({
      caseId: computeCaseId({ contractId: "b", projectName: "chromium", repeatIndex: 0 }),
      contract: { id: "b", file: "contracts/b.json", digest: A_DIGEST },
    });
    const plan = runPlanFixture("run-missing-case-plan", [casePlanA, casePlanB]);

    expect(() => freezeRunPlan(root, plan, [casePlanA])).toThrow(/no supplied case-plan record/);
  });

  it("rejects a duplicate case-plan supplied for the same caseId", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const plan = runPlanFixture("run-duplicate-case-plan", [casePlan]);
    expect(() => freezeRunPlan(root, plan, [casePlan, casePlan])).toThrow(/Duplicate case plan/);
  });
});

describe("readRunBundle tamper detection", () => {
  it("throws when an evidence file's bytes no longer match its recorded digest", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-tampered";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("original-actual")),
    );

    const bundle = readRunBundle(root, runId);
    const attempt = bundle.attempts.get(computeAttemptId(casePlan.caseId, 0))!;
    fs.writeFileSync(path.join(root, attempt.evidence.actual!.path), "tampered-bytes");

    expect(() => readRunBundle(root, runId)).toThrow(/does not match its recorded digest/);
  });

  it("throws when a finalized run record omits a selected case entirely", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-omitted-case";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("actual")),
    );
    await finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });

    const recordPath = runRecordPath(root, runId);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    record.cases = [];
    fs.writeFileSync(recordPath, JSON.stringify(record));

    expect(() => readRunBundle(root, runId)).toThrow(/omits selected case/);
  });

  it("throws when a finalized run record omits a published attempt for one of its cases", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-omitted-attempt";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("attempt-0")),
    );
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 1),
      completeEvidence(Buffer.from("attempt-1")),
    );
    await finalizeRunRecord(root, runId, { retryAcceptance: "require-first-attempt" });

    const recordPath = runRecordPath(root, runId);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    record.cases[0].attemptIds = [computeAttemptId(casePlan.caseId, 0)];
    record.cases[0].selectedAttemptId = computeAttemptId(casePlan.caseId, 0);
    fs.writeFileSync(recordPath, JSON.stringify(record));

    expect(() => readRunBundle(root, runId)).toThrow(/omits published attempt/);
  });

  it("throws when a record references a case the frozen plan never selected", () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-foreign-case";
    setUpRun(root, runId, [casePlan]);

    const recordPath = runRecordPath(root, runId);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    record.cases.push({ caseId: "not-in-the-plan", attemptIds: [] });
    fs.writeFileSync(recordPath, JSON.stringify(record));

    expect(() => readRunBundle(root, runId)).toThrow(/not part of the frozen plan's selectedCases/);
  });
});

describe("publishBundleUnit path safety", () => {
  it("rejects a staged file whose relativePath escapes the staging directory", () => {
    const root = temporaryRoot();
    const targetDir = path.join(root, "unit");
    expect(() =>
      publishBundleUnit(targetDir, [{ relativePath: "../../escaped.json", content: "{}" }]),
    ).toThrow(/must not contain empty, "\.", or "\.\." segments/);
    expect(fs.existsSync(path.join(root, "escaped.json"))).toBe(false);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it("rejects an absolute staged file path", () => {
    const root = temporaryRoot();
    const targetDir = path.join(root, "unit");
    expect(() =>
      publishBundleUnit(targetDir, [{ relativePath: "/etc/passwd", content: "x" }]),
    ).toThrow(/must be relative, not absolute/);
  });
});

describe("cross-process lock", () => {
  const workerPath = fileURLToPath(new URL("./support/run-bundle-lock-worker.ts", import.meta.url));

  function runWorker(
    args: readonly string[],
    env: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--conditions=framelia-dev", "--import", "tsx", workerPath, ...args],
        { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  }

  it("serializes a slow publishAttempt against a concurrent finalizeRunRecord, so a run never finalizes with an attempt on disk that its own membership omits", async () => {
    const root = temporaryRoot();
    const casePlan = casePlanFixture();
    const runId = "run-lock-race";
    setUpRun(root, runId, [casePlan]);
    await publishAttempt(
      root,
      runId,
      attemptFixture(casePlan, 0),
      completeEvidence(Buffer.from("attempt-0")),
    );

    const retryEvidence = completeEvidence(Buffer.from("attempt-1"));
    const publishPayload = JSON.stringify({
      attempt: attemptFixture(casePlan, 1),
      files: Object.fromEntries(
        Object.entries(retryEvidence).map(([kind, bytes]) => [kind, bytes.toString("base64")]),
      ),
    });
    const finalizePayload = JSON.stringify({ retryAcceptance: "require-first-attempt" });

    // The publish worker holds the lock for 300ms once it acquires it (see attempt.ts's
    // own test-only FRAMELIA_TEST_ATTEMPT_HOLD_MS seam) -- long enough that a finalize
    // worker started shortly after is virtually guaranteed to still be waiting for the
    // lock when the publish is mid-flight, the exact window the fix closes.
    const publishPromise = runWorker(["publish", root, runId, publishPayload], {
      FRAMELIA_TEST_ATTEMPT_HOLD_MS: "300",
    });
    await sleep(50);
    const finalizePromise = runWorker(["finalize", root, runId, finalizePayload]);

    const [publishResult, finalizeResult] = await Promise.all([publishPromise, finalizePromise]);
    expect(publishResult.code, `publish worker output:\n${publishResult.output}`).toBe(0);
    expect(finalizeResult.code, `finalize worker output:\n${finalizeResult.output}`).toBe(0);

    // The whole point: reading the bundle back must never throw -- readRunBundle's own
    // exact-membership check (see read.ts) is exactly what would catch a torn state
    // where attempt-1 landed on disk after finalization already sealed the run without
    // it. Because finalize necessarily waited for the still-lock-holding publish to
    // finish first (the 50ms head start plus a 300ms hold make any other ordering
    // implausible), both attempts end up correctly reflected in the finalized record.
    const bundle = readRunBundle(root, runId);
    expect(bundle.record.status).toBe("finalized");
    const caseRecord = bundle.record.cases[0]!;
    expect(caseRecord.attemptIds.toSorted()).toEqual(
      [computeAttemptId(casePlan.caseId, 0), computeAttemptId(casePlan.caseId, 1)].toSorted(),
    );
  }, 20_000);
});
