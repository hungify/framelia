import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  visualArtifactPath,
  type BaselineSource,
  type DashboardContractResult,
  type VerificationArtifact,
  type VerificationContract,
} from "@framelia/contracts";
import { JSON_INDENT_SPACES, SCHEMA_VERSION, writeVerificationArtifact } from "@framelia/verify";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import { SCORE_ATTACHMENT_SUFFIX } from "./attach.ts";
import type { FrameliaScoreAttachment } from "./score-attachment.ts";

export interface FrameliaReporterOptions {
  /** Project root `.framelia/` evidence writes under; defaults to the Playwright config's rootDir. */
  projectRoot?: string;
  hostname?: string;
  port?: number;
  /** Forwarded to startDashboardServer; mainly for tests -- production use should rely on the default. */
  clientRoot?: string;
}

// @framelia/dashboard-server is an optional peer dependency (it owns the hono/@hono/node-server
// HTTP runtime) -- a consumer who only calls toMatchFigma/toMatchPage/toMatchUrl and never
// registers this Reporter should never be forced to install it. `typeof import(...)` is a
// type-only reference and costs nothing at runtime; the actual module load is deferred to
// loadDashboardServer() below, which only runs once a Reporter is constructed and used.
type DashboardServerModule = typeof import("@framelia/dashboard-server");
type ReporterStoreInstance = InstanceType<DashboardServerModule["ReporterStore"]>;
type DashboardServer = Awaited<ReturnType<DashboardServerModule["startDashboardServer"]>>;

let dashboardServerModulePromise: Promise<DashboardServerModule> | undefined;

function loadDashboardServer(): Promise<DashboardServerModule> {
  dashboardServerModulePromise ??= import("@framelia/dashboard-server").catch((error: unknown) => {
    throw new Error(
      'FrameliaReporter requires the optional peer dependency "@framelia/dashboard-server" -- ' +
        "install it in your project to use the reporter.",
      { cause: error },
    );
  });
  return dashboardServerModulePromise;
}

const FALLBACK_TARGET_URL = "http://localhost/";
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

function sanitizeTestId(test: TestCase): string {
  return test.id.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
}

function contractNameFor(test: TestCase): string {
  return test.titlePath().slice(1).join(" › ") || test.title;
}

/**
 * Reads every `*-framelia-score` JSON attachment off a TestResult. The
 * Reporter runs in the main process while tests run in worker processes, so
 * this -- not a shared in-memory value -- is the only channel back (see
 * to-match-figma.ts's doc comment on runToMatchFigma for the same
 * process-boundary reasoning applied to test.info()).
 */
