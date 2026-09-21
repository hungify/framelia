import * as fs from "node:fs";
import * as path from "node:path";

import {
  captureEvidenceSchema,
  deriveCaptureEvidenceDiagnostics,
  projectCaptureEvidence,
  resolveDisplayThreshold,
  resolveStyleGateEligible,
} from "@framelia/contracts";
import {
  ATTEMPT_FORMAT_VERSION,
  ATTEMPT_SCORE_FORMAT_VERSION,
  attemptScoreSchema,
  authoredContractSchema,
  CASE_PLAN_FORMAT_VERSION,
  casePlanSchema,
  testRegistrationSchema,
  type AttemptRecord,
  type AttemptScore,
  type CasePlan,
  type Diagnostic,
  type SourceIdentity,
  type TestRegistration,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, readPinnedBaseline, type CanonicalJsonValue } from "@framelia/verify";
import {
  computeAttemptId,
  computeCaseId,
  type AttemptEvidenceFiles,
} from "@framelia/verify/run-bundle";
import type { FullProject, Suite, TestCase, TestResult } from "@playwright/test/reporter";

import { CONTRACT_ANNOTATION_TYPE } from "./define-figma-tests.ts";
import { attachmentPath, readScoreAttachments } from "./report-projection.ts";
import type { FrameliaScoreAttachment } from "./score-attachment.ts";

/** Reads the `framelia.contract` annotation `defineFigmaTests` puts on every test it
 *  registers (see that module's own doc comment) -- the contract binding plus this
 *  test's own registration-time spec-file digest. `undefined` for any ordinary test
 *  that isn't one of its registrations -- run-bundle publication only ever covers
 *  those. */
export function readContractRegistration(test: TestCase): TestRegistration | undefined {
  const annotation = (test.annotations ?? []).find(
    (candidate) => candidate.type === CONTRACT_ANNOTATION_TYPE,
  );
  if (!annotation?.description) return undefined;
  try {
    return testRegistrationSchema.parse(JSON.parse(annotation.description));
  } catch {
    // A foreign/malformed annotation sharing the same `type` string must never crash the
    // reporter -- treat it as "not one of ours" rather than propagate a parse error.
    return undefined;
  }
}

/** Walks a `TestCase`'s parent suite chain up to the enclosing `type: "file"` Suite --
 *  Playwright's own collected-file-suite record, tracked independently of wherever a
 *  registering library's own `test(...)` call happens to live textually. */
