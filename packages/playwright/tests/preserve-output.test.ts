import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonDigest } from "@framelia/verify";
import { readRunBundle } from "@framelia/verify/run-bundle";
import { makeSolidPng } from "@framelia/verify/testing";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const playwrightBin = path.join(packageDir, "node_modules", ".bin", "playwright");

const fixtureRoots: string[] = [];
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const VIEWPORT = { preset: "desktop", width: 100, height: 80 } as const;
const COLOR: [number, number, number, number] = [10, 20, 30, 255];

/**
 * A real `playwright test` project: the fixture lives under this package's own (gitignored)
 * `.framelia/` so its spec can import this package's TypeScript sources relatively, and the
 * child runs with the same `framelia-dev` export condition Vitest uses, so no build is needed.
 */
function writeFixtureProject(runId: string): string {
  fs.mkdirSync(path.join(packageDir, ".framelia"), { recursive: true });
  const root = fs.mkdtempSync(path.join(packageDir, ".framelia", "preserve-output-"));
  fixtureRoots.push(root);
  fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");

  const imageBytes = PNG.sync.write(makeSolidPng(VIEWPORT.width, VIEWPORT.height, COLOR));
  const imageDigest = `sha256:${crypto.createHash("sha256").update(imageBytes).digest("hex")}`;
  const snapshot = {
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "file-key", nodeId: "1:2" },
    rendering: { viewport: VIEWPORT, deviceScaleFactor: 1 },
    expected: {
      kind: "page",
      image: {
        path: "baseline.png",
        digest: imageDigest,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
      },
    },
  };
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root, "baseline.png"), imageBytes);
  fs.writeFileSync(
    path.join(root, "contract.json"),
    JSON.stringify({
      formatVersion: 1,
      kind: "framelia.contract",
      id: "preserve.output",
      name: "Preserve output",
      revision: 1,
      target: { path: "/" },
      viewport: VIEWPORT,
      scope: { kind: "page", pageReason: "preserveOutput regression" },
      baseline: { snapshotDigest },
    }),
  );

  const clientRoot = path.join(root, "client");
  fs.mkdirSync(clientRoot);
  fs.writeFileSync(path.join(clientRoot, "index.html"), "<main>Framelia</main>");

  const background = `rgb(${COLOR.slice(0, 3).join(",")})`;
  fs.writeFileSync(
    path.join(root, "visual.spec.ts"),
    `import { test } from "@playwright/test";
import { defineFigmaTests } from "../../src/index.ts";

defineFigmaTests(test, {
  contracts: new URL("./contract.json", import.meta.url),
  specUrl: new URL(import.meta.url),
  async prepare({ page }) {
    await page.route("http://framelia.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<style>html,body{margin:0}body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:${background}}</style>",
      }),
    );
    await page.goto("http://framelia.test/");
  },
});
`,
  );
  fs.writeFileSync(
    path.join(root, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: ${JSON.stringify(path.join(root, "test-results"))},
  preserveOutput: "failures-only",
  reporter: [
    [${JSON.stringify(path.join(packageDir, "src", "reporter.ts"))}, ${JSON.stringify({
      projectRoot: root,
      clientRoot,
      port: 0,
      runId,
    })}],
    ["html", { outputFolder: ${JSON.stringify(path.join(root, "html-report"))}, open: "never" }],
  ],
  projects: [{ name: "desktop" }],
});
`,
  );
  return root;
}

function runPlaywright(root: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      playwrightBin,
      ["test", "--config", path.join(root, "playwright.config.ts")],
      {
        cwd: root,
        env: { ...process.env, NODE_OPTIONS: "--conditions=framelia-dev", CI: "1" },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, output: `${stdout}\n${stderr}` });
      },
    );
  });
}

describe("FrameliaReporter under a real Playwright runner", () => {
  it('keeps passing-test evidence when preserveOutput is "failures-only"', async () => {
    const runId = "preserve-output-run";
    const root = writeFixtureProject(runId);

    const { code, output } = await runPlaywright(root);
    expect({ code, output }).toMatchObject({ code: 0 });

    // Playwright removed the passing test's output directory (attachments included)...
    const leftovers = fs.existsSync(path.join(root, "test-results"))
      ? fs.readdirSync(path.join(root, "test-results"))
      : [];
    expect(leftovers.filter((entry) => entry !== ".last-run.json")).toEqual([]);

    // ...yet the run bundle still carries the attempt's image evidence.
    const bundle = readRunBundle(root, runId);
    expect(bundle.record).toMatchObject({ status: "finalized", diagnostics: [] });
    const [attempt] = [...bundle.attempts.values()];
    expect(attempt).toMatchObject({ executionState: "completed", visualVerdict: "passed" });
    expect(attempt?.evidence.expected).toBeDefined();
    expect(attempt?.evidence.actual).toBeDefined();

    // The HTML report still embeds the expected/actual images.
    const reportData = path.join(root, "html-report", "data");
    const images = fs.readdirSync(reportData).filter((entry) => entry.endsWith(".png"));
    expect(images.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