function readScoreAttachments(result: TestResult): FrameliaScoreAttachment[] {
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

interface DerivedContract {
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
function deriveContract(
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
  const status = dashboardStatusFor(result);
  const pass = result.status === "passed";
  const targetUrl = httpTargetUrl(primary?.targetUrl);
  const isTerminal = result.status === "passed" || result.status === "failed";

  const dashboardResult: DashboardContractResult = {
    id,
    name: contractNameFor(test),
    tags: test.tags,
    status,
    phase: "complete",
    baselineKind: primary?.baselineKind === "figma" ? "figma" : "page",
    capture: {
      kind: "viewport",
      viewport: {
        width: primary?.actualSize.width || 1,
        height: primary?.actualSize.height || 1,
      },
    },
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
    ...(primary
      ? {
          comparison: {
            algorithm: "framelia-multi-signal",
            diffPixels: primary.diffPixels,
            diffRatio: primary.matchRatio == null ? null : 1 - primary.matchRatio,
            matchRatio: primary.matchRatio,
            ssim: primary.ssim,
            avgDeltaE: primary.avgDeltaE,
            sizeMatch:
              primary.goldSize.width === primary.actualSize.width &&
              primary.goldSize.height === primary.actualSize.height,
          },
        }
      : {}),
    finishedAt: new Date().toISOString(),
  };

  if (primary?.baselineKind !== "figma") return { id, dashboardResult };

  const baseline: BaselineSource = {
    kind: "figma",
    fileKey: primary.fileKey ?? "unknown",
    nodeId: primary.nodeId ?? "0:0",
  };

  const scope = primary.scope ?? { kind: "page" as const, fullPage: false };
  const profile = primary.profile ?? (scope.kind === "region" ? "component/dev" : "page");
  const expectedSize =
    scope.kind === "region"
      ? (scope.expectedSize ?? primary.captureEvidence?.elementRect ?? primary.actualSize)
      : undefined;
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
            expectSize: expectedSize ?? primary.actualSize,
          }
        : { kind: "page", pageReason: SYNTHETIC_PAGE_REASON },
    ...(profile === "page" ? {} : { profile }),
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

  return {
    id,
    dashboardResult,
    verificationContract,
    verificationResult,
    writeEvidence: {
      outDir: absoluteOutDir,
      expectedPath: attachmentPath(result, primary.attachmentBaseName ?? "", "-expected"),
      actualPath: attachmentPath(result, primary.attachmentBaseName ?? "", "-actual"),
      diffPath: attachmentPath(result, primary.attachmentBaseName ?? "", "-diff"),
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
function writeEvidence(evidence: NonNullable<DerivedContract["writeEvidence"]>): void {
  fs.mkdirSync(evidence.outDir, { recursive: true });
  const copy = (source: string | undefined, destName: string): string | undefined => {
    if (!source) return undefined;
    const destination = path.join(evidence.outDir, destName);
    fs.copyFileSync(source, destination);
    return destination;
  };
  const baselinePath = copy(evidence.expectedPath, "figma-gold.png");
  const actualPath = copy(evidence.actualPath, "actual.png");
  const diffPath = copy(evidence.diffPath, "diff.png");
  if (!baselinePath || !actualPath || !diffPath) return;

  const score = evidence.score;
  const capturedAt = new Date();
  const fetchedAtMs = score.baselineFetchedAt ? Date.parse(score.baselineFetchedAt) : NaN;
  if (Number.isFinite(fetchedAtMs) && fetchedAtMs >= capturedAt.getTime())
    capturedAt.setTime(fetchedAtMs + 1);
  const fetchedAt = Number.isFinite(fetchedAtMs)
    ? new Date(fetchedAtMs).toISOString()
    : new Date(capturedAt.getTime() - 1).toISOString();
  const metaPath = path.join(evidence.outDir, "figma-gold.meta.json");
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
  const profile = score.profile ?? (scope.kind === "region" ? "component/dev" : "page");
  const expectedSize =
    scope.kind === "region"
      ? (scope.expectedSize ?? captureEvidence?.elementRect ?? score.actualSize)
      : null;

  const visualScore = {
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
    goldSize: score.goldSize,
    actualSize: score.actualSize,
    artifacts: { baseline: baselinePath, actual: actualPath, diff: diffPath ?? null },
    ...(score.topIssues?.length ? { topIssues: score.topIssues } : {}),
    ...(score.warnings?.length ? { warnings: score.warnings } : {}),
    ...(captureEvidence ? { captureEvidence } : {}),
  };
  fs.writeFileSync(
    path.join(evidence.outDir, "visual-score.json"),
    `${JSON.stringify(visualScore, null, JSON_INDENT_SPACES)}\n`,
  );
  fs.writeFileSync(
    path.join(evidence.outDir, "run-meta.json"),
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
        ...(score.masks?.length ? { masks: score.masks } : {}),
        ...(score.maxMaskedAreaRatio !== undefined
          ? { maxMaskedAreaRatio: score.maxMaskedAreaRatio }
          : {}),
        ...(captureEvidence ? { captureEvidence } : {}),
      },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(evidence.outDir, "punch-list.json"),
    `${JSON.stringify(
      { schemaVersion: SCHEMA_VERSION, pass: score.pass, items: score.topIssues ?? [] },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  );
}

/**
 * Playwright Reporter: drives framelia's live dashboard during a
 * matcher-driven test run, and persists a schema-v4 VerificationArtifact per
 * test afterward so `done-gate`/`report`/`open` keep functioning. Register it
 * in `playwright.config.ts`'s `reporter` array.
 */
export default class FrameliaReporter implements Reporter {
  readonly #options: FrameliaReporterOptions;
  #store?: ReporterStoreInstance;
  #serverPromise?: Promise<DashboardServer>;
  #projectRoot = process.cwd();
  #artifacts: VerificationArtifact[] = [];
  /** Loading @framelia/dashboard-server and seeding #store is async; buffers onTestEnd
   * calls that land before it resolves so no result is silently dropped (KTD13's Reporter
   * only gets one whole-test-result callback per test -- there is no second chance). */
  #ready?: Promise<void>;
  #pending: Promise<void>[] = [];

  constructor(options: FrameliaReporterOptions = {}) {
    this.#options = options;
  }

  /** Resolves once the dashboard server is reachable; `undefined` if it failed to start. */
  dashboardUrl(): Promise<string | undefined> {
    return (this.#ready ?? Promise.resolve()).then(
      () => this.#serverPromise?.then((server) => server.url).catch(() => undefined) ?? undefined,
    );
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.#projectRoot = this.#options.projectRoot ?? config.rootDir ?? process.cwd();
    const tests = suite.allTests();
    const ready = loadDashboardServer().then((mod) => {
      const store = new mod.ReporterStore(
        tests.map((test) => ({
          id: sanitizeTestId(test),
          name: contractNameFor(test),
          tags: test.tags,
        })),
      );
      this.#store = store;
      this.#serverPromise = mod.startDashboardServer({
        source: {
          snapshot: () => store.snapshot(),
          files: () => store.files(),
          subscribe: (l) => store.subscribe(l),
        },
        hostname: this.#options.hostname,
        port: this.#options.port,
        clientRoot: this.#options.clientRoot,
      });
      this.#serverPromise
        .then((server) => console.log(`framelia dashboard: ${server.url}`))
        .catch((error: unknown) =>
          console.error(`framelia dashboard failed to start: ${String(error)}`),
        );
      return undefined;
    });
    this.#ready = ready;
    ready.catch((error: unknown) => console.error(String(error)));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const record = (): void => {
      if (!this.#store) return;
      const scores = readScoreAttachments(result);
      const derivedContracts = (scores.length ? scores : [undefined]).map((score, index, all) =>
        deriveContract(test, this.#projectRoot, result, score, index, all.length),
      );
      const files: Array<[string, string]> = [];
      for (const derived of derivedContracts) {
        if (!derived.writeEvidence) continue;
        try {
          writeEvidence(derived.writeEvidence);
          const outDir = derived.writeEvidence.outDir;
          for (const name of ["actual.png", "diff.png", "figma-gold.png", "visual-score.json"]) {
            const filePath = path.join(outDir, name);
            if (fs.existsSync(filePath)) files.push([`contracts/${derived.id}/${name}`, filePath]);
          }
        } catch (error: unknown) {
          console.error(
            `framelia reporter: failed to write evidence for ${derived.id}: ${String(error)}`,
          );
        }
      }
      const primary = derivedContracts[0]!;
      const dashboardId = sanitizeTestId(test);
      this.#store.recordResult(dashboardId, { ...primary.dashboardResult, id: dashboardId }, files);
      for (const derived of derivedContracts) {
        if (!derived.verificationContract || !derived.verificationResult) continue;
        this.#artifacts.push({
          schemaVersion: SCHEMA_VERSION,
          kind: "framelia.visual-verification",
          createdAt: new Date().toISOString(),
          projectRoot: this.#projectRoot,
          request: {
            schemaVersion: SCHEMA_VERSION,
            target: {
              kind: "web",
              url: derived.writeEvidence?.targetUrl ?? FALLBACK_TARGET_URL,
            },
            contracts: [derived.verificationContract],
          },
          ok: derived.verificationResult.ok,
          allPassed: derived.verificationResult.ok && derived.verificationResult.pass,
          results: [derived.verificationResult],
        });
      }
    };
    if (this.#store) {
      record();
      return;
    }
    this.#pending.push((this.#ready ?? Promise.resolve()).then(record).catch(() => {}));
  }

  async onEnd(_result: FullResult): Promise<void> {
    await this.#ready?.catch(() => undefined);
    await Promise.all(this.#pending);
    this.#store?.finish();
    for (const artifact of this.#artifacts) {
      try {
        // contracts[0].outDir is relative (VISUAL_ARTIFACT_DIR_PATTERN requires it);
        // resolve it against projectRoot for the actual filesystem write.
        const outDir = path.join(this.#projectRoot, artifact.request.contracts[0]!.outDir);
        fs.mkdirSync(outDir, { recursive: true });
        writeVerificationArtifact(path.join(outDir, "visual-verification.json"), artifact);
      } catch (error: unknown) {
        console.error(
          `framelia reporter: failed to write verification artifact for ${artifact.request.contracts[0]?.id ?? "unknown"}: ${String(error)}`,
        );
      }
    }
    const server = await this.#serverPromise?.catch(() => undefined);
    await server?.close();
  }
}
