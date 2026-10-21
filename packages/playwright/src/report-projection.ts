import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
  visualArtifactPath,
  visualScoreArtifactSchema,
  type BaselineSource,
  type CaptureEvidenceArtifact,
  type DashboardContractResult,
} from "@framelia/contracts";
import {
  FIGMA_BASELINE_ARTIFACT,
  JSON_INDENT_SPACES,
  RUN_ARTIFACT,
  SCHEMA_VERSION,
  WEB_BASELINE_ARTIFACT,
} from "@framelia/verify";
import type { TestCase, TestResult } from "@playwright/test/reporter";

import { SCORE_ATTACHMENT_SUFFIX } from "./attach.ts";
import type { FrameliaScoreAttachment } from "./score-attachment.ts";

export const FALLBACK_TARGET_URL = "http://localhost/";
const SYNTHETIC_PAGE_REASON = "framelia-playwright-reporter";

/**
 * The contract/request schema requires an http(s) URL. A matcher's `received`
 * page is frequently never navigated with a real URL at all -- `page.setContent()`
 * leaves `page.url()` as "about:blank", and data:/file: pages are possible too
 * -- so targetUrl needs validating, not just defaulting on absence.
 */
function httpTargetUrl(candidate: string | undefined): string {
  if (!candidate) return FALLBACK_TARGET_URL;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : FALLBACK_TARGET_URL;
  } catch {
    return FALLBACK_TARGET_URL;
  }
}

export function sanitizeTestId(test: TestCase): string {
  return test.id.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
}

/** Like sanitizeTestId, but keeps dots (a contractId like "login.desktop" reads literally)
 *  and collapses any run of dots so it can't spell a ".." traversal segment. */
export function sanitizeContractId(contractId: string): string {
  return contractId.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/\.{2,}/g, ".");
}

/** Durable evidence folder segments for a contractId, e.g. ("login.desktop", "page") ->
 *  ["login", "desktop.page"] -- mirrors how `framelia contract create` groups by feature. */
export function contractDirSegments(contractId: string, leafSuffix: string): string[] {
  const sanitized = sanitizeContractId(contractId);
  const dotIndex = sanitized.indexOf(".");
  if (dotIndex === -1) return [`${sanitized}.${leafSuffix}`];
  const feature = sanitized.slice(0, dotIndex);
  const leaf = sanitized.slice(dotIndex + 1);
  return [feature, `${leaf}.${leafSuffix}`];
}

export function contractNameFor(test: TestCase): string {
  return test.titlePath().slice(1).join(" › ") || test.title;
}

function isScoreSize(value: unknown): value is { width: number; height: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { width: unknown }).width === "number" &&
    typeof (value as { height: unknown }).height === "number"
  );
}

/**
 * Reads every `*-framelia-score` JSON attachment off a TestResult. The
 * Reporter runs in the main process while tests run in worker processes, so
 * this -- not a shared in-memory value -- is the only channel back (see
 * to-match-figma.ts's doc comment on runToMatchFigma for the same
 * process-boundary reasoning applied to test.info()).
 */
export function readScoreAttachments(result: TestResult): FrameliaScoreAttachment[] {
  const scores: FrameliaScoreAttachment[] = [];
  for (const attachment of result.attachments) {
    if (!attachment.name.endsWith(SCORE_ATTACHMENT_SUFFIX)) continue;
    try {
      const raw = attachment.body
        ? attachment.body.toString("utf8")
        : attachment.path
          ? fs.readFileSync(attachment.path, "utf8")
          : undefined;
      if (!raw) continue;
      const parsed = JSON.parse(raw) as FrameliaScoreAttachment;
      if (!isScoreSize(parsed.actualSize) || !isScoreSize(parsed.baselineSize)) continue;
      scores.push({
        ...parsed,
        attachmentBaseName:
          parsed.attachmentBaseName ?? attachment.name.slice(0, -SCORE_ATTACHMENT_SUFFIX.length),
      });
    } catch {
      // Malformed or unreadable score attachment: skip it rather than crash the reporter.
    }
  }
  return scores;
}

