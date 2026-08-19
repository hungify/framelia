import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  assembleContractResult,
  deriveCaptureEvidenceDiagnostics,
  deriveComparisonSummary,
  deriveDashboardVerdict,
  projectCapture,
  projectCaptureEvidence,
  visualArtifactPath,
  visualScoreArtifactSchema,
  type BaselineSource,
  type CaptureEvidenceArtifact,
  type DashboardContractResult,
  type VerificationArtifact,
  type VerificationContract,
} from "@framelia/contracts";
import {
  FIGMA_BASELINE_ARTIFACT,
  JSON_INDENT_SPACES,
  RUN_ARTIFACT,
  SCHEMA_VERSION,
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

function attachmentPath(
  result: TestResult,
  baseName: string,
  suffix: "-expected" | "-actual" | "-diff",
): string | undefined {
  return result.attachments.find((attachment) => attachment.name === `${baseName}${suffix}`)?.path;
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
  /**
   * Only set when the primary score is figma-baselined. `VerificationContract.baseline`
   * is figma-only by schema -- a toMatchPage/toMatchUrl result has no schema-valid
   * `baseline` value, so it gets no persisted contract, only the live dashboardResult above.
   */
  verificationContract?: VerificationContract;
  verificationResult?: VerificationArtifact["results"][number];
  /** Figma matcher evidence is durable; web-to-web remains dashboard/runtime-only under R9. */
  writeEvidence?: {
    outDir: string;
    expectedPath?: string;
    actualPath?: string;
    diffPath?: string;
    score: FrameliaScoreAttachment;
    baseline: BaselineSource;
    targetUrl: string;
  };
}

/** Maps one matcher attachment to one durable Figma contract/evidence directory. */
export function deriveContract(
  test: TestCase,
  evidenceRoot: string,
  result: TestResult,
  score: FrameliaScoreAttachment | undefined,
  index: number,
  total: number,
): DerivedContract {
  const baseId = sanitizeTestId(test);
  const id = total === 1 ? baseId : `${baseId}-${index + 1}`;
  // Contract/result outDir is relative to projectRoot (VISUAL_ARTIFACT_DIR_PATTERN
  // requires it -- matches the old CLI's convention); fs operations need the
  // resolved absolute path instead.
  const relativeOutDir = visualArtifactPath(id);
  const absoluteOutDir = path.join(evidenceRoot, relativeOutDir);
  const outDir = relativeOutDir;
  const primary = score;
  const pass = result.status === "passed";
  const targetUrl = httpTargetUrl(primary?.targetUrl);
  const isTerminal = result.status === "passed" || result.status === "failed";
  // Same verdict derivation the durable report path (dashboard-server's model.ts) applies to
  // this contract's persisted visual-score.json -- computed here, live, from the same
  // captureEvidence the matcher already attached, so a run can't read "passed" now and
  // "blocked" once the report is exported. No score attachment (primary undefined) means no
  // matcher ran at all for this test; fall back to the raw Playwright result instead.
  // primary.captureEvidence is verify/internal's CaptureEvidence, not contracts' schema-inferred
  // CaptureEvidenceArtifact -- same runtime shape (fields match field-for-field), but the
  // schema's `.loose()` gives its type an index signature CaptureEvidence doesn't structurally
  // declare, which TS treats as a mismatch even though every property lines up.
  const captureEvidence = primary
    ? projectCaptureEvidence(
        primary.captureEvidence as CaptureEvidenceArtifact | undefined,
        targetUrl,
      )
    : undefined;
  // Unlike the durable path (dashboard-server's model.ts, where captureEvidence is a
  // completeness invariant of the compare() pipeline), captureEvidence is best-effort here --
  // not every matcher attaches it -- so a missing one is not itself a caveat live; only surface
  // diagnostics when there's actual evidence to derive them from.
  const diagnostics = captureEvidence ? deriveCaptureEvidenceDiagnostics(captureEvidence, []) : [];
  const maskApplied = captureEvidence?.maskEvidence?.status === "applied";
  const status = primary
    ? deriveDashboardVerdict({ resultOk: isTerminal, pass, diagnostics, maskApplied })
    : dashboardStatusFor(result);
  // A score attachment only exists once capture already succeeded (see runToMatchFigma/
  // runComparePages: a selector that fails to resolve returns before attaching a score), so a
  // region scope reaching here always resolved to exactly one stable element.
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
    ...(primary ? { comparison: deriveComparisonSummary(primary) } : {}),
    diagnostics,
    ...(captureEvidence?.maskEvidence ? { maskEvidence: captureEvidence.maskEvidence } : {}),
    finishedAt: new Date().toISOString(),
  });

  if (primary?.baselineKind !== "figma") return { id, dashboardResult };

  const baseline: BaselineSource = {
    kind: "figma",
    fileKey: primary.fileKey ?? "unknown",
    nodeId: primary.nodeId ?? "0:0",
  };

  // primary.profile/clusterCheck are already resolved (set at matcher time by
  // resolveFigmaCompareOptions) -- re-running resolveFigmaCompareOptions on the resolved
  // profile would hit its `explicit` branch and silently drop a forced clusterCheck default.
  const profile = primary.profile ?? "page";
  const verificationContract: VerificationContract = {
    id,
    baseline,
    viewport: {
      name: "matcher",
      width: primary.actualSize.width || 1,
      height: primary.actualSize.height || 1,
    },
    outDir,
    scope:
      scope.kind === "region"
        ? {
            kind: "region",
            selector: scope.selector,
            expectSize: regionExpectedSize ?? primary.actualSize,
          }
        : { kind: "page", pageReason: SYNTHETIC_PAGE_REASON },
    ...(profile === "page" ? {} : { profile }),
    ...(primary.clusterCheck !== undefined ? { clusterCheck: primary.clusterCheck } : {}),
    ...(primary.masks?.length ? { masks: primary.masks } : {}),
  };

  const verificationResult: VerificationArtifact["results"][number] = isTerminal
    ? { id, ok: true, pass, outDir }
    : {
        id,
        ok: false,
        pass: false,
        error: `TEST_${result.status.toUpperCase()}`,
        message: result.error?.message ?? `Test ${result.status}.`,
        outDir,
      };

  const expectedPath = attachmentPath(result, primary.attachmentBaseName ?? "", "-expected");
  const actualAttachmentPath = attachmentPath(result, primary.attachmentBaseName ?? "", "-actual");
  const diffAttachmentPath = attachmentPath(result, primary.attachmentBaseName ?? "", "-diff");

  // Same virtual paths writeEvidence's copies land under and onTestEnd registers into the
  // live file map -- lets the dashboard render expected/actual/diff while the run is live,
  // not just after report export re-derives them from the durable visual-score.json.
  const imageEvidence: Pick<DashboardContractResult, "baseline" | "actual" | "diff"> = {
    ...(expectedPath
      ? {
          baseline: {
            path: dashboardArtifactPath(id, FIGMA_BASELINE_ARTIFACT.image),
            width: primary.baselineSize.width,
            height: primary.baselineSize.height,
            provenance: "figma",
          },
        }
      : {}),
    ...(actualAttachmentPath
      ? {
          actual: {
            path: dashboardArtifactPath(id, RUN_ARTIFACT.actual),
            width: primary.actualSize.width,
            height: primary.actualSize.height,
            url: targetUrl,
          },
        }
      : {}),
    ...(diffAttachmentPath ? { diff: { path: dashboardArtifactPath(id, RUN_ARTIFACT.diff) } } : {}),
  };

  return {
    id,
    dashboardResult: { ...dashboardResult, ...imageEvidence },
    verificationContract,
    verificationResult,
    writeEvidence: {
      outDir: absoluteOutDir,
      expectedPath,
      actualPath: actualAttachmentPath,
      diffPath: diffAttachmentPath,
      score: primary,
      baseline,
      targetUrl,
    },
  };
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
  const copy = (source: string | undefined, destName: string): string | undefined => {
    if (!source) return undefined;
    const destination = path.join(evidence.outDir, destName);
    fs.copyFileSync(source, destination);
    return destination;
  };
  const baselinePath = copy(evidence.expectedPath, FIGMA_BASELINE_ARTIFACT.image);
  const actualPath = copy(evidence.actualPath, RUN_ARTIFACT.actual);
  const diffPath = copy(evidence.diffPath, RUN_ARTIFACT.diff);
  // diffPath is legitimately absent when compare() exits early (unreadable PNG, size-gap
  // failure) -- exactly the failing runs where evidence matters most, so only baseline/actual
  // (always attached, pass or fail) are required to proceed.
  if (!baselinePath || !actualPath) return;

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
  const expectedSize =
    scope.kind === "region"
      ? (scope.expectedSize ?? captureEvidence?.elementRect ?? score.actualSize)
      : null;

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
        ...(score.masks?.length ? { masks: score.masks } : {}),
        // Recorded from the project's config default, not score.maxMaskedAreaRatio (the
        // matcher's per-call capture option) -- contractToDoneGate compares against the same
        // project default, so run-meta must match that, not the capture-time override.
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

