// Shared run-bundle fixtures for the run-bundle test files: case plans whose every
// digest-bearing input genuinely exists on disk, attempts, and complete evidence.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ATTEMPT_FORMAT_VERSION,
  ATTEMPT_SCORE_FORMAT_VERSION,
  authoredContractSchema,
  baselineSnapshotSchema,
  CASE_PLAN_FORMAT_VERSION,
  casePlanSchema,
  contractBindingSchema,
  type AttemptRecord,
  type CasePlan,
} from "@framelia/contracts/workflow";
import { PNG } from "pngjs";

import { canonicalJsonDigest } from "../../src/canonical-json.ts";
import { resolveProjectPolicy } from "../../src/project-policy.ts";
import { computeAttemptId, computeCaseId } from "../../src/run-bundle/index.ts";
import { makeSolidPng } from "../../src/testing.ts";

export const A_DIGEST = `sha256:${"a".repeat(64)}`;

/**
 * A case plan whose every digest-bearing input genuinely exists on disk under `root` and
 * matches what's recorded -- `finalizeRunRecord`'s own input reconciliation reports this
 * as fully consistent. Used by the handful of tests that actually exercise selection
 * logic (`selectFinalAttempt`) or reconciliation itself, where a synthetic, always-
 * "changed" fixture would mask what's really being tested.
 */
export async function realCasePlanFixture(
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

export function attemptFixture(
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

export function completeEvidence(actual: Buffer): {
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
