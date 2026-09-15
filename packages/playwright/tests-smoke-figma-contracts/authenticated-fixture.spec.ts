// Real-runner feasibility proof for #76 acceptance criteria 2 and 3: a caller's own
// `test.extend()`'d `page` fixture override (not the plain, unmodified `page`) does an
// app-specific "login" step before `defineFigmaTests`'s own test body ever runs --
// Playwright's own documented pattern for exactly this scenario (see
// DefineFigmaTestsOptions's doc comment for why overriding `page` itself, rather than
// introducing a brand-new fixture name, is what's supported: Playwright's own test-file
// transform statically requires every fixture a registered test uses to be named
// literally in that test's own destructuring pattern, which a generic library function
// cannot do for fixture names it never sees at its own authoring time). By the time
// `defineFigmaTests`'s `prepare` receives `page`, the fixture's own login step has
// already run -- and `prepare` still only captures after its own readiness wait, proving
// the dashboard content (not the login form) is what gets compared.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { canonicalJsonDigest } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/testing";
import { test as base } from "@playwright/test";
import { PNG } from "pngjs";

import { projectRoot } from "../playwright.define-figma-tests.config.ts";
import { defineFigmaTests, expect } from "../src/index.ts";

// `root` is this package's own `projectRoot` (not a per-invocation temp dir) -- the
// same convention `tests-smoke-run-bundle/run-bundle.spec.ts` uses and documents:
// `defineFigmaTests`'s own project-root discovery (walking up from the contract
// file's directory) finds the real `framelia.config.mjs` this config writes at
// `projectRoot`'s own top level, so this registered test's `specFile` (framelia/#77's
// registration-time spec-digest fix) only resolves to a project-relative path (no
// `..` segments) when the contract/baseline live under this same root too.
const root = projectRoot;

const VIEWPORT = { preset: "desktop", width: 100, height: 80 } as const;
const DASHBOARD_COLOR: [number, number, number, number] = [20, 80, 40, 255];

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

const imageBytes = PNG.sync.write(makeSolidPng(VIEWPORT.width, VIEWPORT.height, DASHBOARD_COLOR));
const imageDigest = `sha256:${sha256(imageBytes)}`;

// Contract JSON + its baseline image live under `.framelia/` (already repo-wide
// gitignored) rather than directly at the package root -- see `run-bundle.spec.ts`'s
// own `pinPageContract` for the same convention, applied there first.
const contractsDir = path.join(root, ".framelia", "smoke-contracts");
fs.mkdirSync(contractsDir, { recursive: true });
const imageRelativePath = ".framelia/smoke-contracts/dashboard.png";
const snapshot = {
  formatVersion: 1,
  kind: "framelia.baseline-snapshot",
  source: { kind: "figma", fileKey: "smoke-file-key", nodeId: "3:4" },
  rendering: { viewport: VIEWPORT, deviceScaleFactor: 1 },
  expected: {
    kind: "page",
    image: {
      path: imageRelativePath,
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
fs.writeFileSync(path.join(root, imageRelativePath), imageBytes);

const contract = {
  formatVersion: 1,
  kind: "framelia.contract",
  id: "dashboard.desktop",
  name: "Dashboard · Desktop (authenticated)",
  revision: 1,
  target: { path: "/dashboard" },
  viewport: VIEWPORT,
  scope: { kind: "page", pageReason: "authenticated dashboard review" },
  baseline: { snapshotDigest },
};
const contractPath = path.join(contractsDir, "dashboard.json");
fs.writeFileSync(contractPath, JSON.stringify(contract));

// `root` is this package's own `projectRoot`, not a per-invocation temp dir -- never
// removed here (see `run-bundle.spec.ts`'s own `afterAll` for the same convention):
// the contract/baseline are deterministic, idempotent content, so a fresh invocation
// writing them again is harmless.

const LOGIN_HTML = `<style>html,body{margin:0}body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:white}</style><form id="login"><button id="submit">Sign in</button></form>`;
const DASHBOARD_HTML = `<style>html,body{margin:0}body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:rgb(${DASHBOARD_COLOR.slice(0, 3).join(",")})}</style><div data-testid="dashboard-ready" style="width:10px;height:10px"></div>`;

let loginRanBeforePrepare = false;

/** Overrides the built-in `page` fixture itself (Playwright's own documented pattern for
 *  app-level setup, since a brand-new fixture name can't reach `defineFigmaTests`'s
 *  `prepare` -- see this file's header comment): every test through `authedTest` already
 *  has a signed-in page by the time its body starts. */
const authedTest = base.extend({
  page: async ({ page }, use) => {
    await page.setContent(LOGIN_HTML);
    await page.click("#submit");
    loginRanBeforePrepare = true;
    await use(page);
  },
});

defineFigmaTests(authedTest, {
  contracts: contractPath,
  specUrl: new URL(import.meta.url),
  async prepare({ page }, { target }) {
    expect(loginRanBeforePrepare).toBe(true);
    expect(target.path).toBe("/dashboard");
    // Only now does the "authenticated" dashboard content -- and its pinned image --
    // become the capture target; readiness is awaited explicitly before returning.
    await page.setContent(DASHBOARD_HTML);
    await expect(page.getByTestId("dashboard-ready")).toBeVisible();
  },
});
