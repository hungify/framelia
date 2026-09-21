import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ATTEMPT_FORMAT_VERSION,
  ATTEMPT_SCORE_FORMAT_VERSION,
  AUTHORITATIVE_REQUIREMENTS_FORMAT_VERSION,
  CASE_PLAN_FORMAT_VERSION,
  RUN_FORMAT_VERSION,
  RUN_PLAN_FORMAT_VERSION,
  type AttemptRecord,
  type AuthoritativeRunRequirements,
  type CasePlan,
  type RunPlan,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest } from "@framelia/verify";
import {
  computeAttemptId,
  computeCaseId,
  freezeRunPlan,
  publishAttempt,
  publishRunRecord,
} from "@framelia/verify/run-bundle";

export const FIXTURE_DIGEST = `sha256:${"a".repeat(64)}`;
export const FIXTURE_BUILD_DIGEST = `sha256:${"b".repeat(64)}`;
export const FIXTURE_SOURCE_DIGEST = `sha256:${"c".repeat(64)}`;
const EXPECTED_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3K/SWQAAAABJRU5ErkJggg==",
  "base64",
);
const EXPECTED_DIGEST =
  `sha256:${crypto.createHash("sha256").update(EXPECTED_BYTES).digest("hex")}` as const;

function score(
  pass: boolean,
  styleGateEligible = false,
  stabilitySamples = 2,
  unstableLastSample = false,
  portableSentinel?: string,
): Buffer {
  return Buffer.from(
    `${JSON.stringify({
      formatVersion: ATTEMPT_SCORE_FORMAT_VERSION,
      kind: "framelia.attempt-score",
      runType: "final",
      pass,
      matchRatio: pass ? 1 : 0.9,
      ssim: pass ? 1 : 0.9,
      avgDeltaE: pass ? 0 : 5,
      diffPixels: pass ? 0 : 10,
      baselineSize: { width: 10, height: 10 },
      actualSize: { width: 10, height: 10 },
      targetUrl: "http://localhost:4173/login",
      baseline: {
        snapshotDigest: FIXTURE_DIGEST,
        kind: "figma",
        fileKey: "file-key",
        nodeId: "1:2",
      },
      attachmentBaseName: "login",
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
        styleGateEligible,
      },
      profile: "page",
      ...(styleGateEligible ? { styleGateEligible: true } : {}),
      scope: { kind: "page", fullPage: false },
      captureEvidence: {
        finalUrl: "http://localhost:4173/login",
        startedAt: "2026-09-15T00:00:00.000Z",
        finishedAt: "2026-09-15T00:00:01.000Z",
        capturedAt: "2026-09-15T00:00:01.000Z",
        viewport: { width: 10, height: 10 },
        scope: { kind: "page", fullPage: false },
        elementRect: null,
        readiness: { status: "passed" },
        fonts: { supported: true, status: "loaded", failed: [] },
        screenshotHashes: Array.from({ length: stabilitySamples }, (_, index) =>
          unstableLastSample && index === stabilitySamples - 1
            ? `sha256:${"d".repeat(64)}`
            : FIXTURE_DIGEST,
        ),
        warnings: [],
        actions: [],
      },
      stability: "stable",
      stabilitySampleCount: stabilitySamples,
      maxMaskedAreaRatio: 0.25,
      topIssues: styleGateEligible
        ? [
            {
              severity: "low",
              kind: "style-color",
              message: "expected black, rendered gray",
              repairCandidate: true,
              blocking: false,
            },
          ]
        : portableSentinel
          ? [
              {
                severity: "low",
                kind: "color",
                message: `mismatch from ${portableSentinel}`,
                repairCandidate: true,
                blocking: false,
              },
            ]
          : [],
      diagnostics: [],
      warnings: portableSentinel ? [`warning from ${portableSentinel}`] : [],
    })}\n`,
  );
}

