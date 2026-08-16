import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import { captureReadyPage } from "../src/capture/core.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

async function server(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = http.createServer((_request, response) =>
    response.end(`
    <style>body { margin: 0; } #region { width: 200px; height: 100px; position: relative; }
    #secret { width: 40px; height: 40px; background: red; }</style>
    <div id="region">
      <p>navigation-free capture</p>
      <div id="secret"></div>
    </div>
  `),
  );
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("captureReadyPage", () => {
  it("screenshots a full-page scope without navigating", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      expect(outcome.capturePaths).toEqual([path.join(tmpDir, "capture.png")]);
      expect(outcome.finalUrl).toBe(`${app.url}/`);
      expect(fs.existsSync(outcome.capturePaths[0]!)).toBe(true);
      expect(outcome.fonts.supported).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("screenshots a region scope with a mask applied", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "region", selector: "#region" },
        screenshot: { masks: [{ selector: "#secret", reason: "sensitive" }] },
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      expect(outcome.maskEvidence?.status).toBe("applied");
      expect(outcome.maskEvidence?.matchedCount).toBe(1);
      expect(outcome.elementRect).not.toBeNull();
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects with CAPTURE_PAGE_CLOSED when the passed Page is already closed", async () => {
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.close();

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected rejection");
      expect(outcome.error).toBe("CAPTURE_PAGE_CLOSED");
    } finally {
      await context.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
