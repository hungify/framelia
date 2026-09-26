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
} from "@framelia/contracts/workflow";
import type { AuthoredContract, BaselineSnapshot } from "@framelia/contracts/workflow";
import { canonicalJsonDigest, readPinnedBaseline } from "@framelia/verify";
import * as verify from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/testing";
import { chromium } from "@playwright/test";
import type { TestInfo, TestType } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  assertDeviceScaleFactorAgreement,
  defineFigmaTests,
  reconcileViewport,
  runFigmaContractTest,
} from "../src/define-figma-tests.ts";

// Only safe for a test that never reaches `defineFigmaTests`'s per-contract
// registration loop (an empty `contracts` array, or a contract file that fails to
// load/parse before the loop's `specFile`/`specDigest` embedding step) -- those never
// resolve `specFile` against a project root, so this file's own (unrelated) location
// never needs to be project-relative to anything. Every other test uses `specFixture`
// below, which writes a real spec file *inside* the test's own project root.
const TEST_SPEC_URL = new URL(import.meta.url);

const browser = await chromium.launch();
afterAll(() => browser.close());

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-define-figma-tests-"));
  temporaryDirectories.push(root);
  return root;
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Writes a pinned baseline (snapshot.json + image bytes) under `root` for a page-scope
 *  contract, and returns the matching, digest-consistent `AuthoredContract`. Mirrors what
 *  `framelia contract refresh-baseline` (WP7, out of scope) would produce on disk. */
function pinPageBaseline(
  root: string,
  options: {
    id: string;
    name: string;
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
    color: [number, number, number, number];
  },
): AuthoredContract {
  const deviceScaleFactor = options.deviceScaleFactor ?? 1;
  const imageWidth = options.viewport.width * deviceScaleFactor;
  const imageHeight = options.viewport.height * deviceScaleFactor;
  const imageBytes = PNG.sync.write(makeSolidPng(imageWidth, imageHeight, options.color));
  const imageDigest: `sha256:${string}` = `sha256:${sha256(imageBytes)}`;

  const snapshot: BaselineSnapshot = baselineSnapshotSchema.parse({
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    rendering: {
      viewport: {
        preset: "desktop",
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor,
    },
    expected: {
      kind: "page",
      image: {
        path: `${options.id}.png`,
        digest: imageDigest,
        width: imageWidth,
        height: imageHeight,
      },
    },
  });
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root, `${options.id}.png`), imageBytes);

  return authoredContractSchema.parse({
    formatVersion: 1,
    kind: "framelia.contract",
    id: options.id,
    name: options.name,
    revision: 1,
    target: { path: `/${options.id}` },
    viewport: { preset: "desktop", width: options.viewport.width, height: options.viewport.height },
    scope: { kind: "page", pageReason: "full page review" },
    baseline: { snapshotDigest },
  });
}

async function server(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const app = http.createServer((_request, response) => response.end(html));
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve()))),
  };
}

function solidHtml(
  size: { width: number; height: number },
  color: [number, number, number],
): string {
  return `<style>html,body{margin:0}body{width:${size.width}px;height:${size.height}px;background:rgb(${color.join(",")})}</style>`;
}