function findFileSuite(suite: Suite | undefined): Suite | undefined {
  let current = suite;
  while (current) {
    if (current.type === "file") return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * "Project runtime identity" for a case plan's `project.runtimeDigest` (workflow-
 * records.ts's own text doesn't fully pin this down -- see this repo's PR description for
 * the judgment call): the resolved Playwright project's name plus its own `use.viewport`/
 * `use.deviceScaleFactor` -- the two `use` options that directly affect what a visual
 * capture looks like. Any other `use` option (locale, colorScheme, storageState, ...)
 * either doesn't bear on pixel output or is already covered by the contract/policy
 * digests elsewhere in the case plan.
 */
function computeProjectRuntimeDigest(project: FullProject | undefined): `sha256:${string}` {
  const relevant = {
    name: project?.name ?? null,
    viewport: (project?.use.viewport ?? null) as CanonicalJsonValue,
    deviceScaleFactor: project?.use.deviceScaleFactor ?? null,
  };
  return canonicalJsonDigest(relevant);
}

export interface CasePlanBuildResult {
  testId: string;
  caseId: string;
  casePlan: CasePlan;
}

export interface CasePlanBuildContext {
  projectRoot: string;
  runId: string;
  policyDigest: `sha256:${string}`;
  retryAcceptance: "require-first-attempt" | "allow-passed-after-retry";
  maxMaskedAreaRatio: number;
  stabilitySamples: number;
  source: SourceIdentity;
}

/**
 * Builds one test's frozen `CasePlan`, reconciling its `framelia.contract` binding against
 * the contract file's *current* on-disk bytes (not just trusting the annotation recorded
 * at collection time) and its pinned baseline snapshot -- see #77's own "Reconcile changed
 * contract/policy/binding/snapshot inputs before capture and finalization" requirement.
 * Throws if the contract has drifted since collection (changed planning inputs must
 * invalidate the run, even though the test's own id/title never changed).
 *
 * `specFileDigest` is read straight from the `framelia.contract` annotation's own
 * `specDigest` (`registration.specDigest`), NOT independently re-hashed from disk here
 * at `onBegin` time. Playwright imports every spec file (running `defineFigmaTests`
 * synchronously, once, per file) strictly before any Reporter's `onBegin` runs;
 * re-hashing the file fresh from disk at this later point would freeze whatever
 * content happens to be on disk *right now*, which can already differ from what Node
 * actually imported and will actually execute for every attempt of this test, if the
 * file was edited in between. `defineFigmaTests`'s own `specUrl` option hashes the file
 * synchronously at true import time -- the only point that can ever observe the
 * actually-executing bytes -- and freezes that digest into the annotation; this
 * function only ever propagates it. `registration.specFile` -- the portable path
 * `specUrl` resolved to at registration time -- is cross-checked against the real spec
 * file before that digest is trusted: without this, a caller could pass an arbitrary,
 * stable, unrelated `specUrl` whose digest has nothing to do with what's actually
 * executing, and nothing would ever catch it. The real spec file is resolved via the
 * enclosing `type: "file"` Suite's own `.title` (Playwright's own collected-file-suite
 * record, relative to the resolved project's own `testDir`) -- NOT `test.location.file`
 * (a stack-trace-derived "where was `test(...)` textually called," which for every
 * `defineFigmaTests` registration is this library's own call site, never the real
 * caller spec file; confirmed empirically against a real `playwright test` run).
 *
 * Resolves `binding.contractFile` against `context.projectRoot` -- the Reporter's own
 * project root, not each contract file's independently-discovered nearest-config
 * ancestor (`defineFigmaTests`'s own default when no `options.projectRoot` override is
 * given). These agree for the overwhelmingly common case of one project root shared by
 * the Playwright config and every contract file; a multi-root workspace where a
 * contract's own discovered root diverges from the Reporter's is a known, deliberately
 * flagged limitation -- reconciliation fails loudly (a read/parse/digest error) rather
 * than silently building a case plan against the wrong file.
 */
export async function buildCasePlanForTest(
  test: TestCase,
  context: CasePlanBuildContext,
): Promise<CasePlanBuildResult> {
  const registration = readContractRegistration(test);
  if (!registration) {
    throw new Error(`buildCasePlanForTest: test ${test.id} has no framelia.contract annotation.`);
  }
  const { binding } = registration;

  const contractPath = path.resolve(context.projectRoot, binding.contractFile);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    throw new Error(
      `run-bundle: cannot read contract "${binding.contractId}" at ${contractPath} while freezing its case plan.`,
      { cause: error },
    );
  }
  const contract = authoredContractSchema.parse(parsed);
  const contractDigest = canonicalJsonDigest(contract);
  if (contractDigest !== binding.contractDigest) {
    throw new Error(
      `run-bundle: contract "${binding.contractId}" at ${contractPath} has changed since collection (recomputed digest ${contractDigest} != binding digest ${binding.contractDigest}). Changed planning inputs invalidate the run -- reconcile the contract before freezing it.`,
    );
  }

  // readPinnedBaseline re-validates the pinned snapshot record and its backing image
  // bytes against contract.baseline.snapshotDigest; a stale/tampered baseline fails here,
  // before the run is ever frozen, not silently at capture time.
  const pinnedBaseline = await readPinnedBaseline(context.projectRoot, contract);

  const project = test.parent.project();
  const fileSuite = findFileSuite(test.parent);
  if (!project || !fileSuite) {
    throw new Error(
      `run-bundle: test ${test.id} has no resolvable project/file suite to determine its spec file from.`,
    );
  }
  const specFile = path.resolve(project.testDir, fileSuite.title);
  const specFileRelative = path.relative(context.projectRoot, specFile).split(path.sep).join("/");
  if (registration.specFile !== specFileRelative) {
    throw new Error(
      `run-bundle: test ${test.id}'s registered specUrl (${registration.specFile}) does not match the file Playwright says registered this test (${specFileRelative}) -- refusing to freeze a case plan whose declared spec identity doesn't match its actual location.`,
    );
  }

  const projectName = project.name;
  const caseId = computeCaseId({
    contractId: contract.id,
    projectName,
    repeatIndex: test.repeatEachIndex,
  });

  const casePlan = casePlanSchema.parse({
    formatVersion: CASE_PLAN_FORMAT_VERSION,
    kind: "framelia.case-plan",
    runId: context.runId,
    caseId,
    contract: {
      id: contract.id,
      file: binding.contractFile,
      digest: binding.contractDigest,
      authored: contract,
    },
    snapshotDigest: contract.baseline.snapshotDigest,
    expectedDigest: pinnedBaseline.snapshot.expected.image.digest,
    expectedSize: {
      width: pinnedBaseline.snapshot.expected.image.width,
      height: pinnedBaseline.snapshot.expected.image.height,
    },
    baselineSource: pinnedBaseline.snapshot.source,
    maxMaskedAreaRatio: context.maxMaskedAreaRatio,
    stabilitySamples: context.stabilitySamples,
    policyDigest: context.policyDigest,
    bindingDigest: canonicalJsonDigest(binding),
    binding,
    registration: {
      specFile: registration.specFile,
      specDigest: registration.specDigest,
      titlePath: test.titlePath(),
    },
    specFile: specFileRelative,
    specFileDigest: registration.specDigest,
    project: { name: projectName, runtimeDigest: computeProjectRuntimeDigest(project) },
    repeatIndex: test.repeatEachIndex,
    retryAcceptance: context.retryAcceptance,
    source: context.source,
  } satisfies CasePlan);

  return { testId: test.id, caseId, casePlan };
}

