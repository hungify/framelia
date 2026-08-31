// Exercises the Figma-to-web CLI commands a dev actually reaches for while iterating
// locally -- author a contract against a Figma baseline, inspect the diff, capture/
// compare PNGs by hand -- through the installed `framelia` bin (node_modules/.bin),
// against scratch project roots so nothing here touches the repo's own `.framelia/`
// state. Command-level validation (prompts, flag parsing, error messages) is already
// unit-tested in packages/cli/tests/*.test.ts; this is the "does the guideline
// actually work end to end" layer.
//
// Deliberately out of scope for this pass: `baseline promote` (that's the web-to-web
// page-to-page workflow, not Figma-to-web) and `done-gate`/`report` (CI-facing gate and
// archival export, not the local dev loop). `framelia auth` is also not driven here: it
// opens its own headed browser and blocks on an interactive terminal confirm with no
// hook for a test process to reach into that browser (see
// packages/verify/src/auth.ts's `waitForUser`). Its storage-state capture/consumption
// contract is proven indirectly by e2e/fixtures/auth.setup.ts +
// e2e/specs/authenticated.spec.ts, which exercise the same mechanism `framelia auth`
// automates for humans.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { deflateSync } from "node:zlib";

import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";
// `framelia` re-exports @framelia/contracts/@framelia/verify wholesale (see
// packages/cli/src/index.ts) -- importing through it avoids declaring those packages
// as direct deps of this app just for a test fixture.
import { SCHEMA_VERSION, type VerificationArtifact } from "framelia";

const FRAMELIA_BIN = path.resolve("node_modules/.bin/framelia");
const FIGMA_FILE_KEY = "6OWioRfOFWhE2ymylsPSH4";
const FIGMA_NODE_ID = "1037:71575";
const hasFigmaConfig = Boolean(process.env.FIGMA_ACCESS_TOKEN);

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [FRAMELIA_BIN, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tempProjectRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test.describe("framelia CLI: offline commands", () => {
  test("status reports CLI mode and capabilities", () => {
    const { status, stdout } = runCli(["status"]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ name: "framelia", mode: "cli" });
  });

  test("schema prints a valid JSON Schema for both targets", () => {
    for (const target of ["contract", "artifact"]) {
      const { status, stdout } = runCli(["schema", "--target", target]);
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ type: "object" });
    }
  });

  test("init scaffolds a config once, and refuses a second run without --force", () => {
    const projectRoot = tempProjectRoot("framelia-cli-init-");

    const first = runCli(["init", "--project-root", projectRoot]);
    expect(first.status).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(true);

    const second = runCli(["init", "--project-root", projectRoot]);
    expect(second.status).not.toBe(0);

    const forced = runCli(["init", "--project-root", projectRoot, "--force"]);
    expect(forced.status).toBe(0);
  });
});

test.describe("framelia CLI: needs the running app", () => {
  test("contract create writes a schema-valid page-scope contract", async ({ baseURL }) => {
    const projectRoot = tempProjectRoot("framelia-cli-contract-page-");
    const { status } = runCli([
      "contract",
      "create",
      "--project-root",
      projectRoot,
      "--target-url",
      `${baseURL}/login`,
      "--contract-id",
      "login.desktop",
      "--file-key",
      FIGMA_FILE_KEY,
      "--node-id",
      FIGMA_NODE_ID,
      "--viewport",
      "desktop",
      "--scope",
      "page",
      "--page-reason",
      "Baseline node represents complete page.",
      "--style-check-selector",
      '[data-testid="login-email"]',
      "--style-check-node-id",
      FIGMA_NODE_ID,
    ]);
    expect(status).toBe(0);

    const contract = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(contract).toMatchObject({
      contracts: [
        {
          id: "login.desktop",
          scope: { kind: "page" },
          viewport: { name: "desktop", width: 1440, height: 1024 },
        },
      ],
    });
  });

  test("contract create adds a second viewport to an existing contract file without --force", async ({
    baseURL,
  }) => {
    const projectRoot = tempProjectRoot("framelia-cli-contract-multi-viewport-");
    const baseArgs = (contractId: string, viewport: string) => [
      "contract",
      "create",
      "--project-root",
      projectRoot,
      "--target-url",
      `${baseURL}/login`,
      "--contract-id",
      contractId,
      "--file-key",
      FIGMA_FILE_KEY,
      "--node-id",
      FIGMA_NODE_ID,
      "--viewport",
      viewport,
      "--scope",
      "page",
      "--page-reason",
      "Baseline node represents complete page.",
    ];

    const first = runCli(baseArgs("login.desktop", "desktop"));
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Created");

    const second = runCli(baseArgs("login.mobile", "mobile"));
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Added contract to");

    const contract = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(contract).toMatchObject({
      contracts: [{ id: "login.desktop" }, { id: "login.mobile" }],
    });

    // Re-running the same id without --force must not silently drop the sibling contract.
    const collision = runCli(baseArgs("login.desktop", "desktop"));
    expect(collision.status).not.toBe(0);
    const stillIntact = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, ".framelia/visual-verifications/login/visual-contract.json"),
        "utf8",
      ),
    );
    expect(stillIntact.contracts).toHaveLength(2);
  });

  test("contract create writes a schema-valid region-scope contract", async ({ baseURL }) => {
    const projectRoot = tempProjectRoot("framelia-cli-contract-region-");
    const { status } = runCli([
      "contract",
      "create",
      "--project-root",
      projectRoot,
      "--target-url",
      `${baseURL}/login`,
      "--contract-id",
      "login.email-field",
      "--file-key",
      FIGMA_FILE_KEY,
      "--node-id",
      FIGMA_NODE_ID,
      "--viewport",
      "mobile",
      "--scope",
      "region",
      "--selector",
      '[data-testid="login-email"]',
      "--region-width",
      "320",
      "--region-height",
      "40",
    ]);
    expect(status).toBe(0);

    const contract = JSON.parse(
      fs.readFileSync(
        path.join(
          projectRoot,
          ".framelia/visual-verifications/login/visual-contract.json",
        ),
        "utf8",
      ),
    );
    expect(contract).toMatchObject({
      contracts: [
        { id: "login.email-field", scope: { kind: "region", selector: '[data-testid="login-email"]' } },
      ],
    });
  });

  test("contract suggest-masks proposes selectors without writing anything", async ({
    baseURL,
  }) => {
    const { status, stdout } = runCli([
      "contract",
      "suggest-masks",
      "--target-url",
      `${baseURL}/login`,
    ]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      url: expect.stringContaining("/login"),
      suggestions: expect.any(Array),
      note: expect.stringContaining("Proposals only"),
    });
  });
});

