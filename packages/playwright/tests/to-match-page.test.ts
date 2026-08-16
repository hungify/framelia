import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import { runToMatchPage } from "../src/matchers/to-match-page.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

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

const SIZE = { width: 100, height: 80 };

describe("runToMatchPage", () => {
  it("passes and attaches nothing when two independently navigated pages match", async () => {
    const html = `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(50,80,110)}</style>`;
    const appA = await server(html);
    const appB = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-page-"));
    const attachCalls: Array<{ name: string; path: string }> = [];
    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();
      await pageA.goto(appA.url);
      await pageB.goto(appB.url);

      const result = await runToMatchPage(
        pageA,
        pageB,
        "page",
        {},
        {
          timeoutMs: 5_000,
          workDir,
          attach: async (name, filePath) => {
            attachCalls.push({ name, path: filePath });
          },
          attachJson: async () => undefined,
        },
      );

      expect(result.pass).toBe(true);
      expect(attachCalls).toHaveLength(3);
    } finally {
      await context.close();
      await appA.close();
      await appB.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails and attaches expected/actual/diff when the pages diverge", async () => {
    const appA = await server(
      `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:black}</style>`,
    );
    const appB = await server(
      `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:white}</style>`,
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-page-"));
    const attachCalls: Array<{ name: string; path: string }> = [];
    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();
      await pageA.goto(appA.url);
      await pageB.goto(appB.url);

      const result = await runToMatchPage(
        pageA,
        pageB,
        "page",
        {},
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
      await appA.close();
      await appB.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