/** Live dashboard's evidence virtual path -- must match the `contracts/${id}/${name}` keys onTestEnd registers into ReporterStore's file map (see writeEvidence's callers). */
function dashboardArtifactPath(id: string, name: string): string {
  return `contracts/${encodeURIComponent(id)}/${name}`;
}

export type EvidenceAttachment = TestResult["attachments"][number];

/** Finds one of the matcher's `-expected`/`-actual`/`-diff` image attachments off a
 *  TestResult. Exported so run-bundle-projection.ts's attempt builder reads the exact same
 *  attachments this module's own durable-evidence writers do, rather than a second,
 *  independently-maintained lookup convention. */
export function findEvidenceAttachment(
  result: TestResult,
  baseName: string,
  suffix: "-expected" | "-actual" | "-diff",
): EvidenceAttachment | undefined {
  return result.attachments.find(
    (attachment) =>
      attachment.name === `${baseName}${suffix}` &&
      (attachment.body !== undefined || attachment.path !== undefined),
  );
}

/** An attachment's bytes: its `body` (how this package's matchers attach images -- see
 *  `buildAttachContext`), else its `path` while that file still exists. A path-only
 *  attachment can vanish once Playwright removes the test's `outputDir`. */
export function readAttachmentBytes(
  attachment: EvidenceAttachment | undefined,
): Buffer | undefined {
  if (!attachment) return undefined;
  if (attachment.body) return attachment.body;
  if (attachment.path && fs.existsSync(attachment.path)) return fs.readFileSync(attachment.path);
  return undefined;
}

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function dashboardStatusFor(result: TestResult): DashboardContractResult["status"] {
  switch (result.status) {
    case "passed":
      return "passed";
    case "skipped":
      return "blocked";
    default:
      return "failed";
  }
}

export interface DerivedContract {
  id: string;
  dashboardResult: DashboardContractResult;
  /** Figma matcher evidence is durable; live two-page (toMatchPage/toMatchUrl) results
   *  remain dashboard/runtime-only under R9 -- there is no stable baseline artifact to
   *  persist a pointer to. */
  writeEvidence?: {
    outDir: string;
    expected?: EvidenceAttachment;
    actual?: EvidenceAttachment;
    diff?: EvidenceAttachment;
    score: FrameliaScoreAttachment;
    baseline: BaselineSource;
    targetUrl: string;
  };
  /** Set only for a toMatchPageBaseline result (baselineKind "web" with a promoted
   *  baseline) -- unlike live two-page results, this one has a stable baseline artifact,
   *  so its image evidence remains useful to the low-level live dashboard. */
  writePageBaselineEvidence?: {
    outDir: string;
    expected?: EvidenceAttachment;
    actual?: EvidenceAttachment;
    diff?: EvidenceAttachment;
  };
}

export interface EvidenceKeyOptions {
  /** The run configures more than one Playwright project. The project name then joins a
   *  caller-supplied `contractId`'s evidence key, so the same contract checked in two
   *  projects can't overwrite one directory. Single-project runs keep the plain key. */
  multiProject?: boolean;
}

/**
 * `-<project>` (multi-project runs only) and `-r<n>` (`repeatEachIndex > 0` only) for a
 * `contractId`-keyed evidence directory -- the common single-project, non-repeated run
 * keeps the exact directory `framelia contract create` scaffolds. A test without a
 * `contractId` is keyed by its own Playwright test id, already unique per project/repeat.
 */
function evidenceVariantSuffix(test: TestCase, options: EvidenceKeyOptions): string {
  const parts: string[] = [];
  const projectName = test.parent?.project()?.name;
  if (options.multiProject && projectName) {
    parts.push(projectName.replaceAll(/[^a-zA-Z0-9-]+/g, "-"));
  }
  if (test.repeatEachIndex > 0) parts.push(`r${test.repeatEachIndex}`);
  return parts.map((part) => `-${part}`).join("");
}

