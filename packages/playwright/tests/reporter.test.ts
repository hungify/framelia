import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { verificationArtifactSchema } from "@framelia/contracts";
import { doneGateFromArtifact } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/internal";
import type { FullConfig, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { SCORE_ATTACHMENT_SUFFIX } from "../src/attach.ts";
import FrameliaReporter from "../src/reporter.ts";
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

function clientRootFixture(): string {
  const dir = tempDir("framelia-reporter-client-");
  fs.writeFileSync(path.join(dir, "index.html"), "<main>Framelia</main>");
  return dir;
}

function fakeTest(id: string, title: string, tags: string[] = []): TestCase {
  return {
    id,
    title,
    tags,
    titlePath: () => ["project", "file.spec.ts", title],
  } as unknown as TestCase;
}

function fakeConfig(rootDir: string): FullConfig {
  return { rootDir } as unknown as FullConfig;
}

function fakeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
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
    fileKey: "file-key",
    nodeId: "1:2",
    ...overrides,
  };
}

function captureEvidenceFixture() {
  const timestamp = new Date().toISOString();
  return {
    contract: null,
    capturePaths: [],
    ephemeralSamplePaths: [],
    capturedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    finalUrl: "http://localhost/",
    viewport: { width: 10, height: 10 },
    readiness: null,
    fonts: { supported: true, status: "loaded" as const, failed: [] },
    scope: { kind: "page" as const, fullPage: false },
    screenshotHashes: ["sha256:" + "0".repeat(64)],
    elementRect: null,
    computedStyle: null,
    warnings: [],
    actions: [],
    maskEvidence: null,
  };
}

function passedResult(name: string, overrides: Partial<FrameliaScoreAttachment> = {}): TestResult {
  return {
    status: "passed",
    attachments: [
      {
        name: `${name}${SCORE_ATTACHMENT_SUFFIX}`,
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(scoreAttachment(overrides))),
      },
    ],
  } as unknown as TestResult;
}

function passedResultWithImages(
  name: string,
  imageDir: string,
  overrides: Partial<FrameliaScoreAttachment> = {},
): TestResult {
  const png = PNG.sync.write(makeSolidPng(10, 10, [1, 2, 3, 255]));
  const expectedPath = path.join(imageDir, `${name}-expected.png`);
  const actualPath = path.join(imageDir, `${name}-actual.png`);
  const diffPath = path.join(imageDir, `${name}-diff.png`);
  for (const filePath of [expectedPath, actualPath, diffPath]) fs.writeFileSync(filePath, png);
  const score = scoreAttachment({
    captureEvidence: captureEvidenceFixture(),
    baselineFetchedAt: new Date(Date.now() - 1_000).toISOString(),
    ...overrides,
  });
  return {
    status: "passed",
    attachments: [
      { name: `${name}-expected`, contentType: "image/png", path: expectedPath },
      { name: `${name}-actual`, contentType: "image/png", path: actualPath },
      { name: `${name}-diff`, contentType: "image/png", path: diffPath },
      {
        name: `${name}${SCORE_ATTACHMENT_SUFFIX}`,
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(score)),
      },
    ],
  } as unknown as TestResult;
}

function failedResult(name: string, imageDir: string): TestResult {
  const png = PNG.sync.write(makeSolidPng(10, 10, [1, 2, 3, 255]));
  const expectedPath = path.join(imageDir, `${name}-expected.png`);
  const actualPath = path.join(imageDir, `${name}-actual.png`);
  const diffPath = path.join(imageDir, `${name}-diff.png`);
  fs.writeFileSync(expectedPath, png);
  fs.writeFileSync(actualPath, png);
  fs.writeFileSync(diffPath, png);
  return {
    status: "failed",
    error: { message: "toMatchFigma: did not match." },
    attachments: [
      { name: `${name}-expected`, contentType: "image/png", path: expectedPath },
      { name: `${name}-actual`, contentType: "image/png", path: actualPath },
      { name: `${name}-diff`, contentType: "image/png", path: diffPath },
      {
        name: `${name}${SCORE_ATTACHMENT_SUFFIX}`,
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify(scoreAttachment({ pass: false, matchRatio: 0.5, ssim: 0.5 })),
        ),
      },
    ],
  } as unknown as TestResult;
}