/** Every `framelia.contract`-annotated test in the collected suite -- see `Suite.allTests()`. */
export function contractAnnotatedTests(suite: Suite): TestCase[] {
  return suite.allTests().filter((test) => readContractRegistration(test) !== undefined);
}

function mapAttemptOutcome(
  status: TestResult["status"],
  score: FrameliaScoreAttachment | undefined,
): Pick<AttemptRecord, "executionState" | "visualVerdict"> {
  switch (status) {
    case "passed":
      // A "passed" Playwright result with no score attachment at all (an annotated test
      // whose body never actually ran runFigmaContractTest) has nothing to evaluate.
      return {
        executionState: "completed",
        visualVerdict: score ? (score.pass ? "passed" : "mismatched") : "not-evaluated",
      };
    case "failed":
      // score.pass can disagree with the coarse pass/fail label (a non-visual assertion
      // failed after a passing comparison) -- visualVerdict is specifically about
      // whether the *visual* comparison passed, so the score is authoritative here. No
      // score at all means the failure happened before any comparison ran (navigation,
      // prepare(), a thrown setup error): that's "error", never a definitive verdict.
      return score
        ? { executionState: "completed", visualVerdict: score.pass ? "passed" : "mismatched" }
        : { executionState: "error", visualVerdict: "not-evaluated" };
    case "timedOut":
    case "interrupted":
      return { executionState: "incomplete", visualVerdict: "not-evaluated" };
    case "skipped":
      return { executionState: "blocked", visualVerdict: "not-evaluated" };
    default:
      return { executionState: "error", visualVerdict: "not-evaluated" };
  }
}

function sanitizeExecutionMessage(message: string, projectRoot: string): string {
  const root = path.resolve(projectRoot);
  return message
    .replaceAll(`file://${root}`, "file://<project-root>")
    .replaceAll(root, "<project-root>");
}

function sanitizePortableValue<T>(value: T, projectRoot: string): T {
  if (typeof value === "string") {
    return sanitizeExecutionMessage(value, projectRoot) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePortableValue(entry, projectRoot)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizePortableValue(entry, projectRoot)]),
    ) as T;
  }
  return value;
}

