import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { makeSolidPng } from "@framelia/verify/internal";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { runToMatchFigma } from "../src/matchers/to-match-figma.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
});

const NODE_ID = "1:2";
const SIZE = { width: 100, height: 80 };

/** Stubs global fetch to serve the Figma metadata/image-render/CDN-download sequence fetchGold makes. */
function stubFigmaFetch(png: Buffer, options: { imageDelayMs?: number } = {}): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/files/")) {
      return new Response(
        JSON.stringify({ lastModified: "2026-08-01T00:00:00Z", nodes: { [NODE_ID]: {} } }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/images/")) {
      return new Response(
        JSON.stringify({ images: { [NODE_ID]: "https://cdn.example/baseline.png" } }),
        {
          status: 200,
        },
      );
    }
    if (options.imageDelayMs)
      await new Promise((resolve) => setTimeout(resolve, options.imageDelayMs));
    return new Response(Uint8Array.from(png).buffer, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;
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

function solidPagePng(): { html: string; png: Buffer } {
  const png = PNG.sync.write(makeSolidPng(SIZE.width, SIZE.height, [100, 150, 200, 255]));
  return {
    html: `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(100,150,200)}</style>`,
    png,
  };
}

describe("runToMatchFigma", () => {
  it("passes and attaches nothing when the actual matches the Figma baseline", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachCalls: Array<{ name: string; path: string }> = [];
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key" },
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
      );

      expect(result.pass).toBe(true);
      expect(attachCalls).toHaveLength(3);
      // Durable evidence attaches on pass so Reporter can persist R13 artifacts.
      expect(attachJsonCalls).toHaveLength(1);
      expect(attachJsonCalls[0]?.name).toContain("-framelia-score");
      expect(attachJsonCalls[0]?.data).toMatchObject({ pass: true, baselineKind: "figma" });
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails and attaches expected/actual/diff when the actual diverges", async () => {
    const png = PNG.sync.write(makeSolidPng(SIZE.width, SIZE.height, [0, 0, 0, 255]));
    stubFigmaFetch(png);
    const app = await server(
      `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:white}</style>`,
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachCalls: Array<{ name: string; path: string }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async (name, filePath) => {
            attachCalls.push({ name, path: filePath });
          },
          attachJson: async () => undefined,
        },
      );

      expect(result.pass).toBe(false);
      expect(attachCalls.map((call) => call.name)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("-expected"),
          expect.stringContaining("-actual"),
          expect.stringContaining("-diff"),
        ]),
      );
      expect(attachCalls).toHaveLength(3);
      for (const call of attachCalls) expect(fs.existsSync(call.path)).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("diffs only the region's bounding box when selector is set", async () => {
    const png = PNG.sync.write(makeSolidPng(40, 30, [10, 20, 30, 255]));
    stubFigmaFetch(png);
    const app = await server(`
      <style>
        html,body{margin:0}
        #outside{width:400px;height:400px;background:red}
        #region{width:40px;height:30px;background:rgb(10,20,30);position:absolute;top:0;left:0}
      </style>
      <div id="outside"></div>
      <div id="region"></div>
    `);
    const context = await browser.newContext({ viewport: { width: 400, height: 400 } });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "#region" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(result.pass).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear timeout message instead of hanging when the baseline fetch is slow", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png, { imageDelayMs: 2_000 });
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const startedAt = Date.now();
      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key" },
        {
          timeoutMs: 100,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/timed out/i);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear message when no Figma file key is available", async () => {
    const context = await browser.newContext();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      const result = await runToMatchFigma(
        page,
        NODE_ID,
        {},
        {
          timeoutMs: 1_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toContain("no Figma file key");
    } finally {
      await context.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails cleanly with a baseline-fetch-failed message when the Figma API rejects the request", async () => {
    const { html } = solidPagePng();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/files/")) {
        return new Response("Invalid token", { status: 403 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(result.pass).toBe(false);
      expect(result.message()).toContain("Figma baseline fetch failed");
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