/**
 * Builds a schema-valid VerificationArtifact + its on-disk visual-score.json/PNG
 * evidence directly (mirroring packages/cli/tests/dashboard.test.ts's fixture),
 * instead of producing one through a live toMatchFigma run: that would need a real
 * FIGMA_ACCESS_TOKEN just to exercise `open`/`dashboard`, which only read this file
 * from disk and don't care how it was produced.
 */
async function writeVerificationArtifactFixture(
  projectRoot: string,
  featureId: string,
): Promise<{ artifactPath: string; outDir: string }> {
  const outDir = path.join(projectRoot, ".framelia/visual-verifications", featureId);
  await fsp.mkdir(outDir, { recursive: true });
  const baselinePath = path.join(outDir, "figma-baseline.png");
  const actualPath = path.join(outDir, "actual.png");
  const diffPath = path.join(outDir, "diff.png");
  await Promise.all([
    fsp.writeFile(baselinePath, Buffer.from([1, 2, 3])),
    fsp.writeFile(actualPath, Buffer.from([1, 2, 3])),
    fsp.writeFile(diffPath, Buffer.from([0, 0, 0])),
  ]);
  await fsp.writeFile(
    path.join(outDir, "visual-score.json"),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      pass: true,
      matchRatio: 1,
      ssim: 1,
      avgDeltaE: 0,
      diffPixels: 0,
      baselineSize: { width: 320, height: 240 },
      actualSize: { width: 320, height: 240 },
      baseline: { kind: "figma", path: baselinePath, fileKey: "abc123", nodeId: "1:2" },
      target: { url: "https://example.test" },
      selector: null,
      stability: "stable",
      evidenceHashes: {
        baseline: `sha256:${"a".repeat(64)}`,
        actual: `sha256:${"a".repeat(64)}`,
        diff: `sha256:${"c".repeat(64)}`,
      },
      artifacts: { baseline: baselinePath, actual: actualPath, diff: diffPath },
      captureEvidence: {
        finalUrl: "https://example.test",
        startedAt: "2026-08-08T00:00:00.000Z",
        capturedAt: "2026-08-08T00:00:01.000Z",
        finishedAt: "2026-08-08T00:00:02.000Z",
        viewport: { width: 320, height: 240 },
        readiness: { selector: "body", matchCount: 1, status: "passed" },
        fonts: { supported: true, status: "loaded", failed: [] },
        scope: { kind: "page", fullPage: true },
        screenshotHashes: [`sha256:${"d".repeat(64)}`],
        warnings: [],
        actions: [],
        maskEvidence: null,
        elementRect: null,
      },
    }),
  );

  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot,
    request: {
      schemaVersion: SCHEMA_VERSION,
      target: { kind: "web", url: "https://example.test" },
      contracts: [
        {
          id: featureId,
          baseline: { kind: "figma", fileKey: "abc123", nodeId: "1:2" },
          viewport: { name: "desktop", width: 320, height: 240 },
          outDir: `.framelia/visual-verifications/${featureId}`,
          scope: { kind: "page", pageReason: "cli.spec.ts fixture" },
        },
      ],
    },
    ok: true,
    allPassed: true,
    results: [{ id: featureId, ok: true, pass: true, outDir }],
  };
  const artifactPath = path.join(outDir, "visual-verification.json");
  await fsp.writeFile(artifactPath, JSON.stringify(artifact));
  return { artifactPath, outDir };
}