describe("reconcileViewport / assertDeviceScaleFactorAgreement (glue-level guards)", () => {
  it("applies the contract's viewport when the page's viewport is still Playwright's own default", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      await reconcileViewport(page, { width: 400, height: 300 }, "example.desktop");
      expect(page.viewportSize()).toEqual({ width: 400, height: 300 });
    } finally {
      await context.close();
    }
  });

  it("fails explicitly -- without reloading or resizing -- when a fixture already customized the viewport to a disagreeing size", async () => {
    const context = await browser.newContext({ viewport: { width: 500, height: 500 } });
    try {
      const page = await context.newPage();
      const app = await server(solidHtml({ width: 500, height: 500 }, [1, 2, 3]));
      await page.goto(app.url);
      // Simulates a custom fixture's own setup work, run before defineFigmaTests's own
      // test body -- the marker below stands in for whatever state that fixture built.
      await page.evaluate(() => {
        (window as unknown as { fixtureMarker: string }).fixtureMarker = "fixture-ran";
      });

      await expect(
        reconcileViewport(page, { width: 400, height: 300 }, "example.desktop"),
      ).rejects.toThrow(/already set a custom viewport/);

      // No reload/navigation happened as part of the failed reconciliation: the marker
      // set before the call, and the viewport itself, both survive untouched.
      expect(page.viewportSize()).toEqual({ width: 500, height: 500 });
      const marker = await page.evaluate(
        () => (window as unknown as { fixtureMarker?: string }).fixtureMarker,
      );
      expect(marker).toBe("fixture-ran");
      await app.close();
    } finally {
      await context.close();
    }
  });

  it("resolves when the live devicePixelRatio matches the pinned deviceScaleFactor", async () => {
    const context = await browser.newContext({
      viewport: { width: 100, height: 80 },
      deviceScaleFactor: 2,
    });
    try {
      const page = await context.newPage();
      await expect(
        assertDeviceScaleFactorAgreement(page, 2, "example.desktop"),
      ).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it("fails explicitly (not a silent miscompare) when the live devicePixelRatio disagrees with the pinned deviceScaleFactor", async () => {
    const context = await browser.newContext({ viewport: { width: 100, height: 80 } });
    try {
      const page = await context.newPage();
      await expect(assertDeviceScaleFactorAgreement(page, 2, "example.desktop")).rejects.toThrow(
        /pinned at deviceScaleFactor 2.*actual devicePixelRatio is 1/s,
      );
    } finally {
      await context.close();
    }
  });
});

describe("runFigmaContractTest (runner-agnostic core)", () => {
  it("passes a pinned comparison with zero Figma network reachable", async () => {
    const root = temporaryRoot();
    const SIZE = { width: 100, height: 80 };
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      color: [100, 150, 200, 255],
    });
    const pinnedBaseline = await readPinnedBaseline(root, contract);
    const app = await server(solidHtml(SIZE, [100, 150, 200]));
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-define-figma-tests-work-"));
    const attachCalls: Array<{ name: string; path: string }> = [];
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];

    globalThis.fetch = (() => {
      throw new Error("runFigmaContractTest must never call fetch");
    }) as typeof fetch;

    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
        timeoutMs: 5_000,
        workDir,
        stabilitySamples: 2,
        attach: async (name, filePath) => {
          attachCalls.push({ name, path: filePath });
        },
        attachJson: async (name, data) => {
          attachJsonCalls.push({ name, data });
        },
      });

      expect(result.pass).toBe(true);
      expect(attachCalls.length).toBeGreaterThanOrEqual(2);
      expect(attachJsonCalls).toHaveLength(1);
      expect(attachJsonCalls[0]?.data).toMatchObject({ pass: true, baselineKind: "figma" });
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails a pinned comparison that diverges, attaching diagnostics", async () => {
    const root = temporaryRoot();
    const SIZE = { width: 100, height: 80 };
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      color: [0, 0, 0, 255],
    });
    const pinnedBaseline = await readPinnedBaseline(root, contract);
    const app = await server(solidHtml(SIZE, [255, 255, 255]));
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-define-figma-tests-work-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];

    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
        timeoutMs: 5_000,
        workDir,
        stabilitySamples: 2,
        attach: async () => undefined,
        attachJson: async (name, data) => {
          attachJsonCalls.push({ name, data });
        },
      });

      expect(result.pass).toBe(false);
      expect(attachJsonCalls[0]?.data).toMatchObject({ pass: false });
      const data = attachJsonCalls[0]?.data;
      expect(data && typeof data === "object" && "topIssues" in data).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("captures and compares correctly at deviceScaleFactor 2 through the pinned path", async () => {
    const root = temporaryRoot();
    const SIZE = { width: 60, height: 50 };
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      deviceScaleFactor: 2,
      color: [10, 20, 30, 255],
    });
    const pinnedBaseline = await readPinnedBaseline(root, contract);
    expect(pinnedBaseline.snapshot.rendering.deviceScaleFactor).toBe(2);
    const app = await server(solidHtml(SIZE, [10, 20, 30]));
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2 });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-define-figma-tests-work-"));

    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
        timeoutMs: 5_000,
        workDir,
        stabilitySamples: 2,
        attach: async () => undefined,
        attachJson: async () => undefined,
      });

      expect(result.pass).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("rejects clearly (not silently) when the pinned deviceScaleFactor disagrees with the actual capture's resolution", async () => {
    const root = temporaryRoot();
    const SIZE = { width: 60, height: 50 };
    // Pinned at 2x, but the real context below stays at the default (1x) --
    // captureReadyPage's own live devicePixelRatio check (core.ts) now rejects this
    // before ever attempting a screenshot, rather than letting it through to a later,
    // harder-to-diagnose compare() dimension mismatch.
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      deviceScaleFactor: 2,
      color: [10, 20, 30, 255],
    });
    const pinnedBaseline = await readPinnedBaseline(root, contract);
    const app = await server(solidHtml(SIZE, [10, 20, 30]));
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-define-figma-tests-work-"));

    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runFigmaContractTest(page, contract, pinnedBaseline, {
        timeoutMs: 5_000,
        workDir,
        stabilitySamples: 2,
        attach: async () => undefined,
        attachJson: async () => undefined,
      });

      expect(result.pass).toBe(false);
      expect(result.message).toMatch(/CAPTURE_SCALE_MISMATCH/);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

