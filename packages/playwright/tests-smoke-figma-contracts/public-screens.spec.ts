// Real-runner feasibility proof for #76 acceptance criterion 5 (part 1): one
// `defineFigmaTests` call, sharing a single source line, registers two contracts
// (desktop + mobile) that fan out across every configured project (see
// playwright.define-figma-tests.config.ts's "desktop"/"mobile" projects, "mobile"
// depending on "desktop") and repeat (`repeatEach: 2`). Also covers acceptance
// criterion 1: real public-screen desktop/mobile cases where the contract alone
// supplies viewport/screenshot units, and the pinned comparison runs with zero Figma
// credentials or network reachable (no FIGMA_ACCESS_TOKEN, no fetch stub, anywhere in
// this file).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { canonicalJsonDigest } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/testing";
import { test } from "@playwright/test";
import { PNG } from "pngjs";

import { defineFigmaTests, expect } from "../src/index.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-public-screens-smoke-"));

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function pinPageContract(options: {
  id: string;
  name: string;
  viewport: { preset: string; width: number; height: number };
  color: [number, number, number, number];
}): string {
  const imageBytes = PNG.sync.write(
    makeSolidPng(options.viewport.width, options.viewport.height, options.color),
  );
  const imageDigest = `sha256:${sha256(imageBytes)}`;
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
        path: `${options.id}.png`,
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
  fs.writeFileSync(path.join(root, `${options.id}.png`), imageBytes);

  const contract = {
    formatVersion: 1,
    kind: "framelia.contract",
    id: options.id,
    name: options.name,
    revision: 1,
    target: { path: "/login" },
    viewport: options.viewport,
    scope: { kind: "page", pageReason: "full page review" },
    baseline: { snapshotDigest },
  };
  const contractPath = path.join(root, `${options.id}.json`);
  fs.writeFileSync(contractPath, JSON.stringify(contract));
  return contractPath;
}

const COLOR: [number, number, number, number] = [100, 150, 200, 255];
const desktopContract = pinPageContract({
  id: "public-login.desktop",
  name: "Public login · Desktop",
  viewport: { preset: "desktop", width: 120, height: 90 },
  color: COLOR,
});
const mobileContract = pinPageContract({
  id: "public-login.mobile",
  name: "Public login · Mobile",
  viewport: { preset: "mobile", width: 80, height: 140 },
  color: COLOR,
});

let appUrl: string;
let closeApp: () => Promise<void>;

test.beforeAll(async () => {
  const html = `<style>html,body{margin:0}body{width:100vw;height:100vh;background:rgb(${COLOR.slice(0, 3).join(",")})}</style>`;
  const app = http.createServer((_request, response) => response.end(html));
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  appUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () =>
    new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
});

test.afterAll(async () => {
  await closeApp();
  fs.rmSync(root, { recursive: true, force: true });
});

// One call, two contracts, one shared source line -- see this file's header comment.
defineFigmaTests(test, {
  contracts: [desktopContract, mobileContract],
  async prepare({ page }, { target }) {
    await page.goto(`${appUrl}${target.path}`);
    await expect(page.locator("body")).toBeVisible();
  },
});