function buildDiagnostics(
  result: TestResult,
  score: FrameliaScoreAttachment | undefined,
  projectRoot: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (result.error?.message) {
    diagnostics.push({
      code: "test-error",
      stage: "execution",
      message: sanitizeExecutionMessage(result.error.message, projectRoot),
    });
  }
  for (const issue of score?.topIssues ?? []) {
    diagnostics.push({
      code: issue.kind,
      stage: "compare",
      message: sanitizeExecutionMessage(issue.message, projectRoot),
      ...(issue.selector
        ? { selector: sanitizeExecutionMessage(issue.selector, projectRoot) }
        : {}),
    });
  }
  for (const warning of score?.warnings ?? []) {
    diagnostics.push({
      code: "warning",
      stage: "capture",
      message: sanitizeExecutionMessage(warning, projectRoot),
    });
  }
  return diagnostics;
}

export interface AttemptBuildResult {
  record: Omit<AttemptRecord, "evidence">;
  files: AttemptEvidenceFiles;
}

function portableCaptureEvidence(
  evidence: NonNullable<FrameliaScoreAttachment["captureEvidence"]>,
): unknown {
  return {
    finalUrl: evidence.finalUrl,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    capturedAt: evidence.capturedAt,
    viewport: evidence.viewport,
    scope: evidence.scope,
    elementRect: evidence.elementRect,
    readiness: evidence.readiness,
    fonts: {
      supported: evidence.fonts.supported,
      status: evidence.fonts.status,
      failed: evidence.fonts.failed,
    },
    screenshotHashes: evidence.screenshotHashes,
    warnings: evidence.warnings,
    actions: evidence.actions,
    ...(evidence.maskEvidence !== undefined ? { maskEvidence: evidence.maskEvidence } : {}),
  };
}

function buildPortableScore(
  score: FrameliaScoreAttachment,
  casePlan: CasePlan,
  projectRoot: string,
): AttemptScore {
  const contract = casePlan.contract.authored;
  const scope =
    score.scope ??
    (contract.scope.kind === "page"
      ? { kind: "page" as const, fullPage: false }
      : {
          kind: "region" as const,
          selector: contract.scope.selector,
          ...(contract.scope.expectSize ? { expectedSize: contract.scope.expectSize } : {}),
        });
  const profile =
    score.profile ??
    contract.profile ??
    (contract.scope.kind === "page" ? "page" : "component/strict");
  const resolvedThreshold = resolveDisplayThreshold({
    profile,
    profileOverrides: score.profileOverrides,
    clusterCheck: score.clusterCheck,
  });
  const screenshotHashes = score.captureEvidence?.screenshotHashes ?? [];
  const stability =
    screenshotHashes.length !== casePlan.stabilitySamples
      ? "unknown"
      : new Set(screenshotHashes).size === 1
        ? "stable"
        : "borderline";
  const diagnostics = deriveCaptureEvidenceDiagnostics(
    score.captureEvidence
      ? projectCaptureEvidence(captureEvidenceSchema.parse(score.captureEvidence), score.targetUrl)
      : undefined,
    [],
  );
  return attemptScoreSchema.parse(
    sanitizePortableValue(
      {
        formatVersion: ATTEMPT_SCORE_FORMAT_VERSION,
        kind: "framelia.attempt-score",
        runType: "final",
        pass: score.pass,
        matchRatio: score.matchRatio,
        ssim: score.ssim,
        avgDeltaE: score.avgDeltaE,
        diffPixels: score.diffPixels,
        baselineSize: score.baselineSize,
        actualSize: score.actualSize,
        targetUrl: score.targetUrl,
        baseline: {
          snapshotDigest: casePlan.snapshotDigest,
          kind: score.baselineKind,
          ...(score.fileKey ? { fileKey: score.fileKey } : {}),
          ...(score.nodeId ? { nodeId: score.nodeId } : {}),
          ...(score.baselineFetchedAt ? { fetchedAt: score.baselineFetchedAt } : {}),
          ...(score.baselineLastModified !== undefined
            ? { lastModified: score.baselineLastModified }
            : {}),
          ...(score.baselinePromotedAt ? { promotedAt: score.baselinePromotedAt } : {}),
          ...(score.baselinePromotedBy ? { promotedBy: score.baselinePromotedBy } : {}),
          ...(score.baselineVersion ? { version: score.baselineVersion } : {}),
          ...(score.baselineRunId ? { sourceRunId: score.baselineRunId } : {}),
        },
        resolvedThreshold: {
          ...resolvedThreshold,
          gateEligible:
            score.gateEligible ?? contract.gateEligible ?? resolvedThreshold.gateEligible,
          styleGateEligible: resolveStyleGateEligible({
            profile,
            styleGateEligible: score.styleGateEligible ?? contract.styleGateEligible,
          }),
        },
        attachmentBaseName: score.attachmentBaseName ?? "framelia-score",
        profile,
        ...(score.clusterCheck !== undefined ? { clusterCheck: score.clusterCheck } : {}),
        ...(score.styleToleranceOverrides
          ? { styleToleranceOverrides: score.styleToleranceOverrides }
          : {}),
        ...(score.profileOverrides ? { profileOverrides: score.profileOverrides } : {}),
        ...(score.gateEligible !== undefined ? { gateEligible: score.gateEligible } : {}),
        ...(score.styleGateEligible !== undefined
          ? { styleGateEligible: score.styleGateEligible }
          : {}),
        scope,
        ...(score.masks ? { masks: score.masks } : {}),
        maxMaskedAreaRatio: score.maxMaskedAreaRatio ?? casePlan.maxMaskedAreaRatio,
        ...(score.captureEvidence
          ? { captureEvidence: portableCaptureEvidence(score.captureEvidence) }
          : {}),
        ...(score.captureEvidence?.maskEvidence
          ? { maskEvidence: score.captureEvidence.maskEvidence }
          : {}),
        stability,
        stabilitySampleCount: screenshotHashes.length,
        topIssues: score.topIssues ?? [],
        diagnostics,
        warnings: score.warnings ?? [],
      },
      projectRoot,
    ),
  );
}