/** Fake `TestType`-shaped double: captures every registered `test(title, details, fn)`
 *  call without any real Playwright runtime -- proves defineFigmaTests's registration
 *  logic (contract loading/validation, digest computation, annotation payload,
 *  one-call-per-contract fan-out) without needing `playwright test` to run it. Never
 *  invokes the registered `fn` -- proving collection alone never executes `prepare`. */
interface RegisteredTest {
  title: string;
  details: { annotation: { type: string; description: string } };
  fn: (...args: unknown[]) => unknown;
}

function fakeTest(): { test: TestType<{ page: never }, object>; registered: RegisteredTest[] } {
  const registered: RegisteredTest[] = [];
  const test = ((title: string, details: unknown, fn: (...args: unknown[]) => unknown) => {
    registered.push({ title, details: details as RegisteredTest["details"], fn });
  }) as unknown as TestType<{ page: never }, object>;
  return { test, registered };
}

function writeContractFile(root: string, relativePath: string, contract: unknown): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(contract));
  return filePath;
}

/** Writes a placeholder spec file under `root` and returns both its `file://` URL (for
 *  `options.specUrl`) and its absolute path (fed into `fakeTestInfo`'s own `file`
 *  option, which splits it into `project.testDir` + `titlePath[0]` -- see that
 *  function's own doc comment) -- stands in for "the calling spec file" living
 *  alongside its own project, the way a real spec file always does. */
function specFixture(root: string, name = "fixture.spec.ts"): { url: URL; path: string } {
  const specPath = path.join(root, name);
  fs.writeFileSync(specPath, "// fixture spec file\n");
  return { url: pathToFileURL(specPath), path: specPath };
}

const validContract = {
  formatVersion: 1,
  kind: "framelia.contract",
  id: "login.desktop",
  name: "Login · Desktop",
  revision: 1,
  target: { path: "/login" },
  viewport: { preset: "desktop", width: 100, height: 80 },
  scope: { kind: "page", pageReason: "full page review" },
  baseline: { snapshotDigest: `sha256:${"0".repeat(64)}` },
};