describe("FrameliaReporter", () => {
  it("drives a live dashboard reporting live:true during the run", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const testA = fakeTest("test-a", "homepage matches figma");

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([testA]));
    const url = await reporter.dashboardUrl();
    expect(url).toBeDefined();

    expect(await (await fetch(`${url}/api/meta`)).json()).toEqual({ live: true });
    const beforeEnd = await (await fetch(`${url}/api/run`)).json();
    expect(beforeEnd.contracts[0]).toMatchObject({ id: "test-a", status: "queued" });

    reporter.onTestEnd(testA, passedResult("test-a"));
    const afterTest = await (await fetch(`${url}/api/run`)).json();
    expect(afterTest.contracts[0]).toMatchObject({ id: "test-a", status: "passed" });

    await reporter.onEnd({ status: "passed" } as any);
    // Server closes at onEnd; further fetches to `url` would now fail, which itself confirms shutdown.
  });

  it("does not crash and reports an empty run cleanly when zero tests are seeded", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([]));
    const url = await reporter.dashboardUrl();
    const run = await (await fetch(`${url}/api/run`)).json();
    expect(run.contracts).toEqual([]);
    expect(run.summary.total).toBe(0);

    await expect(reporter.onEnd({ status: "passed" } as any)).resolves.toBeUndefined();
  });

  it("writes a VerificationArtifact per test that done-gate/report/open can read without error (R13)", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const imageDir = tempDir("framelia-reporter-images-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const testA = fakeTest("test-a", "passes");
    const testB = fakeTest("test-b", "fails");

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([testA, testB]));
    reporter.onTestEnd(testA, passedResultWithImages("test-a", imageDir));
    reporter.onTestEnd(testB, failedResult("test-b", imageDir));
    await reporter.onEnd({ status: "failed" } as any);

    const artifactPathB = path.join(
      projectRoot,
      ".framelia/visual-verifications/test-b/visual-verification.json",
    );
    expect(fs.existsSync(artifactPathB)).toBe(true);

    // report/open path: reading the artifact JSON + schema parse must not throw.
    const rawB = JSON.parse(fs.readFileSync(artifactPathB, "utf8"));
    const artifact = verificationArtifactSchema.parse(rawB);
    expect(artifact.allPassed).toBe(false);

    // done-gate path: must return a verdict, not throw.
    const verdict = doneGateFromArtifact(artifact);
    expect(verdict.done).toBe(false); // the failing match should not be done

    // visual-score.json exists with real comparison data for the failing test.
    const score = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, ".framelia/visual-verifications/test-b/visual-score.json"),
        "utf8",
      ),
    );
    expect(score).toMatchObject({ pass: false, matchRatio: 0.5 });

    const artifactPathA = path.join(
      projectRoot,
      ".framelia/visual-verifications/test-a/visual-verification.json",
    );
    const rawA = JSON.parse(fs.readFileSync(artifactPathA, "utf8"));
    const passArtifact = verificationArtifactSchema.parse(rawA);
    expect(passArtifact.allPassed).toBe(true);
    expect(doneGateFromArtifact(passArtifact).done).toBe(true);
    for (const name of [
      "visual-score.json",
      "run-meta.json",
      "punch-list.json",
      "figma-baseline.meta.json",
    ])
      expect(
        fs.existsSync(path.join(projectRoot, ".framelia/visual-verifications/test-a", name)),
      ).toBe(true);
  });

  it("persists every Figma matcher score attachment separately", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const imageDir = tempDir("framelia-reporter-images-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const testA = fakeTest("test-a", "two matcher calls");
    const first = passedResultWithImages("call-a", imageDir, { nodeId: "1:2" });
    const second = passedResultWithImages("call-b", imageDir, { nodeId: "2:3" });
    const result = {
      status: "passed",
      attachments: [...first.attachments, ...second.attachments],
    } as unknown as TestResult;

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([testA]));
    reporter.onTestEnd(testA, result);
    await reporter.onEnd({ status: "passed" } as any);

    for (const id of ["test-a-1", "test-a-2"])
      expect(
        fs.existsSync(
          path.join(projectRoot, ".framelia/visual-verifications", id, "visual-verification.json"),
        ),
      ).toBe(true);
  });

  it("records a toMatchPage/toMatchUrl (non-figma) result live but writes no VerificationArtifact (R9)", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const testA = fakeTest("test-a", "page matches url");

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([testA]));
    reporter.onTestEnd(testA, passedResult("test-a", { baselineKind: "web" }));
    const url = await reporter.dashboardUrl();
    const run = await (await fetch(`${url}/api/run`)).json();
    expect(run.contracts[0]).toMatchObject({
      id: "test-a",
      status: "passed",
      baselineKind: "page",
    });

    await reporter.onEnd({ status: "passed" } as any);

    const artifactPath = path.join(
      projectRoot,
      ".framelia/visual-verifications/test-a/visual-verification.json",
    );
    expect(fs.existsSync(artifactPath)).toBe(false);
  });

  it("subscribers see order-independent live updates as tests complete out of order", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const tests = [fakeTest("a", "a"), fakeTest("b", "b"), fakeTest("c", "c")];
    reporter.onBegin(fakeConfig(projectRoot), fakeSuite(tests));

    reporter.onTestEnd(tests[2]!, passedResult("c"));
    reporter.onTestEnd(tests[0]!, passedResult("a"));
    reporter.onTestEnd(tests[1]!, passedResult("b"));

    const url = await reporter.dashboardUrl();
    const run = await (await fetch(`${url}/api/run`)).json();
    expect(run.summary).toMatchObject({ total: 3, passed: 3, queued: 0 });

    await reporter.onEnd({ status: "passed" } as any);
  });

  it("gives a timed-out test a distinct blocker code instead of a generic match-failure message", async () => {
    const projectRoot = tempDir("framelia-reporter-run-");
    const clientRoot = clientRootFixture();
    const reporter = new FrameliaReporter({ projectRoot, clientRoot, port: 0 });
    const testA = fakeTest("test-a", "times out");

    reporter.onBegin(fakeConfig(projectRoot), fakeSuite([testA]));
    // A timed-out test never reaches the matcher, so it carries no score attachment.
    reporter.onTestEnd(testA, { status: "timedOut", attachments: [] } as unknown as TestResult);

    const url = await reporter.dashboardUrl();
    const run = await (await fetch(`${url}/api/run`)).json();
    expect(run.contracts[0]).toMatchObject({ id: "test-a", status: "failed" });
    expect(run.contracts[0].blockers[0]).toMatchObject({ code: "TEST_TIMEDOUT" });

    // No score attachment means no figma-baselined contract, so nothing definitive
    // is persisted claiming a real pass/fail comparison happened.
    await reporter.onEnd({ status: "timedOut" } as any);
    const artifactPath = path.join(
      projectRoot,
      ".framelia/visual-verifications/test-a/visual-verification.json",
    );
    expect(fs.existsSync(artifactPath)).toBe(false);
  });
});
