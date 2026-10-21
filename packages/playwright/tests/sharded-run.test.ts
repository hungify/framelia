import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonDigest } from "@framelia/verify";
import { listRuns, readRunBundle } from "@framelia/verify/run-bundle";
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
const CONTRACT_IDS = ["shard.alpha", "shard.beta"] as const;

/**
 * A real `playwright test` project with one pinned contract per spec file, so Playwright's
 * `--shard=1/2` and `--shard=2/2` each run exactly one of them. Like preserve-output.test.ts,
 * it lives under this package's gitignored `.framelia/` and runs from TypeScript sources via
 * the `framelia-dev` export condition, so no build is needed.
 */
function writeShardedProject(): string {
  fs.mkdirSync(path.join(packageDir, ".framelia"), { recursive: true });
  const root = fs.mkdtempSync(path.join(packageDir, ".framelia", "sharded-run-"));
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

  const background = `rgb(${COLOR.slice(0, 3).join(",")})`;
  for (const id of CONTRACT_IDS) {
    fs.writeFileSync(
      path.join(root, `${id}.json`),
      JSON.stringify({
        formatVersion: 1,
        kind: "framelia.contract",
        id,
        name: id,
        revision: 1,
        target: { path: "/" },
        viewport: VIEWPORT,
        scope: { kind: "page", pageReason: "sharded run regression" },
        baseline: { snapshotDigest },
      }),
    );
    fs.writeFileSync(
      path.join(root, `${id}.spec.ts`),
      `import { test } from "@playwright/test";
import { defineFigmaTests } from "../../src/index.ts";

defineFigmaTests(test, {
  contracts: new URL("./${id}.json", import.meta.url),
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
  }

  const clientRoot = path.join(root, "client");
  fs.mkdirSync(clientRoot);
  fs.writeFileSync(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
  fs.writeFileSync(
    path.join(root, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: ${JSON.stringify(path.join(root, "test-results"))},
  reporter: [[${JSON.stringify(path.join(packageDir, "src", "reporter.ts"))}, ${JSON.stringify({
    projectRoot: root,
    clientRoot,
    port: 0,
  })}]],
  projects: [{ name: "desktop" }],
});
`,
  );
  return root;
}

function runShard(
  root: string,
  shard: string,
  runId: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      playwrightBin,
      ["test", "--config", path.join(root, "playwright.config.ts"), `--shard=${shard}`],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=framelia-dev",
          CI: "1",
          FRAMELIA_RUN_ID: runId,
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, output: `${stdout}\n${stderr}` });
      },
    );
  });
}

describe("FrameliaReporter under real sharded Playwright runs", () => {
  it("records concurrently finishing shards into one run bundle finalized once", async () => {
    const root = writeShardedProject();
    const runId = "sharded-ci-run";

    const shards = await Promise.all([runShard(root, "1/2", runId), runShard(root, "2/2", runId)]);

    for (const shard of shards) expect(shard).toMatchObject({ code: 0 });
    const output = shards.map((shard) => shard.output).join("\n");
    expect(output.match(/finalized the run \(finalized\)/gu)).toHaveLength(1);

    const { runs, invalid } = listRuns(root);
    expect(invalid).toEqual([]);
    expect(runs.map((run) => run.runId)).toEqual([runId]);
    const bundle = readRunBundle(root, runId);
    expect(bundle.record).toMatchObject({ status: "finalized", diagnostics: [] });
    expect(bundle.plan.selectedCases.map((entry) => entry.caseId)).toEqual([
      "shard.alpha@desktop#0",
      "shard.beta@desktop#0",
    ]);
    expect(bundle.record.cases.map((entry) => entry.selectedAttemptId)).toEqual([
      "shard.alpha@desktop#0::attempt-0",
      "shard.beta@desktop#0::attempt-0",
    ]);
  }, 180_000);
});