describe("defineFigmaTests (registration)", () => {
  it("registers exactly one test per contract file, annotated with versioned framelia.contract metadata, and never runs prepare during collection", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const desktopFile = writeContractFile(root, "specs/login.desktop.json", validContract);
    const mobileFile = writeContractFile(root, "specs/login.mobile.json", {
      ...validContract,
      id: "login.mobile",
      name: "Login · Mobile",
      viewport: { preset: "mobile", width: 375, height: 812 },
    });

    const { test, registered } = fakeTest();
    let prepareCalls = 0;
    defineFigmaTests(test, {
      contracts: [desktopFile, mobileFile],
      specUrl: specFixture(root).url,
      prepare: async () => {
        prepareCalls++;
      },
    });

    expect(registered).toHaveLength(2);
    expect(registered.map((entry) => entry.title)).toEqual(["Login · Desktop", "Login · Mobile"]);
    expect(prepareCalls).toBe(0);

    const bindings = registered.map((entry) => {
      expect(entry.details.annotation.type).toBe("framelia.contract");
      return testRegistrationSchema.parse(JSON.parse(entry.details.annotation.description)).binding;
    });
    for (const binding of bindings) {
      expect(binding.contractDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(binding.contractFile).not.toContain("\\");
    }
    expect(bindings[0]).toMatchObject({
      contractId: "login.desktop",
      contractFile: "specs/login.desktop.json",
    });
  });

  it("registers a parameterized contracts array from one call site, collecting distinct titles per entry", () => {
    const root = temporaryRoot();
    const files = ["a", "b", "c"].map((suffix) =>
      writeContractFile(root, `${suffix}.json`, {
        ...validContract,
        id: `login.${suffix}`,
        name: `Login · ${suffix}`,
      }),
    );

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: files,
      specUrl: specFixture(root).url,
      prepare: async () => undefined,
    });

    expect(registered.map((entry) => entry.title)).toEqual(["Login · a", "Login · b", "Login · c"]);
  });

  it("resolves URL contract inputs the same module-relative way the public example shows", () => {
    const root = temporaryRoot();
    const filePath = writeContractFile(root, "visual-contract.json", validContract);

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: pathToFileURL(filePath),
      specUrl: specFixture(root).url,
      prepare: async () => undefined,
    });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.title).toBe("Login · Desktop");
  });

  it("throws a clear error for a contract file that is not valid JSON", () => {
    const root = temporaryRoot();
    const filePath = path.join(root, "broken.json");
    fs.writeFileSync(filePath, "{not json");

    const { test } = fakeTest();
    expect(() =>
      defineFigmaTests(test, {
        contracts: filePath,
        specUrl: TEST_SPEC_URL,
        prepare: async () => undefined,
      }),
    ).toThrow(/not valid JSON/);
  });

  it("throws a clear error for a contract file that fails schema validation", () => {
    const root = temporaryRoot();
    const filePath = writeContractFile(root, "invalid.json", { not: "a contract" });

    const { test } = fakeTest();
    expect(() =>
      defineFigmaTests(test, {
        contracts: filePath,
        specUrl: TEST_SPEC_URL,
        prepare: async () => undefined,
      }),
    ).toThrow(/schema validation/);
  });

  it("throws when given an empty contracts array", () => {
    const { test } = fakeTest();
    expect(() =>
      defineFigmaTests(test, {
        contracts: [],
        specUrl: TEST_SPEC_URL,
        prepare: async () => undefined,
      }),
    ).toThrow(/at least one contract file/);
  });
});

/** Minimal fake of the `TestInfo` members the registered callback actually calls
 *  (`project.name`/`project.testDir`, `titlePath`, `timeout`, `skip`, `outputPath`,
 *  `attach`) -- same runner-agnostic-core pattern as `attach.test.ts`'s own
 *  `fakeTestInfo`. `outputPath` mirrors real Playwright's own behavior: only
 *  `outputRoot` (this fake's stand-in for `testInfo.outputDir`) is guaranteed to
 *  exist -- extra path segments are joined onto it but never created. `file` is the
 *  absolute path this fake's test is declared in; split into `project.testDir`
 *  (its directory) and `titlePath[0]` (its basename) the same way real Playwright's
 *  own `TestInfo.titlePath` -- "the full title path starting with the test file
 *  name," relative to `testInfo.project.testDir` -- represents it. */
function fakeTestInfo(options: {
  outputRoot: string;
  file: string;
  projectName?: string;
}): TestInfo {
  return {
    project: { name: options.projectName ?? "chromium", testDir: path.dirname(options.file) },
    titlePath: [path.basename(options.file)],
    timeout: 5_000,
    skip: (condition?: boolean, reason?: string) => {
      if (condition) throw new Error(reason ?? "test skipped");
    },
    outputPath: (...parts: string[]) => {
      fs.mkdirSync(options.outputRoot, { recursive: true });
      return path.join(options.outputRoot, ...parts);
    },
    attach: async () => undefined,
  } as unknown as TestInfo;
}

