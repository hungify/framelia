import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  authoredContractSchema,
  baselineSnapshotSchema,
  testRegistrationSchema,
  type AuthoritativeRunRequirements,
  type ContractBinding,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, readPinnedBaseline } from "@framelia/verify";
import {
  evaluateAuthoritativeRun,
  readRunBundle,
  readSelectedRun,
} from "@framelia/verify/run-bundle";
import { makeSolidPng } from "@framelia/verify/testing";
import { chromium } from "@playwright/test";
import type {
  FullConfig,
  FullProject,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { SCORE_ATTACHMENT_SUFFIX } from "../src/attach.ts";
import { defineFigmaTests, runFigmaContractTest } from "../src/define-figma-tests.ts";
import FrameliaReporter from "../src/reporter.ts";
import { buildCasePlanForTest } from "../src/run-bundle-projection.ts";
import type { FrameliaScoreAttachment } from "../src/score-attachment.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  );
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

function fileDigest(filePath: string): `sha256:${string}` {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function clientRootFixture(): string {
  const dir = tempDir("framelia-run-bundle-reporter-client-");
  fs.writeFileSync(path.join(dir, "index.html"), "<main>Framelia</main>");
  return dir;
}

function fakeConfig(rootDir: string): FullConfig {
  return { rootDir } as unknown as FullConfig;
}

function fakeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
}

/** Pins a page-scope contract + baseline under `root/contracts/<id>.json`, returning the
 *  matching `framelia.contract` annotation binding a fake TestCase can carry. */
function pinContract(
  root: string,
  options: {
    id: string;
    viewport?: { width: number; height: number };
    imageBytes?: Buffer;
  },
): ContractBinding {
  const viewport = options.viewport ?? { width: 10, height: 10 };
  const imageBytes =
    options.imageBytes ??
    PNG.sync.write(makeSolidPng(viewport.width, viewport.height, [1, 2, 3, 255]));
  const imageDigest: `sha256:${string}` = `sha256:${crypto.createHash("sha256").update(imageBytes).digest("hex")}`;
  const snapshot = baselineSnapshotSchema.parse({
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    rendering: { viewport: { preset: "desktop", ...viewport }, deviceScaleFactor: 1 },
    expected: {
      kind: "page",
      image: { path: `${options.id}.png`, digest: imageDigest, ...viewport },
    },
  });
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root, `${options.id}.png`), imageBytes);

  const contract = authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: options.id,
    name: options.id,
    revision: 1,
    target: { path: `/${options.id}` },
    viewport: { preset: "desktop", ...viewport },
    scope: { kind: "page", pageReason: "full page review" },
    baseline: { snapshotDigest },
  });
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  const contractFile = `contracts/${options.id}.json`;
  fs.writeFileSync(path.join(root, contractFile), JSON.stringify(contract));

  return {
    formatVersion: 1,
    kind: "framelia.contract-binding",
    contractId: options.id,
    contractFile,
    contractDigest: canonicalJsonDigest(contract),
  };
}

/** Mirrors real Playwright's own Suite hierarchy just enough for `buildCasePlanForTest`
 *  to resolve the real spec file: a `type: "file"` suite whose `.title` is the file's
 *  basename, and a project whose `.testDir` is its directory -- `path.resolve(testDir,
 *  title)` reconstructs `specFile` exactly, the same way real Playwright's own
 *  `testInfo.titlePath`/file-suite title (relative to `project.testDir`) does. */
function fakeProjectSuite(projectName: string, specFile: string): Suite {
  const project = {
    name: projectName,
    use: { viewport: null },
    testDir: path.dirname(specFile),
  } as unknown as FullProject;
  return {
    type: "file",
    title: path.basename(specFile),
    project: () => project,
  } as unknown as Suite;
}

/** A fake `TestCase` shaped the way a real `defineFigmaTests` registration produces:
 *  carrying the `framelia.contract` annotation, a spec file location, a project-bearing
 *  parent suite, and a repeat-each index. */
