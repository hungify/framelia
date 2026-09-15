// Real-runner feasibility proof for framelia/#77 (WP4): one FrameliaReporter, driving a
// real `playwright test` invocation over two `defineFigmaTests`-registered contracts --
// an immediately passing case and an always-failing case -- must produce a real,
// schema-valid run bundle on disk that a fresh `readRunBundle()` call (see this repo's
// own verification step for this PR) can read back with no error. `retries: 1`
// (playwright.run-bundle.config.ts) makes the failing case retry once, producing two
// distinct, independently published attempts for that one case -- deliberately both
// failing (not "fails then passes"), so this proof stays fully deterministic: a live
// server timed to flip outcome between a first attempt and its retry would depend on
// Playwright's own (unspecified, capture-pipeline-internal) request count per attempt,
// which this suite has no business depending on.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import { canonicalJsonDigest } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/testing";
import { test } from "@playwright/test";
import { PNG } from "pngjs";

import { projectRoot } from "../playwright.run-bundle.config.ts";
import { defineFigmaTests, expect } from "../src/index.ts";

// Contracts (and the spec file itself, via Playwright's own `testDir`) live under the
// reporter's own `projectRoot` (this package's own directory -- see the config's own doc
// comment): `defineFigmaTests`'s project-root discovery walks up from each contract
// file's directory looking for the nearest `framelia.config.*`, and the Reporter's
// run-bundle freezing resolves both `binding.contractFile` and each case's `specFile`
// against that same `projectRoot` -- pinning contracts (or this spec file) outside it
// would make those project-relative paths unresolvable.
const root = projectRoot;

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function pinPageContract(options: {
  id: string;
  name: string;
  path: string;
  viewport: { preset: string; width: number; height: number };
  color: [number, number, number, number];
}): string {
  const imageBytes = PNG.sync.write(
    makeSolidPng(options.viewport.width, options.viewport.height, options.color),
  );
  const imageDigest = `sha256:${sha256(imageBytes)}`;
  // Contract JSON + its baseline image live under `.framelia/` (already repo-wide
  // gitignored) rather than directly at the package root -- `projectRoot` is this
  // package's own directory (see the config's own doc comment), so anything pinned
  // straight at its top level would otherwise sit next to real package files.
  const contractsDir = path.join(root, ".framelia", "smoke-contracts");
  fs.mkdirSync(contractsDir, { recursive: true });
  const imageRelativePath = `.framelia/smoke-contracts/${options.id}.png`;
  const snapshot = {
    formatVersion: 1,
    kind: "framelia.baseline-snapshot",
    source: { kind: "figma", fileKey: "smoke-file-key", nodeId: "1:2" },
    rendering: {
      viewport: {
        preset: options.viewport.preset,
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor: 1,
    },
    expected: {
      kind: "page",
      image: {
        path: imageRelativePath,
        digest: imageDigest,
        width: options.viewport.width,
        height: options.viewport.height,
      },
    },
  };
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const snapshotDir = path.join(root, ".framelia", "baselines", snapshotDigest.slice(7));
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root, imageRelativePath), imageBytes);

  const contract = {
    formatVersion: 1,
    kind: "framelia.contract",
    id: options.id,
    name: options.name,
    revision: 1,
    target: { path: options.path },
    viewport: options.viewport,
    scope: { kind: "page", pageReason: "run-bundle smoke review" },
    baseline: { snapshotDigest },
  };
  const contractPath = path.join(contractsDir, `${options.id}.json`);
  fs.writeFileSync(contractPath, JSON.stringify(contract));
  return contractPath;
}

const VIEWPORT = { preset: "desktop", width: 100, height: 80 } as const;
const PASS_COLOR: [number, number, number, number] = [10, 20, 30, 255];
const FAIL_COLOR: [number, number, number, number] = [200, 10, 10, 255];

const passingContract = pinPageContract({
  id: "smoke.passing",
  name: "Run-bundle smoke · passing",
  path: "/smoke-passing",
  viewport: VIEWPORT,
  color: PASS_COLOR,
});
const failingContract = pinPageContract({
  id: "smoke.failing",
  name: "Run-bundle smoke · failing",
  path: "/smoke-failing",
  viewport: VIEWPORT,
  color: PASS_COLOR,
});

function htmlFor(color: [number, number, number, number]): string {
  return `<style>html,body{margin:0}body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:rgb(${color.slice(0, 3).join(",")})}</style>`;
}

let appUrl: string;
let closeApp: () => Promise<void>;

test.beforeAll(async () => {
  const app = http.createServer((request, response) => {
    const url = request.url ?? "/";
    response.end(htmlFor(url.startsWith("/smoke-failing") ? FAIL_COLOR : PASS_COLOR));
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  appUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () =>
    new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
});

test.afterAll(async () => {
  await closeApp();
  // `root` is the reporter's own `projectRoot`, cleared fresh by the config at the start
  // of each CLI invocation -- never removed here, since the run bundle this test proves
  // out lives under it and must survive past the test run for post-run inspection.
});

defineFigmaTests(test, {
  contracts: [passingContract, failingContract],
  specUrl: new URL(import.meta.url),
  async prepare({ page }, { target }) {
    await page.goto(`${appUrl}${target.path}`);
    await expect(page.locator("body")).toBeVisible();
  },
});