describe("defineFigmaTests (execution — precapture reconciliation)", () => {
  it("throws instead of silently capturing when the contract file changes on disk after registration, before the test body runs", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const contractPath = writeContractFile(root, "login.desktop.json", validContract);
    const spec = specFixture(root);

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: contractPath,
      specUrl: spec.url,
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);
    const registeredBinding = testRegistrationSchema.parse(
      JSON.parse(registered[0]!.details.annotation.description),
    ).binding;

    // A -> B: the contract is edited on disk after registration/collection, before this
    // test's body ever runs -- exactly the exploitable window this fix closes.
    writeContractFile(root, "login.desktop.json", {
      ...validContract,
      revision: 2,
      viewport: { preset: "desktop", width: 999, height: 999 },
    });

    let caught: unknown;
    try {
      await registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /contract "login\.desktop" changed on disk after test collection/,
    );
    expect((caught as Error).message).toContain(registeredBinding.contractDigest);
  });

  it("throws instead of silently capturing when the spec file itself changes on disk after registration, before the test body runs", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const contractPath = writeContractFile(root, "login.desktop.json", validContract);
    const specFixturePath = path.join(root, "fixture.spec.ts");
    fs.writeFileSync(specFixturePath, "// original spec content\n");

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: contractPath,
      specUrl: pathToFileURL(specFixturePath),
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);

    // A -> B: the *spec file itself* is edited on disk after registration/collection,
    // before this test's own body ever runs -- the wider window `specUrl`'s own
    // precapture check closes, beyond the narrower registration-vs-onBegin window the
    // registration-time freeze alone protects.
    fs.writeFileSync(specFixturePath, "// edited after registration, before this test ran\n");

    let caught: unknown;
    try {
      await registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: specFixturePath }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/spec file .* changed on disk after test collection/);
    expect((caught as Error).message).toContain(specFixturePath);
  });

  it("throws instead of silently capturing when specUrl points at a different file than the one Playwright says registered this test", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const contractPath = writeContractFile(root, "login.desktop.json", validContract);
    // `specUrl` points at a real, unrelated file this call site does NOT actually
    // execute from -- the misuse (or malice) this check exists to catch: a caller could
    // otherwise pass a stable, unrelated file whose digest has nothing to do with what's
    // actually running, and nothing would ever notice.
    const wrongSpec = specFixture(root, "wrong.spec.ts");
    const actualSpecFile = path.join(root, "actual.spec.ts");

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: contractPath,
      specUrl: wrongSpec.url,
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);

    let caught: unknown;
    try {
      // The fake `TestInfo` (`project.testDir`/`titlePath[0]`, resolved to
      // `actualSpecFile`) -- Playwright's own runtime-authoritative "which file
      // registered this test" -- disagrees with the registered `specUrl` from the
      // very first execution; no mutation is needed to trigger this.
      await registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: actualSpecFile }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /registered specUrl \(wrong\.spec\.ts\) does not match the file Playwright says registered this test \(actual\.spec\.ts\)/,
    );
  });

  it("throws instead of silently capturing when the project policy's derived digest changes on disk (an env file appears) after registration, before the test body runs", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const contractPath = writeContractFile(root, "login.desktop.json", validContract);
    const spec = specFixture(root);

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: contractPath,
      specUrl: spec.url,
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);

    // Deterministic synchronization, not a guessed timer duration: invoke the callback
    // once so its own `await policyPromise` line settles against the pre-mutation state.
    // Nothing has drifted yet, so it clears both precapture checks and only fails later,
    // at the (expected, irrelevant here) baseline lookup -- that failure is itself the
    // signal that `policyPromise` already resolved by the time this settled.
    await expect(
      registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      ),
    ).rejects.toThrow(/Pinned baseline snapshot/);

    // The config file's own raw bytes are untouched here -- only a `.env` file's
    // *existence* changes, which resolveProjectPolicy folds into policyDigest via
    // `environment.loadedFiles` (existence-tracked, not content-tracked). This proves
    // the semantic policyDigest check catches drift the synchronous raw-config-bytes
    // fingerprint (checked first, see the test above) cannot -- they're independent,
    // not redundant.
    fs.writeFileSync(path.join(root, ".env"), "SOME_KEY=value\n");

    let caught: unknown;
    try {
      await registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /project policy for contract "login\.desktop" changed on disk after test collection/,
    );
  });

  it("completes the full A -> B -> A sequence: capture proceeds once the contract is reverted to what was registered", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const SIZE = { width: 100, height: 80 };
    const contractA = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      color: [100, 150, 200, 255],
    });
    const contractPath = writeContractFile(root, "login.desktop.json", contractA);
    const spec = specFixture(root);
    const app = await server(solidHtml(SIZE, [100, 150, 200]));
    const context = await browser.newContext({ viewport: SIZE });

    try {
      const page = await context.newPage();
      const { test, registered } = fakeTest();
      defineFigmaTests(test, {
        contracts: contractPath,
        specUrl: spec.url,
        prepare: async ({ page: preparedPage }) => {
          await preparedPage.goto(app.url);
        },
      });
      expect(registered).toHaveLength(1);

      // A -> B: mutate to a different, still-valid contract before the callback runs.
      writeContractFile(root, "login.desktop.json", { ...contractA, revision: 2 });
      await expect(
        registered[0]!.fn({ page }, fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path })),
      ).rejects.toThrow(/changed on disk after test collection/);

      // B -> A: revert exactly back to what was registered -- the same object reference,
      // so its canonical digest is byte-identical to what was frozen at registration.
      writeContractFile(root, "login.desktop.json", contractA);
      const result = await registered[0]!.fn(
        { page },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
      expect(result).toBeUndefined();
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("catches a project config mutation that the async policy-resolution check alone can never see, for a CommonJS-scoped config file", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    // `.ts` (with no `package.json` anywhere above `root` declaring `"type": "module"`,
    // true for any fresh os.tmpdir() path) resolves through `resolveProjectPolicy`'s
    // CommonJS branch (`tsxRequire`, not the ESM `tsImport` dynamic-import path) --
    // see `importConfigModule`'s own module-type branching in project-policy.ts. Node's
    // CommonJS `require()` cache is keyed by resolved absolute path and never
    // invalidates on content change for the life of the process: this isn't a narrow
    // timing race like the `.mjs`/dynamic-`import()` path can hit -- every
    // `resolveProjectPolicy()` call after the first, for this exact path, is
    // permanently stuck returning the *original* cached module, no matter how long
    // afterward the file actually changes on disk or how much real time passes. That
    // makes this 100% deterministic to reproduce (not timing-dependent at all), and
    // exactly the module-type-dependent risk this fix's own doc comment calls out.
    fs.writeFileSync(path.join(root, "framelia.config.ts"), "export default {};\n");
    const contractPath = writeContractFile(root, "login.desktop.json", validContract);
    const spec = specFixture(root);

    const { test, registered } = fakeTest();
    defineFigmaTests(test, {
      contracts: contractPath,
      specUrl: spec.url,
      prepare: async () => undefined,
    });
    expect(registered).toHaveLength(1);

    fs.writeFileSync(
      path.join(root, "framelia.config.ts"),
      'export default { retryAcceptance: "allow-passed-after-retry" };\n',
    );

    let caught: unknown;
    try {
      await registered[0]!.fn(
        { page: {} },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /project config file for contract "login\.desktop" changed on disk after test collection/,
    );
  });

  it("compares against the baseline bytes verified before capture, not bytes swapped at the shared path afterward", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const SIZE = { width: 100, height: 80 };
    const MATCH_COLOR: [number, number, number, number] = [100, 150, 200, 255];
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      color: MATCH_COLOR,
    });
    const contractPath = writeContractFile(root, "login.desktop.json", contract);
    const spec = specFixture(root);
    const app = await server(solidHtml(SIZE, [MATCH_COLOR[0], MATCH_COLOR[1], MATCH_COLOR[2]]));
    const context = await browser.newContext({ viewport: SIZE });
    const sharedImagePath = path.join(root, "login.desktop.png");
    const originalImageBytes = fs.readFileSync(sharedImagePath);

    try {
      const page = await context.newPage();
      const { test, registered } = fakeTest();
      defineFigmaTests(test, {
        contracts: contractPath,
        specUrl: spec.url,
        prepare: async ({ page: preparedPage }) => {
          await preparedPage.goto(app.url);
          // readPinnedBaseline already verified and (per this fix) already copied the
          // baseline image into the private workDir by the time prepare() runs -- swap
          // the *shared* path to something that would obviously mismatch if compare()
          // ever re-read it instead of the copy.
          fs.writeFileSync(
            sharedImagePath,
            PNG.sync.write(makeSolidPng(SIZE.width, SIZE.height, [0, 0, 0, 255])),
          );
        },
      });
      expect(registered).toHaveLength(1);

      const result = await registered[0]!.fn(
        { page },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
      expect(result).toBeUndefined();

      // Confirms the swap actually happened -- the pass above reflects the private
      // copy, not these (now-different) live shared bytes.
      expect(fs.readFileSync(sharedImagePath)).not.toEqual(originalImageBytes);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("cannot be defeated even by mutating the shared baseline the instant readPinnedBaseline resolves -- the earliest window reachable from outside defineFigmaTests", async () => {
    // readPinnedBaseline now reads and verifies the shared baseline image's bytes
    // exactly once, and defineFigmaTests writes those exact verified bytes into the
    // private workDir straight from that in-memory buffer -- it never re-reads the
    // shared path. This test proves it: it swaps the shared image file the instant
    // readPinnedBaseline resolves, before reconcileViewport, before
    // assertDeviceScaleFactorAgreement, before prepare(), before anything else in
    // defineFigmaTests's own callback runs. If any code anywhere in this chain still
    // re-read the shared path instead of reusing readPinnedBaseline's own verified
    // bytes, the capture below would compare against the swapped (black) image and
    // fail; it doesn't.
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const SIZE = { width: 100, height: 80 };
    const MATCH_COLOR: [number, number, number, number] = [100, 150, 200, 255];
    const contract = pinPageBaseline(root, {
      id: "login.desktop",
      name: "Login · Desktop",
      viewport: SIZE,
      color: MATCH_COLOR,
    });
    const contractPath = writeContractFile(root, "login.desktop.json", contract);
    const spec = specFixture(root);
    const app = await server(solidHtml(SIZE, [MATCH_COLOR[0], MATCH_COLOR[1], MATCH_COLOR[2]]));
    const context = await browser.newContext({ viewport: SIZE });
    const sharedImagePath = path.join(root, "login.desktop.png");
    const originalImageBytes = fs.readFileSync(sharedImagePath);

    // Captured before vi.spyOn below replaces the module's exported binding -- a real
    // reference to the true, unmocked implementation, not a live binding that would
    // itself resolve to the mock.
    const actualReadPinnedBaseline = readPinnedBaseline;
    const spy = vi.spyOn(verify, "readPinnedBaseline").mockImplementation(async (...args) => {
      const verified = await actualReadPinnedBaseline(...args);
      fs.writeFileSync(
        sharedImagePath,
        PNG.sync.write(makeSolidPng(SIZE.width, SIZE.height, [0, 0, 0, 255])),
      );
      return verified;
    });

    try {
      const page = await context.newPage();
      const { test, registered } = fakeTest();
      defineFigmaTests(test, {
        contracts: contractPath,
        specUrl: spec.url,
        prepare: async ({ page: preparedPage }) => {
          await preparedPage.goto(app.url);
        },
      });
      expect(registered).toHaveLength(1);

      const result = await registered[0]!.fn(
        { page },
        fakeTestInfo({ outputRoot: temporaryRoot(), file: spec.path }),
      );
      expect(result).toBeUndefined();

      // Confirms the swap actually happened -- the pass above reflects the bytes
      // readPinnedBaseline verified before the swap, not these (now-different) live
      // shared bytes.
      expect(fs.readFileSync(sharedImagePath)).not.toEqual(originalImageBytes);
    } finally {
      spy.mockRestore();
      await context.close();
      await app.close();
    }
  });
});