function fakeContractTest(options: {
  id: string;
  binding: ContractBinding;
  specFile: string;
  /** Project root the registered `specFile` (portable path) is computed against --
   *  pass the same `projectRoot` given to `FrameliaReporter` in the same test. */
  root: string;
  /** Overrides the registered (portable, project-relative) `specFile` embedded in the
   *  annotation -- defaults to `specFile`'s own path relative to `root`. Pass an
   *  explicit mismatch to simulate a `specUrl` that doesn't match the file Playwright's
   *  own runtime metadata says registered this test. */
  registeredSpecFile?: string;
  /** Registration-time spec-file digest to embed in the annotation -- defaults to the
   *  spec file's *current* content, for the common case of a test that never mutates
   *  the spec file after constructing this fake. Pass explicitly to simulate a digest
   *  frozen before a later on-disk mutation. */
  specDigest?: `sha256:${string}`;
  projectName?: string;
  repeatEachIndex?: number;
}): TestCase {
  const registration = {
    formatVersion: 1,
    kind: "framelia.test-registration",
    binding: options.binding,
    specFile:
      options.registeredSpecFile ??
      path.relative(options.root, options.specFile).split(path.sep).join("/"),
    specDigest: options.specDigest ?? fileDigest(options.specFile),
  };
  return {
    id: options.id,
    title: options.id,
    tags: [],
    titlePath: () => ["project", "file.spec.ts", options.id],
    annotations: [{ type: "framelia.contract", description: JSON.stringify(registration) }],
    location: { file: options.specFile, line: 1, column: 1 },
    parent: fakeProjectSuite(options.projectName ?? "chromium", options.specFile),
    repeatEachIndex: options.repeatEachIndex ?? 0,
  } as unknown as TestCase;
}

/** Fake `TestType`-shaped double: captures every registered `test(title, details, fn)`
 *  call the real `defineFigmaTests` makes, without any real Playwright runtime -- same
 *  pattern as `define-figma-tests.test.ts`'s own `fakeTest`. Used here to prove
 *  `buildCasePlanForTest` reads the annotation `defineFigmaTests` actually produced at
 *  registration time, not a hand-assembled stand-in. */
function fakeTest(): {
  test: Parameters<typeof defineFigmaTests>[0];
  registered: Array<{ annotation: { type: string; description: string } }>;
} {
  const registered: Array<{ annotation: { type: string; description: string } }> = [];
  const test = ((
    _title: string,
    details: { annotation: { type: string; description: string } },
  ) => {
    registered.push(details);
  }) as unknown as Parameters<typeof defineFigmaTests>[0];
  return { test, registered };
}

function scoreAttachment(
  overrides: Partial<FrameliaScoreAttachment> = {},
): FrameliaScoreAttachment {
  return {
    pass: true,
    matchRatio: 1,
    ssim: 1,
    avgDeltaE: 0,
    diffPixels: 0,
    baselineSize: { width: 10, height: 10 },
    actualSize: { width: 10, height: 10 },
    targetUrl: "http://localhost/",
    baselineKind: "figma",
    attachmentBaseName: "framelia-case",
    captureEvidence: {
      contract: null,
      capturePaths: [],
      ephemeralSamplePaths: [],
      capturedAt: "2026-09-14T12:00:00.000Z",
      startedAt: "2026-09-14T12:00:00.000Z",
      finishedAt: "2026-09-14T12:00:01.000Z",
      finalUrl: "http://localhost/",
      viewport: { width: 10, height: 10 },
      readiness: null,
      fonts: { supported: true, status: "loaded", failed: [] },
      scope: { kind: "page", fullPage: false },
      screenshotHashes: [`sha256:${"a".repeat(64)}`, `sha256:${"a".repeat(64)}`],
      elementRect: null,
      computedStyle: null,
      warnings: [],
      actions: [],
      maskEvidence: null,
    },
    ...overrides,
  };
}