export interface TestEndProjection {
  dashboardId: string;
  dashboardResult: DashboardContractResult;
  files: Array<[string, string]>;
  artifacts: VerificationArtifact[];
}

const DURABLE_EVIDENCE_NAMES = [
  RUN_ARTIFACT.actual,
  RUN_ARTIFACT.diff,
  FIGMA_BASELINE_ARTIFACT.image,
  RUN_ARTIFACT.score,
];

/**
 * Everything one Playwright onTestEnd callback needs to do: derive each contract the test's
 * score attachments imply, write durable evidence for the figma-baselined ones, and assemble
 * both the live dashboard result and the durable VerificationArtifacts. The Reporter itself
 * (reporter.ts) only wires this into Playwright's lifecycle hooks and forwards the result --
 * it owns no projection logic of its own.
 */
export function finalizeTestEnd(
  test: TestCase,
  evidenceRoot: string,
  result: TestResult,
  maxMaskedAreaRatio: number | undefined,
): TestEndProjection {
  const scores = readScoreAttachments(result);
  const derivedContracts = (scores.length ? scores : [undefined]).map((score, index, all) =>
    deriveContract(test, evidenceRoot, result, score, index, all.length),
  );

  const files: Array<[string, string]> = [];
  for (const derived of derivedContracts) {
    if (!derived.writeEvidence) continue;
    try {
      writeEvidence(derived.writeEvidence, maxMaskedAreaRatio);
      const outDir = derived.writeEvidence.outDir;
      for (const name of DURABLE_EVIDENCE_NAMES) {
        const filePath = path.join(outDir, name);
        if (fs.existsSync(filePath))
          files.push([dashboardArtifactPath(derived.id, name), filePath]);
      }
    } catch (error: unknown) {
      console.error(
        `framelia reporter: failed to write evidence for ${derived.id}: ${String(error)}`,
      );
    }
  }

  const primary = derivedContracts[0]!;
  const dashboardId = sanitizeTestId(test);

  const artifacts: VerificationArtifact[] = [];
  for (const derived of derivedContracts) {
    if (!derived.verificationContract || !derived.verificationResult) continue;
    artifacts.push({
      schemaVersion: SCHEMA_VERSION,
      kind: "framelia.visual-verification",
      createdAt: new Date().toISOString(),
      projectRoot: evidenceRoot,
      request: {
        schemaVersion: SCHEMA_VERSION,
        target: { kind: "web", url: derived.writeEvidence?.targetUrl ?? FALLBACK_TARGET_URL },
        contracts: [derived.verificationContract],
      },
      ok: derived.verificationResult.ok,
      allPassed: derived.verificationResult.ok && derived.verificationResult.pass,
      results: [derived.verificationResult],
    });
  }

  return {
    dashboardId,
    dashboardResult: { ...primary.dashboardResult, id: dashboardId },
    files,
    artifacts,
  };
}