/** Reads the dashboard server's own "Dashboard: http://…" stderr line (see
 *  packages/cli/src/commands/dashboard.ts's serveDashboard) to learn its ephemeral port. */
function waitForDashboardUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for dashboard URL")), 15_000);
    let buffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = /Dashboard: (http:\/\/\S+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test.describe("framelia CLI: long-running dashboard servers", () => {
  test("open serves an existing verification artifact until stopped", async () => {
    const projectRoot = tempProjectRoot("framelia-cli-open-");
    const { artifactPath } = await writeVerificationArtifactFixture(projectRoot, "home");

    const child = spawn(process.execPath, [
      FRAMELIA_BIN,
      "open",
      "--artifact",
      artifactPath,
      "--no-open",
    ]);
    try {
      const url = await waitForDashboardUrl(child);
      const response = await fetch(url);
      expect(response.status).toBe(200);
    } finally {
      child.kill("SIGTERM");
    }
  });

  test("dashboard aggregates every artifact under the project root", async () => {
    const projectRoot = tempProjectRoot("framelia-cli-dashboard-");
    await writeVerificationArtifactFixture(projectRoot, "home");

    const child = spawn(process.execPath, [
      FRAMELIA_BIN,
      "dashboard",
      "--project-root",
      projectRoot,
      "--no-open",
    ]);
    try {
      const url = await waitForDashboardUrl(child);
      const response = await fetch(`${url}/api/run`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ summary: { total: 1 } });
    } finally {
      child.kill("SIGTERM");
    }
  });
});

test.describe("framelia CLI: needs FIGMA_ACCESS_TOKEN", () => {
  test("capture (fetch-gold) fetches a Figma node render", () => {
    test.skip(!hasFigmaConfig, "Blocked: set FIGMA_ACCESS_TOKEN to exercise `framelia capture`.");
    const projectRoot = tempProjectRoot("framelia-cli-capture-");
    const out = path.join(projectRoot, "figma-gold.png");

    const { status } = runCli([
      "capture",
      "--file-key",
      FIGMA_FILE_KEY,
      "--node-id",
      FIGMA_NODE_ID,
      "--out",
      out,
    ]);
    expect(status).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
  });
});

/**
 * Hand-rolled, dependency-free PNG encoder for the `compare`/`diff` test below: the
 * real decoder (`pngjs`, see packages/verify/src/compare/png.ts) isn't a declared
 * dependency of this app, and pnpm's strict linking would reject a phantom import of
 * it. Encodes an 8-bit RGBA image with no filtering/interlacing -- the smallest
 * spec-compliant PNG pngjs can read back.
 */
function makeSolidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = rowStart + 1 + x * 4;
      raw[o] = rgba[0];
      raw[o + 1] = rgba[1];
      raw[o + 2] = rgba[2];
      raw[o + 3] = rgba[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.describe("framelia CLI: compare two PNGs (offline)", () => {
  test("compare (diff) passes for identical images and fails for different ones", () => {
    const projectRoot = tempProjectRoot("framelia-cli-compare-");
    const baseline = path.join(projectRoot, "baseline.png");
    const actualSame = path.join(projectRoot, "actual-same.png");
    const actualDifferent = path.join(projectRoot, "actual-different.png");
    fs.writeFileSync(baseline, makeSolidPng(8, 8, [255, 0, 0, 255]));
    fs.writeFileSync(actualSame, makeSolidPng(8, 8, [255, 0, 0, 255]));
    fs.writeFileSync(actualDifferent, makeSolidPng(8, 8, [0, 0, 255, 255]));

    const same = runCli([
      "compare",
      "--baseline",
      baseline,
      "--actual",
      actualSame,
      "--out-dir",
      path.join(projectRoot, "same"),
    ]);
    expect(same.status).toBe(0);
    expect(JSON.parse(same.stdout)).toMatchObject({ pass: true });

    const different = runCli([
      "compare",
      "--baseline",
      baseline,
      "--actual",
      actualDifferent,
      "--out-dir",
      path.join(projectRoot, "different"),
    ]);
    expect(different.status).not.toBe(0);
    expect(JSON.parse(different.stdout)).toMatchObject({ pass: false });
  });
});