function fakeAttemptResult(options: {
  status: TestResult["status"];
  retry?: number;
  score?: FrameliaScoreAttachment;
  actualImageDir?: string;
  errorMessage?: string;
}): TestResult {
  const attachments: TestResult["attachments"] = [];
  if (options.score) {
    if (options.actualImageDir) {
      const baseName = options.score.attachmentBaseName ?? "framelia-case";
      const bytes = PNG.sync.write(makeSolidPng(10, 10, [1, 2, 3, 255]));
      const expectedPath = path.join(options.actualImageDir, `${baseName}-expected.png`);
      const actualPath = path.join(options.actualImageDir, `${baseName}-actual.png`);
      fs.writeFileSync(expectedPath, bytes);
      fs.writeFileSync(actualPath, bytes);
      attachments.push({
        name: `${baseName}-expected`,
        contentType: "image/png",
        path: expectedPath,
      });
      attachments.push({ name: `${baseName}-actual`, contentType: "image/png", path: actualPath });
    }
    attachments.push({
      name: `${options.score.attachmentBaseName}${SCORE_ATTACHMENT_SUFFIX}`,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(options.score)),
    });
  }
  return {
    status: options.status,
    retry: options.retry ?? 0,
    startTime: new Date("2026-09-14T12:00:00.000Z"),
    duration: 1_000,
    attachments,
    ...(options.errorMessage ? { error: { message: options.errorMessage } } : {}),
  } as unknown as TestResult;
}

function initializedProjectRoot(): string {
  const root = tempDir("framelia-run-bundle-reporter-project-");
  fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
  fs.writeFileSync(path.join(root, "login.spec.ts"), "// fixture spec file\n");
  return root;
}

