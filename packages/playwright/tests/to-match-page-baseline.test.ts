import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { promotePageBaseline } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/internal";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { runToMatchPageBaseline } from "../src/matchers/to-match-page-baseline.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

const SIZE = { width: 100, height: 80 };

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
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

function pageFixture(rgb: [number, number, number]): { html: string; png: Buffer } {
  const png = PNG.sync.write(makeSolidPng(SIZE.width, SIZE.height, [...rgb, 255]));
  return {
    html: `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(${rgb.join(",")})}</style>`,
    png,
  };
}

function seedBaseline(
  baselineDir: string,
  png: Buffer,
  promotedBy = "alice@example.com",
  runId?: string,
) {
  const sourceDir = tempDir("framelia-page-baseline-source-");
  const sourcePath = path.join(sourceDir, "capture.png");
  fs.writeFileSync(sourcePath, png);
  return promotePageBaseline({ sourcePath, outDir: baselineDir, promotedBy, runId });
}

interface Harness {
  attachCalls: Array<{ name: string; path: string }>;
  attachJsonCalls: Array<{ name: string; data: unknown }>;
  workDir: string;
  run: (
    received: Awaited<ReturnType<typeof browser.newPage>>,
    key: string,
    baselineDir: string,
  ) => ReturnType<typeof runToMatchPageBaseline>;
}

function harness(): Harness {
  const workDir = tempDir("framelia-to-match-page-baseline-");
  const attachCalls: Array<{ name: string; path: string }> = [];
  const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
  return {
    attachCalls,
    attachJsonCalls,
    workDir,
    run: (received, key, baselineDir) =>
      runToMatchPageBaseline(
        received,
        key,
        { baselineDir },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async (name, filePath) => {
            attachCalls.push({ name, path: filePath });
          },
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      ),
  };
}

describe("runToMatchPageBaseline", () => {
  it("fails clearly when no baseline has been promoted yet", async () => {
    const baselineDir = tempDir("framelia-page-baseline-dir-");
    const { html } = pageFixture([100, 150, 200]);
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const h = harness();
      const result = await h.run(page, "home.desktop", baselineDir);

      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/framelia baseline promote/);
      expect(h.attachCalls).toHaveLength(0);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("passes and reports who/when/from-what-run promoted the baseline it matched", async () => {
    const baselineDir = tempDir("framelia-page-baseline-dir-");
    const { html, png } = pageFixture([100, 150, 200]);
    const promoted = seedBaseline(baselineDir, png, "alice@example.com", "ci-run-42");
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const h = harness();
      const result = await h.run(page, "home.desktop", baselineDir);

      expect(result.pass).toBe(true);
      expect(h.attachCalls).toHaveLength(3);
      expect(h.attachJsonCalls).toHaveLength(1);
      expect(h.attachJsonCalls[0]?.data).toMatchObject({
        pass: true,
        baselineKind: "web",
        baselineVersion: 1,
        baselinePromotedBy: "alice@example.com",
        baselinePromotedAt: promoted.meta.current.promotedAt,
        baselineRunId: "ci-run-42",
      });
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("fails a non-promoted mismatch against the current baseline", async () => {
    const baselineDir = tempDir("framelia-page-baseline-dir-");
    const { png: baselinePng } = pageFixture([100, 150, 200]);
    seedBaseline(baselineDir, baselinePng);
    const { html: differentHtml } = pageFixture([10, 20, 30]);
    const app = await server(differentHtml);
    const context = await browser.newContext({ viewport: SIZE });
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const h = harness();
      const result = await h.run(page, "home.desktop", baselineDir);

      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/did not match promoted baseline v1/);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("uses whatever was most recently promoted for subsequent comparisons (accept/promote workflow)", async () => {
    const baselineDir = tempDir("framelia-page-baseline-dir-");
    const { png: originalPng } = pageFixture([100, 150, 200]);
    const { html: redesignedHtml, png: redesignedPng } = pageFixture([10, 20, 30]);
    seedBaseline(baselineDir, originalPng);

    const app = await server(redesignedHtml);
    const context = await browser.newContext({ viewport: SIZE });
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      // Against the original baseline, the redesigned page is a mismatch.
      const before = harness();
      expect((await before.run(page, "home.desktop", baselineDir)).pass).toBe(false);

      // Promote the redesign as the new baseline (v2) -- the accept step.
      seedBaseline(baselineDir, redesignedPng, "bob@example.com");

      // The same redesigned page now matches the newly promoted baseline.
      const after = harness();
      const result = await after.run(page, "home.desktop", baselineDir);
      expect(result.pass).toBe(true);
      expect(after.attachJsonCalls[0]?.data).toMatchObject({
        baselineVersion: 2,
        baselinePromotedBy: "bob@example.com",
      });
    } finally {
      await context.close();
      await app.close();
    }
  });
});