/** Maps one matcher attachment to one durable Figma contract/evidence directory. */
export function deriveContract(
  test: TestCase,
  evidenceRoot: string,
  result: TestResult,
  score: FrameliaScoreAttachment | undefined,
  index: number,
  total: number,
  keyOptions: EvidenceKeyOptions = {},
): DerivedContract {
  // id stays flat ("login.desktop.page") since contractSchema's id field forbids "/".
  const scopeKind = score?.scope?.kind ?? "page";
  const variant = score?.contractId ? evidenceVariantSuffix(test, keyOptions) : "";
  const baseId = score?.contractId
    ? `${sanitizeContractId(score.contractId)}.${scopeKind}${variant}`
    : sanitizeTestId(test);
  const id = total === 1 ? baseId : `${baseId}-${index + 1}`;
  // Nests under the same feature folder `framelia contract create` uses, so CLI-authored
  // config and toMatchFigma evidence share one directory instead of two disconnected ones.
  const outDirSegments = score?.contractId
    ? contractDirSegments(
        score.contractId,
        total === 1 ? `${scopeKind}${variant}` : `${scopeKind}${variant}-${index + 1}`,
      )
    : [id];
  const relativeOutDir = visualArtifactPath(...outDirSegments);
  const absoluteOutDir = path.join(evidenceRoot, relativeOutDir);
  const primary = score;
  const pass = result.status === "passed";
  const targetUrl = httpTargetUrl(primary?.targetUrl);
  const isTerminal = result.status === "passed" || result.status === "failed";
  // CaptureEvidenceArtifact's `.loose()` schema gives it an index signature verify's
  // CaptureEvidence doesn't structurally declare, though the runtime shapes match field-for-field.
  const captureEvidence = primary
    ? projectCaptureEvidence(
        primary.captureEvidence as CaptureEvidenceArtifact | undefined,
        targetUrl,
      )
    : undefined;
  const diagnostics = captureEvidence ? deriveCaptureEvidenceDiagnostics(captureEvidence, []) : [];
  const maskApplied = captureEvidence?.maskEvidence?.status === "applied";
  const status = primary
    ? deriveDashboardVerdict({ resultOk: isTerminal, pass, diagnostics, maskApplied })
    : dashboardStatusFor(result);
  const scope = primary?.scope ?? { kind: "page" as const, fullPage: false };
  const regionExpectedSize =
    scope.kind === "region"
      ? (scope.expectedSize ?? captureEvidence?.elementRect ?? primary?.actualSize)
      : undefined;

  const dashboardResult = assembleContractResult({
    id,
    name: contractNameFor(test),
    tags: test.tags,
    status,
    baselineKind: primary?.baselineKind === "figma" ? "figma" : "page",
    capture: projectCapture({
      viewport: {
        width: primary?.actualSize.width || 1,
        height: primary?.actualSize.height || 1,
      },
      region:
        scope.kind === "region"
          ? {
              selector: scope.selector,
              matchCount: 1,
              stable: true,
              expectedSize: regionExpectedSize,
              actualSize: captureEvidence?.elementRect ?? undefined,
            }
          : undefined,
    }),
    blockers: pass
      ? []
      : [
          {
            code: isTerminal ? "MATCH_FAILED" : `TEST_${result.status.toUpperCase()}`,
            message:
              result.error?.message ??
              (isTerminal ? "Matcher assertion failed." : `Test ${result.status}.`),
          },
        ],
    ...(primary ? { score: primary } : {}),
    diagnostics,
    topIssues: primary?.topIssues ?? [],
    ...(captureEvidence?.maskEvidence ? { maskEvidence: captureEvidence.maskEvidence } : {}),
    finishedAt: new Date().toISOString(),
  });

  // Worth persisting for the dashboard (#41) even though it skips the schema-v4
  // VerificationArtifact/done-gate pipeline below (R9 still applies to that part).
  if (primary?.baselineKind === "web" && primary.baselinePromotedAt != null) {
    const baseName = primary.attachmentBaseName ?? "";
    const expected = findEvidenceAttachment(result, baseName, "-expected");
    const actual = findEvidenceAttachment(result, baseName, "-actual");
    const diff = findEvidenceAttachment(result, baseName, "-diff");
    const imageEvidence: Pick<
      DashboardContractResult,
      "baselineKey" | "baseline" | "actual" | "diff"
    > = {
      ...(primary.baselineKey !== undefined ? { baselineKey: primary.baselineKey } : {}),
      ...(expected
        ? {
            baseline: {
              path: dashboardArtifactPath(id, WEB_BASELINE_ARTIFACT.image),
              width: primary.baselineSize.width,
              height: primary.baselineSize.height,
              provenance: "promoted",
              ...(primary.baselineVersion !== undefined
                ? { revision: `v${primary.baselineVersion}` }
                : {}),
              promotedAt: primary.baselinePromotedAt,
              ...(primary.baselinePromotedBy !== undefined
                ? { promotedBy: primary.baselinePromotedBy }
                : {}),
              ...(primary.baselineRunId !== undefined ? { runId: primary.baselineRunId } : {}),
            },
          }
        : {}),
      ...(actual
        ? {
            actual: {
              path: dashboardArtifactPath(id, RUN_ARTIFACT.actual),
              width: primary.actualSize.width,
              height: primary.actualSize.height,
              url: targetUrl,
            },
          }
        : {}),
      ...(diff ? { diff: { path: dashboardArtifactPath(id, RUN_ARTIFACT.diff) } } : {}),
    };
    return {
      id,
      dashboardResult: { ...dashboardResult, ...imageEvidence },
      writePageBaselineEvidence: { outDir: absoluteOutDir, expected, actual, diff },
    };
  }

  if (primary?.baselineKind !== "figma") return { id, dashboardResult };

  const baseline: BaselineSource = {
    kind: "figma",
    fileKey: primary.fileKey ?? "unknown",
    nodeId: primary.nodeId ?? "0:0",
  };

  // primary.profile/clusterCheck are already resolved (set at matcher time by
  // resolveFigmaCompareOptions) -- re-running resolveFigmaCompareOptions on the resolved
  // profile would hit its `explicit` branch and silently drop a forced clusterCheck default.

  const baseName = primary.attachmentBaseName ?? "";
  const expected = findEvidenceAttachment(result, baseName, "-expected");
  const actual = findEvidenceAttachment(result, baseName, "-actual");
  const diff = findEvidenceAttachment(result, baseName, "-diff");

  // Same virtual paths writeEvidence's copies land under and onTestEnd registers into the
  // live file map -- lets the dashboard render expected/actual/diff while the run is live,
  // not just after report export re-derives them from the durable visual-score.json.
  const imageEvidence: Pick<DashboardContractResult, "baseline" | "actual" | "diff"> = {
    ...(expected
      ? {
          baseline: {
            path: dashboardArtifactPath(id, FIGMA_BASELINE_ARTIFACT.image),
            width: primary.baselineSize.width,
            height: primary.baselineSize.height,
            provenance: "figma",
          },
        }
      : {}),
    ...(actual
      ? {
          actual: {
            path: dashboardArtifactPath(id, RUN_ARTIFACT.actual),
            width: primary.actualSize.width,
            height: primary.actualSize.height,
            url: targetUrl,
          },
        }
      : {}),
    ...(diff ? { diff: { path: dashboardArtifactPath(id, RUN_ARTIFACT.diff) } } : {}),
  };

  return {
    id,
    dashboardResult: { ...dashboardResult, ...imageEvidence },
    writeEvidence: {
      outDir: absoluteOutDir,
      expected,
      actual,
      diff,
      score: primary,
      baseline,
      targetUrl,
    },
  };
}