/**
 * Builds one attempt's record + evidence buffers from a completed `TestResult`, reading
 * the exact same `-expected`/`-actual`/`-diff` image attachments and `*-framelia-score`
 * JSON attachment `defineFigmaTests`'s `runFigmaContractTest` already produces (via
 * `attachDiffTriplet`/`attachJson`) -- see `readScoreAttachments`/`attachmentPath` in
 * report-projection.ts, reused verbatim rather than a second attachment convention.
 * `retryIndex` (and therefore `attemptId`) comes from `result.retry`, matching
 * Playwright's own per-attempt retry counter.
 */
export function buildAttemptRecord(
  result: TestResult,
  runId: string,
  casePlan: CasePlan,
  projectRoot: string,
): AttemptBuildResult {
  const [score] = readScoreAttachments(result);
  const { executionState, visualVerdict } = mapAttemptOutcome(result.status, score);
  const attemptId = computeAttemptId(casePlan.caseId, result.retry);

  const record: Omit<AttemptRecord, "evidence"> = {
    formatVersion: ATTEMPT_FORMAT_VERSION,
    kind: "framelia.attempt",
    attemptId,
    runId,
    caseId: casePlan.caseId,
    casePlanDigest: canonicalJsonDigest(casePlan),
    retryIndex: result.retry,
    executionState,
    visualVerdict,
    startedAt: result.startTime.toISOString(),
    ...(executionState === "completed"
      ? { completedAt: new Date(result.startTime.getTime() + result.duration).toISOString() }
      : {}),
    diagnostics: buildDiagnostics(result, score, projectRoot),
  };
  const files: AttemptEvidenceFiles = {};
  const baseName = score?.attachmentBaseName;
  if (baseName) {
    for (const [key, suffix] of [
      ["expected", "-expected"],
      ["actual", "-actual"],
      ["diff", "-diff"],
    ] as const) {
      const attachmentFilePath = attachmentPath(result, baseName, suffix);
      if (attachmentFilePath && fs.existsSync(attachmentFilePath)) {
        files[key] = fs.readFileSync(attachmentFilePath);
      }
    }
  }
  if (score) {
    files.score = Buffer.from(
      `${JSON.stringify(buildPortableScore(score, casePlan, projectRoot), null, 2)}\n`,
    );
  }

  return { record, files };
}