describe("FrameliaReporter selected-run publication", () => {
  it("freezes a run plan and publishes a passing attempt, finalized once onEnd completes", async () => {
    const root = initializedProjectRoot();
    const imageDir = tempDir("framelia-run-bundle-images-");
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-passing",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    reporter.onTestEnd(
      test,
      fakeAttemptResult({ status: "passed", score: scoreAttachment(), actualImageDir: imageDir }),
    );
    await reporter.onEnd({ status: "passed" } as any);

    const bundle = readRunBundle(root, "run-passing");
    expect(bundle.record.status).toBe("finalized");
    expect(bundle.record.finalizedAt).toBeDefined();
    expect(bundle.attempts.size).toBe(1);
    const [attempt] = [...bundle.attempts.values()];
    expect(attempt).toMatchObject({ executionState: "completed", visualVerdict: "passed" });
  });

  it("projects exactly the selected run when annotated and low-level tests are mixed", async () => {
    const root = initializedProjectRoot();
    const imageDir = tempDir("framelia-run-bundle-images-");
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-mixed",
    });
    const annotated = fakeContractTest({
      id: "annotated",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });
    const lowLevel = {
      id: "low-level",
      title: "low-level",
      tags: [],
      annotations: [],
      parent: fakeProjectSuite("chromium", path.join(root, "login.spec.ts")),
      titlePath: () => ["chromium", "low-level"],
    } as unknown as TestCase;

    reporter.onBegin(fakeConfig(root), fakeSuite([annotated, lowLevel]));
    reporter.onTestEnd(
      annotated,
      fakeAttemptResult({ status: "passed", score: scoreAttachment(), actualImageDir: imageDir }),
    );
    reporter.onTestEnd(
      lowLevel,
      fakeAttemptResult({ status: "passed", score: scoreAttachment(), actualImageDir: imageDir }),
    );
    const dashboardUrl = await reporter.dashboardUrl();
    const run = await (await fetch(`${dashboardUrl}/api/run`)).json();
    expect(run.contracts).toHaveLength(1);
    expect(run.contracts[0]).toMatchObject({
      contractId: "login.desktop",
      sourceRunId: "run-mixed",
    });
    expect(JSON.stringify(run)).not.toContain("low-level");
    await reporter.onEnd({ status: "passed" } as any);
  });

  it("publishes a real capture score that the selected reader and authoritative gate accept", async () => {
    const root = initializedProjectRoot();
    const workDir = tempDir("framelia-real-capture-");
    const sourceDigest = `sha256:${"c".repeat(64)}` as const;
    const buildDigest = `sha256:${"b".repeat(64)}` as const;
    const server = http.createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        "<style>html,body{margin:0;width:100%;height:100%;background:rgb(1,2,3)}#mark{width:50px;height:40px;background:rgb(200,100,50)}</style><div id=mark></div>",
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 100, height: 80 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/login.desktop`);
    const imageBytes = await page.screenshot({ animations: "disabled" });
    const binding = pinContract(root, {
      id: "login.desktop",
      viewport: { width: 100, height: 80 },
      imageBytes,
    });
    const contract = authoredContractSchema.parse(
      JSON.parse(fs.readFileSync(path.join(root, binding.contractFile), "utf8")),
    );
    const pinnedBaseline = await readPinnedBaseline(root, contract);
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-real-capture",
      source: { sourceDigest, buildDigest, dirty: false },
    });
    const test = fakeContractTest({
      id: "real-capture",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });
    const imageAttachments: TestResult["attachments"] = [];
    const jsonAttachments: TestResult["attachments"] = [];

    try {
      reporter.onBegin(fakeConfig(root), fakeSuite([test]));
      const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
        timeoutMs: 5_000,
        workDir,
        stabilitySamples: 2,
        attach: async (name, filePath) => {
          imageAttachments.push({ name, path: filePath, contentType: "image/png" });
        },
        attachJson: async (name, data) => {
          jsonAttachments.push({
            name,
            body: Buffer.from(JSON.stringify(data)),
            contentType: "application/json",
          });
        },
      });
      expect(result.pass).toBe(true);

      reporter.onTestEnd(test, {
        status: "passed",
        retry: 0,
        startTime: new Date("2026-09-14T12:00:00.000Z"),
        duration: 1_000,
        attachments: [...imageAttachments, ...jsonAttachments],
      } as TestResult);
      await reporter.onEnd({ status: "passed" } as any);

      const selected = readSelectedRun(root, "run-real-capture");
      const casePlan = selected.cases[0]!.plan;
      const requirements: AuthoritativeRunRequirements = {
        formatVersion: 1,
        kind: "framelia.authoritative-run-requirements",
        requiredCases: [
          {
            caseId: casePlan.caseId,
            contractId: casePlan.contract.id,
            projectName: casePlan.project.name,
            repeatIndex: casePlan.repeatIndex,
            casePlanDigest: canonicalJsonDigest(casePlan),
            contractDigest: casePlan.contract.digest,
            bindingDigest: casePlan.bindingDigest,
            specFile: casePlan.registration.specFile,
            specFileDigest: casePlan.registration.specDigest,
            titlePath: casePlan.registration.titlePath,
          },
        ],
        policyDigest: casePlan.policyDigest,
        source: { sourceDigest, buildDigest, dirty: false },
        servedBuild: {
          mode: "ci-owned",
          observedBuildDigest: buildDigest,
          freshServerOwnedByJob: true,
          jobIdentity: "protected-real-capture-test",
        },
        retryAcceptance: casePlan.retryAcceptance,
      };
      expect(evaluateAuthoritativeRun(root, "run-real-capture", requirements)).toMatchObject({
        exitCode: 0,
        executionState: "completed",
        visualVerdict: "passed",
      });
    } finally {
      await context.close();
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("publishes two distinct attempts for a retried case, both retained after finalize", async () => {
    const root = initializedProjectRoot();
    const imageDir = tempDir("framelia-run-bundle-images-");
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-retries",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    reporter.onTestEnd(
      test,
      fakeAttemptResult({
        status: "failed",
        retry: 0,
        score: scoreAttachment({ pass: false }),
        actualImageDir: imageDir,
      }),
    );
    reporter.onTestEnd(
      test,
      fakeAttemptResult({
        status: "passed",
        retry: 1,
        score: scoreAttachment({ pass: true }),
        actualImageDir: imageDir,
      }),
    );
    await reporter.onEnd({ status: "passed" } as any);

    const bundle = readRunBundle(root, "run-retries");
    expect(bundle.attempts.size).toBe(2);
    const caseEntry = bundle.record.cases[0]!;
    expect(caseEntry.attemptIds).toHaveLength(2);
    // Default retryAcceptance ("require-first-attempt"): the first attempt is
    // authoritative even though the retry passed.
    const selected = bundle.attempts.get(caseEntry.selectedAttemptId!);
    expect(selected?.retryIndex).toBe(0);
    expect(selected?.visualVerdict).toBe("mismatched");
  });

  it("never lets a skipped test appear as a visual pass", async () => {
    const root = initializedProjectRoot();
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-skipped",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    reporter.onTestEnd(test, fakeAttemptResult({ status: "skipped" }));
    await reporter.onEnd({ status: "passed" } as any);

    const bundle = readRunBundle(root, "run-skipped");
    const [attempt] = [...bundle.attempts.values()];
    expect(attempt).toMatchObject({ executionState: "blocked", visualVerdict: "not-evaluated" });
  });

  it("never lets an interrupted test appear as a visual pass", async () => {
    const root = initializedProjectRoot();
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-interrupted",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    reporter.onTestEnd(test, fakeAttemptResult({ status: "interrupted" }));
    await reporter.onEnd({ status: "interrupted" } as any);

    const bundle = readRunBundle(root, "run-interrupted");
    const [attempt] = [...bundle.attempts.values()];
    expect(attempt).toMatchObject({ executionState: "incomplete", visualVerdict: "not-evaluated" });
  });

  it("still freezes and finalizes the run bundle even when the dashboard itself fails to start", async () => {
    const root = initializedProjectRoot();
    const imageDir = tempDir("framelia-run-bundle-images-");
    const binding = pinContract(root, { id: "login.desktop" });
    // A clientRoot with no index.html makes @framelia/dashboard-server's own
    // assertClientBuildExists() reject -- a real dashboard-side failure, not a mock.
    const brokenClientRoot = tempDir("framelia-run-bundle-broken-client-");
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: brokenClientRoot,
      port: 0,
      runId: "run-dashboard-down",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    expect(await reporter.dashboardUrl()).toBeUndefined();
    reporter.onTestEnd(
      test,
      fakeAttemptResult({ status: "passed", score: scoreAttachment(), actualImageDir: imageDir }),
    );
    await reporter.onEnd({ status: "passed" } as any);

    const bundle = readRunBundle(root, "run-dashboard-down");
    expect(bundle.record.status).toBe("finalized");
    expect(bundle.attempts.size).toBe(1);
  });

  it("removes the writer machine project root from persisted execution diagnostics", async () => {
    const root = initializedProjectRoot();
    const imageDir = tempDir("framelia-portable-score-");
    const binding = pinContract(root, { id: "login.desktop" });
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-portable-error",
    });
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: path.join(root, "login.spec.ts"),
      root,
    });

    reporter.onBegin(fakeConfig(root), fakeSuite([test]));
    reporter.onTestEnd(
      test,
      fakeAttemptResult({
        status: "failed",
        errorMessage: `failure at ${path.join(root, "src", "page.ts")}`,
        actualImageDir: imageDir,
        score: scoreAttachment({
          pass: false,
          warnings: [`warning from ${path.join(root, "capture", "font.ts")}`],
          topIssues: [
            {
              severity: "low",
              kind: "color",
              message: `mismatch from ${path.join(root, "styles", "button.css")}`,
              repairCandidate: true,
              blocking: false,
            },
          ],
        }),
      }),
    );
    await reporter.onEnd({ status: "failed" } as any);
    const selected = readSelectedRun(root, "run-portable-error");
    const attempt = selected.cases[0]!.selectedAttempt!;
    expect(attempt.record.diagnostics[0]?.message).toContain("<project-root>/src/page.ts");
    expect(JSON.stringify(attempt)).not.toContain(root);
    expect(attempt.score?.warnings[0]).toContain("<project-root>/capture/font.ts");
    expect(attempt.score?.topIssues[0]?.message).toContain("<project-root>/styles/button.css");
  });

  it("does not freeze a run bundle for a suite with zero framelia.contract-annotated tests", async () => {
    const root = initializedProjectRoot();
    const reporter = new FrameliaReporter({
      projectRoot: root,
      clientRoot: clientRootFixture(),
      port: 0,
      runId: "run-no-contracts",
    });
    reporter.onBegin(fakeConfig(root), fakeSuite([]));
    await reporter.onEnd({ status: "passed" } as any);

    expect(fs.existsSync(path.join(root, ".framelia", "runs"))).toBe(false);
  });
});

describe("buildCasePlanForTest (framelia/#77's registration-time spec-digest fix)", () => {
  it("freezes the spec digest captured at defineFigmaTests registration time, not the file's content when buildCasePlanForTest later reads it", async () => {
    const root = tempDir("framelia-spec-digest-regression-");
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    pinContract(root, { id: "login.desktop" });
    const specFilePath = path.join(root, "login.spec.ts");
    fs.writeFileSync(specFilePath, "// original content, imported by Playwright's collection\n");

    // Simulates "Playwright's collection phase just imported this spec file": the real
    // `defineFigmaTests` hashes `specFilePath`'s bytes synchronously, right now, and
    // freezes that digest into the registered test's own `framelia.contract` annotation.
    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: path.join(root, "contracts", "login.desktop.json"),
      specUrl: pathToFileURL(specFilePath),
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);
    const registeredAnnotation = registered[0]!.annotation;
    const originalSpecDigest = testRegistrationSchema.parse(
      JSON.parse(registeredAnnotation.description),
    ).specDigest;
    expect(originalSpecDigest).toBe(fileDigest(specFilePath));

    // A -> B: the spec file is edited on disk after collection, before the Reporter's
    // own `onBegin` ever runs -- exactly framelia/#77's exploitable window. Node never
    // re-imports an already-loaded module, so the code that will actually execute for
    // every attempt of this test is still whatever was imported above; only the bytes
    // on disk have changed.
    fs.writeFileSync(specFilePath, "// edited after collection, before onBegin\n");
    const mutatedSpecDigest = fileDigest(specFilePath);
    expect(mutatedSpecDigest).not.toBe(originalSpecDigest);

    // The onBegin-equivalent step: a fake TestCase carrying the real registration
    // annotation, with its parent suite's own file-suite title/project.testDir
    // (via `fakeProjectSuite("chromium", specFilePath)`) resolving to the (now-mutated)
    // spec fixture -- `buildCasePlanForTest` reads the real spec file from that Suite
    // chain, exactly what Playwright's own collected `type: "file"` Suite would report
    // at this point (NOT `location.file`, which is inert here and never read).
    const test1 = {
      id: "t1",
      title: "t1",
      tags: [],
      titlePath: () => ["project", "login.spec.ts", "t1"],
      annotations: [registeredAnnotation],
      location: { file: specFilePath, line: 1, column: 1 },
      parent: fakeProjectSuite("chromium", specFilePath),
      repeatEachIndex: 0,
    } as unknown as TestCase;

    const result = await buildCasePlanForTest(test1, {
      projectRoot: root,
      runId: "fixture-run",
      retryAcceptance: "require-first-attempt",
      maxMaskedAreaRatio: 0.15,
      stabilitySamples: 2,
      policyDigest: `sha256:${"0".repeat(64)}`,
      source: {},
    });

    // The frozen case plan carries the digest that was true AT REGISTRATION TIME, not
    // the post-edit disk content buildCasePlanForTest would have observed had it
    // re-hashed the file fresh from disk here.
    expect(result.casePlan.specFileDigest).toBe(originalSpecDigest);
    expect(result.casePlan.specFileDigest).not.toBe(mutatedSpecDigest);
  });

  it("throws when the registered specFile doesn't match the file Playwright says registered this test", async () => {
    const root = tempDir("framelia-spec-identity-mismatch-");
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const binding = pinContract(root, { id: "login.desktop" });

    // `fakeContractTest`'s registered `specFile` (portable, computed from `wrong.spec.ts`)
    // disagrees with the fake TestCase's own file-suite title/project.testDir (via
    // `fakeProjectSuite`, resolving to `actual.spec.ts`) -- exactly the scenario a caller
    // passing an arbitrary, unrelated `specUrl` would produce: the embedded digest has
    // nothing to do with what Playwright's own collected file Suite says actually ran.
    const wrongSpecFile = path.join(root, "wrong.spec.ts");
    fs.writeFileSync(wrongSpecFile, "// not the file that actually registered this test\n");
    const actualSpecFile = path.join(root, "actual.spec.ts");
    fs.writeFileSync(actualSpecFile, "// the file Playwright says registered this test\n");
    const test = fakeContractTest({
      id: "t1",
      binding,
      specFile: actualSpecFile,
      root,
      registeredSpecFile: path.relative(root, wrongSpecFile).split(path.sep).join("/"),
    });

    await expect(
      buildCasePlanForTest(test, {
        projectRoot: root,
        runId: "fixture-run",
        retryAcceptance: "require-first-attempt",
        maxMaskedAreaRatio: 0.15,
        stabilitySamples: 2,
        policyDigest: `sha256:${"0".repeat(64)}`,
        source: {},
      }),
    ).rejects.toThrow(
      /registered specUrl \(wrong\.spec\.ts\) does not match the file Playwright says registered this test \(actual\.spec\.ts\)/,
    );
  });
});
