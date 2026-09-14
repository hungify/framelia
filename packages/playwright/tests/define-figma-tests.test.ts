import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  authoredContractSchema,
  baselineSnapshotSchema,
  contractBindingSchema,
} from "@framelia/contracts/workflow";
import type { AuthoredContract, BaselineSnapshot } from "@framelia/contracts/workflow";
import { canonicalJsonDigest, readPinnedBaseline } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/testing";
import { chromium } from "@playwright/test";
import type { TestType } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  assertDeviceScaleFactorAgreement,
  defineFigmaTests,
  reconcileViewport,
  runFigmaContractTest,
} from "../src/define-figma-tests.ts";

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
      prepare: async () => {
        prepareCalls++;
      },
    });

    expect(registered).toHaveLength(2);
    expect(registered.map((entry) => entry.title)).toEqual(["Login · Desktop", "Login · Mobile"]);
    expect(prepareCalls).toBe(0);

    const bindings = registered.map((entry) => {
      expect(entry.details.annotation.type).toBe("framelia.contract");
      return contractBindingSchema.parse(JSON.parse(entry.details.annotation.description));
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
    defineFigmaTests(test, { contracts: files, prepare: async () => undefined });

    expect(registered.map((entry) => entry.title)).toEqual(["Login · a", "Login · b", "Login · c"]);
  });

  it("resolves URL contract inputs the same module-relative way the public example shows", () => {
    const root = temporaryRoot();
    const filePath = writeContractFile(root, "visual-contract.json", validContract);

    const { test, registered } = fakeTest();
    defineFigmaTests(test, { contracts: pathToFileURL(filePath), prepare: async () => undefined });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.title).toBe("Login · Desktop");
  });

  it("throws a clear error for a contract file that is not valid JSON", () => {
    const root = temporaryRoot();
    const filePath = path.join(root, "broken.json");
    fs.writeFileSync(filePath, "{not json");

    const { test } = fakeTest();
    expect(() =>
      defineFigmaTests(test, { contracts: filePath, prepare: async () => undefined }),
    ).toThrow(/not valid JSON/);
  });

  it("throws a clear error for a contract file that fails schema validation", () => {
    const root = temporaryRoot();
    const filePath = writeContractFile(root, "invalid.json", { not: "a contract" });

    const { test } = fakeTest();
    expect(() =>
      defineFigmaTests(test, { contracts: filePath, prepare: async () => undefined }),
    ).toThrow(/schema validation/);
  });

  it("throws when given an empty contracts array", () => {
    const { test } = fakeTest();
    expect(() => defineFigmaTests(test, { contracts: [], prepare: async () => undefined })).toThrow(
      /at least one contract file/,
    );
  });
});