/**
 * Writes one attachment's bytes to `outDir/destName` -- or, when this result has no such
 * attachment, removes whatever an earlier run left there, so a stale diff (say) is never
 * listed as this run's evidence.
 */
function replaceEvidenceFile(
  outDir: string,
  destName: string,
  attachment: EvidenceAttachment | undefined,
): string | undefined {
  const destination = path.join(outDir, destName);
  const bytes = readAttachmentBytes(attachment);
  if (!bytes) {
    fs.rmSync(destination, { force: true });
    return undefined;
  }
  fs.writeFileSync(destination, bytes);
  return destination;
}

/**
 * Copies whatever image evidence the matcher attached into the contract's own
 * durable outDir (Playwright's own test-results/attachments are not
 * guaranteed to survive past the next run) and writes a schema-valid
 * visual-score.json next to them. Matchers attach the triplet for both pass
 * and fail so `done-gate`/`report`/`open` receive the same durable evidence
 * shape either way.
 */
export function writeEvidence(
  evidence: NonNullable<DerivedContract["writeEvidence"]>,
  maxMaskedAreaRatio: number | undefined,
): void {
  fs.mkdirSync(evidence.outDir, { recursive: true });
  const baselinePath = replaceEvidenceFile(
    evidence.outDir,
    FIGMA_BASELINE_ARTIFACT.image,
    evidence.expected,
  );
  const actualPath = replaceEvidenceFile(evidence.outDir, RUN_ARTIFACT.actual, evidence.actual);
  const diffPath = replaceEvidenceFile(evidence.outDir, RUN_ARTIFACT.diff, evidence.diff);
  // diffPath is legitimately absent when compare() exits early (unreadable PNG, size-gap
  // failure) -- exactly the failing runs where evidence matters most, so only baseline/actual
  // (always attached, pass or fail) are required to proceed. Without them, no score this
  // run could write would be valid, so an earlier run's score files must not linger either.
  if (!baselinePath || !actualPath) {
    for (const name of [
      FIGMA_BASELINE_ARTIFACT.meta,
      RUN_ARTIFACT.score,
      RUN_ARTIFACT.runMeta,
      RUN_ARTIFACT.punchList,
    ]) {
      fs.rmSync(path.join(evidence.outDir, name), { force: true });
    }
    return;
  }

  const score = evidence.score;
  const capturedAt = new Date();
  const fetchedAtMs = score.baselineFetchedAt ? Date.parse(score.baselineFetchedAt) : NaN;
  if (Number.isFinite(fetchedAtMs) && fetchedAtMs >= capturedAt.getTime())
    capturedAt.setTime(fetchedAtMs + 1);
  const fetchedAt = Number.isFinite(fetchedAtMs)
    ? new Date(fetchedAtMs).toISOString()
    : new Date(capturedAt.getTime() - 1).toISOString();
  const metaPath = path.join(evidence.outDir, FIGMA_BASELINE_ARTIFACT.meta);
  const baselineEvidence = {
    kind: "figma" as const,
    path: baselinePath,
    metaPath,
    fileKey: evidence.baseline.fileKey,
    nodeId: evidence.baseline.nodeId,
    fetchedAt,
    lastModified: score.baselineLastModified ?? null,
  };
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify(
      {
        fileKey: evidence.baseline.fileKey,
        nodeId: evidence.baseline.nodeId,
        fetchedAt,
        lastModified: score.baselineLastModified ?? null,
      },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  );
  const captureEvidence = score.captureEvidence;
  const scope = score.scope ?? { kind: "page" as const, fullPage: false };
  // Same reasoning as deriveContract: score.profile is already resolved, so read
  // score.clusterCheck directly instead of re-deriving it from the resolved profile.
  const profile = score.profile ?? "page";
  const clusterCheck = score.clusterCheck;
  // profileOverrides is an explicit author choice with nothing to re-derive it from --
  // same reasoning as clusterCheck above, read straight off the persisted score.
  const profileOverrides = score.profileOverrides;
  const gateEligible = score.gateEligible;
  const styleGateEligible = score.styleGateEligible;
  // Only the author's declared options.expectSize counts here -- an omitted expectSize must
  // stay absent (not backfilled from observed capture dimensions) so validate.ts's
  // "gate-eligible component contract requires expectSize" check can actually catch it.
  const expectedSize = scope.kind === "region" ? (scope.expectedSize ?? null) : null;

  // Validated against visualScoreArtifactSchema here (write time), not left to be
  // caught later by model.ts's readScore parsing it back (read time) -- drift from
  // the schema fails loudly where it's written, not silently downstream.
  const visualScore = visualScoreArtifactSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    pass: score.pass,
    runType: "final",
    capturedAt: capturedAt.toISOString(),
    target: { kind: "web", url: evidence.targetUrl },
    baseline: baselineEvidence,
    viewport: "matcher",
    profile,
    pageReason: SYNTHETIC_PAGE_REASON,
    selector: scope.kind === "region" ? scope.selector : null,
    expectSize: expectedSize,
    stability: "stable",
    outDir: evidence.outDir,
    evidenceHashes: {
      baseline: fileHash(baselinePath),
      baselineMeta: fileHash(metaPath),
      actual: fileHash(actualPath),
      diff: diffPath ? fileHash(diffPath) : null,
    },
    matchRatio: score.matchRatio,
    ssim: score.ssim,
    avgDeltaE: score.avgDeltaE,
    diffPixels: score.diffPixels,
    baselineSize: score.baselineSize,
    actualSize: score.actualSize,
    artifacts: { baseline: baselinePath, actual: actualPath, diff: diffPath ?? null },
    ...(clusterCheck !== undefined ? { clusterCheck } : {}),
    ...(profileOverrides ? { profileOverrides } : {}),
    ...(gateEligible !== undefined ? { gateEligible } : {}),
    ...(styleGateEligible !== undefined ? { styleGateEligible } : {}),
    ...(score.topIssues?.length ? { topIssues: score.topIssues } : {}),
    ...(score.warnings?.length ? { warnings: score.warnings } : {}),
    ...(captureEvidence ? { captureEvidence } : {}),
  });
  fs.writeFileSync(
    path.join(evidence.outDir, RUN_ARTIFACT.score),
    `${JSON.stringify(visualScore, null, JSON_INDENT_SPACES)}\n`,
  );
  fs.writeFileSync(
    path.join(evidence.outDir, RUN_ARTIFACT.runMeta),
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        target: { kind: "web", url: evidence.targetUrl },
        baseline: baselineEvidence,
        viewport: "matcher",
        viewportSize: score.actualSize,
        profile,
        runType: "final",
        pageReason: SYNTHETIC_PAGE_REASON,
        ...(clusterCheck !== undefined ? { clusterCheck } : {}),
        ...(profileOverrides ? { profileOverrides } : {}),
        ...(gateEligible !== undefined ? { gateEligible } : {}),
        ...(styleGateEligible !== undefined ? { styleGateEligible } : {}),
        ...(score.masks?.length ? { masks: score.masks } : {}),
        // The project default, not score.maxMaskedAreaRatio -- contractToDoneGate compares
        // against that same default, so run-meta must match it, not the per-call override.
        ...(maxMaskedAreaRatio !== undefined ? { maxMaskedAreaRatio } : {}),
        ...(captureEvidence ? { captureEvidence } : {}),
      },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(evidence.outDir, RUN_ARTIFACT.punchList),
    `${JSON.stringify(
      { schemaVersion: SCHEMA_VERSION, pass: score.pass, items: score.topIssues ?? [] },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  );
}

/**
 * Copies a toMatchPageBaseline result's expected/actual/diff triplet into the contract's
 * own durable outDir -- same reasoning as writeEvidence, but no visual-score.json/
 * VerificationArtifact: that pipeline stays Figma-only (R9).
 */
export function writePageBaselineEvidence(
  evidence: NonNullable<DerivedContract["writePageBaselineEvidence"]>,
): void {
  fs.mkdirSync(evidence.outDir, { recursive: true });
  replaceEvidenceFile(evidence.outDir, WEB_BASELINE_ARTIFACT.image, evidence.expected);
  replaceEvidenceFile(evidence.outDir, RUN_ARTIFACT.actual, evidence.actual);
  replaceEvidenceFile(evidence.outDir, RUN_ARTIFACT.diff, evidence.diff);
}

export interface TestEndProjection {
  dashboardId: string;
  dashboardResult: DashboardContractResult;
  files: Array<[string, string]>;
}

const DURABLE_EVIDENCE_NAMES = [
  RUN_ARTIFACT.actual,
  RUN_ARTIFACT.diff,
  FIGMA_BASELINE_ARTIFACT.image,
  RUN_ARTIFACT.score,
];

const PAGE_BASELINE_EVIDENCE_NAMES = [
  RUN_ARTIFACT.actual,
  RUN_ARTIFACT.diff,
  WEB_BASELINE_ARTIFACT.image,
];

/**
 * Shared by finalizeTestEnd's figma and toMatchPageBaseline branches: runs a durable
 * evidence writer, then registers whichever of `names` actually landed in `outDir` into
 * the live file map -- a failed write logs and leaves `files` untouched rather than
 * throwing (matches writeEvidence's own best-effort contract: missing evidence must
 * never crash the reporter).
 */
function collectWrittenFiles(
  contractId: string,
  outDir: string,
  names: readonly string[],
  write: () => void,
  files: Array<[string, string]>,
): void {
  try {
    write();
    for (const name of names) {
      const filePath = path.join(outDir, name);
      if (fs.existsSync(filePath)) files.push([dashboardArtifactPath(contractId, name), filePath]);
    }
  } catch (error: unknown) {
    console.error(
      `framelia reporter: failed to write evidence for ${contractId}: ${String(error)}`,
    );
  }
}

/**
 * Everything one low-level Playwright onTestEnd callback needs to do: derive each score,
 * retain its live dashboard projection, and preserve promoted web-baseline evidence.
 * Annotated contract tests use the selected run bundle instead.
 */
export function finalizeTestEnd(
  test: TestCase,
  evidenceRoot: string,
  result: TestResult,
  maxMaskedAreaRatio: number | undefined,
  keyOptions: EvidenceKeyOptions = {},
): TestEndProjection {
  const scores = readScoreAttachments(result);
  const derivedContracts = (scores.length ? scores : [undefined]).map((score, index, all) =>
    deriveContract(test, evidenceRoot, result, score, index, all.length, keyOptions),
  );

  const files: Array<[string, string]> = [];
  for (const derived of derivedContracts) {
    if (derived.writePageBaselineEvidence) {
      collectWrittenFiles(
        derived.id,
        derived.writePageBaselineEvidence.outDir,
        PAGE_BASELINE_EVIDENCE_NAMES,
        () => writePageBaselineEvidence(derived.writePageBaselineEvidence!),
        files,
      );
      continue;
    }
    if (!derived.writeEvidence) continue;
    collectWrittenFiles(
      derived.id,
      derived.writeEvidence.outDir,
      DURABLE_EVIDENCE_NAMES,
      () => writeEvidence(derived.writeEvidence!, maxMaskedAreaRatio),
      files,
    );
  }

  const primary = derivedContracts[0]!;
  const dashboardId = sanitizeTestId(test);
  // Collapses every matcher call into this one row, so a style issue from any matcher
  // but the first doesn't silently vanish from the live view.
  const topIssues = derivedContracts.flatMap((derived) => derived.dashboardResult.topIssues ?? []);

  return {
    dashboardId,
    dashboardResult: {
      ...primary.dashboardResult,
      id: dashboardId,
      ...(topIssues.length ? { topIssues } : {}),
    },
    files,
  };
}