export async function createSelectedRun(
  root: string,
  options: {
    runId?: string;
    attempts?: boolean[];
    source?: CasePlan["source"];
    policyDigest?: string;
    retryAcceptance?: "require-first-attempt" | "allow-passed-after-retry";
    styleGateEligible?: boolean;
    stabilitySamples?: number;
    unstableLastSample?: boolean;
    portableSentinel?: string;
  } = {},
): Promise<{ casePlan: CasePlan; plan: RunPlan; requirements: AuthoritativeRunRequirements }> {
  const runId = options.runId ?? "run-selected";
  const policyDigest = options.policyDigest ?? FIXTURE_DIGEST;
  const contractId = "login.desktop";
  const contractFile = "contracts/login.json";
  const specFile = "tests/login.spec.ts";
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  const retryAcceptance = options.retryAcceptance ?? "require-first-attempt";
  const authored = {
    formatVersion: 1 as const,
    kind: "framelia.contract" as const,
    id: contractId,
    name: "Login desktop",
    revision: 1,
    target: { path: "/login" },
    viewport: { preset: "desktop", width: 10, height: 10 },
    scope: { kind: "page" as const, pageReason: "release page" },
    baseline: { snapshotDigest: FIXTURE_DIGEST },
    ...(options.styleGateEligible ? { styleGateEligible: true } : {}),
    required: true,
  };
  fs.writeFileSync(path.join(root, contractFile), JSON.stringify(authored));
  fs.writeFileSync(path.join(root, specFile), "// selected run fixture\n");
  const binding = {
    formatVersion: 1 as const,
    kind: "framelia.contract-binding" as const,
    contractId,
    contractFile,
    contractDigest: canonicalJsonDigest(authored),
  };
  const caseId = computeCaseId({ contractId, projectName: "chromium", repeatIndex: 0 });
  const casePlan: CasePlan = {
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    runId,
    caseId,
    contract: {
      id: contractId,
      file: contractFile,
      digest: binding.contractDigest,
      authored,
    },
    snapshotDigest: FIXTURE_DIGEST,
    expectedDigest: EXPECTED_DIGEST,
    maxMaskedAreaRatio: 0.25,
    stabilitySamples: options.stabilitySamples ?? 2,
    expectedSize: { width: 10, height: 10 },
    baselineSource: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    policyDigest,
    bindingDigest: canonicalJsonDigest(binding),
    binding,
    registration: { specFile, specDigest: FIXTURE_DIGEST, titlePath: ["chromium", "login"] },
    specFile,
    specFileDigest: FIXTURE_DIGEST,
    project: { name: "chromium", runtimeDigest: FIXTURE_DIGEST },
    repeatIndex: 0,
    retryAcceptance,
    source: options.source ?? {
      sourceDigest: FIXTURE_SOURCE_DIGEST,
      buildDigest: FIXTURE_BUILD_DIGEST,
      dirty: false,
    },
  };
  const casePlanDigest = canonicalJsonDigest(casePlan);
  const planned = { caseId, casePlanDigest };
  const plan: RunPlan = {
    formatVersion: RUN_PLAN_FORMAT_VERSION,
    kind: "framelia.run-plan",
    runId,
    policyDigest,
    retryAcceptance,
    selection: { mode: "all", contracts: [contractId] },
    availableCases: [planned],
    requiredCases: [planned],
    selectedCases: [planned],
  };
  freezeRunPlan(root, plan, [casePlan]);

  const attempts = options.attempts ?? [true];
  const attemptIds: string[] = [];
  for (const [retryIndex, pass] of attempts.entries()) {
    const attemptId = computeAttemptId(caseId, retryIndex);
    const record: Omit<AttemptRecord, "evidence"> = {
      formatVersion: ATTEMPT_FORMAT_VERSION,
      kind: "framelia.attempt",
      runId,
      attemptId,
      caseId,
      casePlanDigest,
      retryIndex,
      executionState: "completed",
      visualVerdict: pass ? "passed" : "mismatched",
      startedAt: `2026-09-15T00:00:0${retryIndex}.000Z`,
      completedAt: `2026-09-15T00:00:0${retryIndex + 1}.000Z`,
      diagnostics: pass ? [] : [{ code: "pixel", stage: "compare", message: "10 pixels differ" }],
    };
    await publishAttempt(root, runId, record, {
      expected: EXPECTED_BYTES,
      actual: EXPECTED_BYTES,
      ...(pass ? {} : { diff: EXPECTED_BYTES }),
      score: score(
        pass,
        options.styleGateEligible,
        options.stabilitySamples,
        options.unstableLastSample,
        options.portableSentinel,
      ),
    });
    attemptIds.push(attemptId);
  }
  publishRunRecord(root, {
    formatVersion: RUN_FORMAT_VERSION,
    kind: "framelia.run",
    runId,
    planDigest: canonicalJsonDigest(plan),
    status: "finalized",
    createdAt: "2026-09-15T00:00:00.000Z",
    finalizedAt: "2026-09-15T00:00:10.000Z",
    cases: [
      {
        caseId,
        attemptIds,
        selectedAttemptId:
          retryAcceptance === "require-first-attempt" ? attemptIds[0] : attemptIds.at(-1),
      },
    ],
  });

  const requirements: AuthoritativeRunRequirements = {
    formatVersion: AUTHORITATIVE_REQUIREMENTS_FORMAT_VERSION,
    kind: "framelia.authoritative-run-requirements",
    requiredCases: [
      {
        caseId,
        contractId,
        projectName: "chromium",
        repeatIndex: 0,
        casePlanDigest,
        contractDigest: binding.contractDigest,
        bindingDigest: casePlan.bindingDigest,
        specFile,
        specFileDigest: casePlan.specFileDigest,
        titlePath: casePlan.registration.titlePath,
      },
    ],
    policyDigest,
    source: {
      sourceDigest: FIXTURE_SOURCE_DIGEST,
      buildDigest: FIXTURE_BUILD_DIGEST,
      dirty: false,
    },
    servedBuild: {
      mode: "ci-owned",
      observedBuildDigest: FIXTURE_BUILD_DIGEST,
      freshServerOwnedByJob: true,
      jobIdentity: "fixture-job",
    },
    retryAcceptance,
  };
  return { casePlan, plan, requirements };
}
