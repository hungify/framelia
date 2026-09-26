import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it, vi } from "vitest";

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
        stabilitySamples: 3,
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      expect(outcome.capturePaths).toEqual([path.join(tmpDir, "capture.png")]);
      expect(outcome.finalUrl).toBe(`${app.url}/`);
      expect(fs.existsSync(outcome.capturePaths[0]!)).toBe(true);
      expect(outcome.screenshotHashes).toHaveLength(3);
      expect(new Set(outcome.screenshotHashes).size).toBe(1);
      expect(fs.readdirSync(tmpDir)).toEqual(["capture.png"]);
      expect(outcome.fonts.supported).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  it("defaults generic capture to one screenshot", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const screenshot = vi.spyOn(page, "screenshot");

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(outcome.screenshotHashes).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("hashes every stability sample and detects a changed third capture", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const screenshot = page.screenshot.bind(page);
      let captureCount = 0;
      vi.spyOn(page, "screenshot").mockImplementation(async (options) => {
        captureCount += 1;
        if (captureCount === 3) {
          await page.evaluate(() => {
            document.body.style.background = "rgb(255, 0, 0)";
          });
        }
        return screenshot(options);
      });

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        stabilitySamples: 3,
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      expect(outcome.screenshotHashes).toHaveLength(3);
      expect(new Set(outcome.screenshotHashes).size).toBe(2);
      expect(fs.readdirSync(tmpDir)).toEqual(["capture.png"]);
    } finally {
      vi.restoreAllMocks();
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("removes private stability samples when a later screenshot fails", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const screenshot = page.screenshot.bind(page);
      let captureCount = 0;
      vi.spyOn(page, "screenshot").mockImplementation(async (options) => {
        captureCount += 1;
        if (captureCount === 3) throw new Error("third sample failed");
        return screenshot(options);
      });

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        stabilitySamples: 3,
        timeoutMs: 2_000,
      });

      expect(outcome.ok).toBe(false);
      expect(fs.readdirSync(tmpDir)).toEqual(["capture.png"]);
    } finally {
      vi.restoreAllMocks();
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("removes every private sample when hashing one sample fails", async () => {
    const app = await server();
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const screenshot = page.screenshot.bind(page);
      let captureCount = 0;
      vi.spyOn(page, "screenshot").mockImplementation(async (options) => {
        captureCount += 1;
        const bytes = await screenshot(options);
        if (captureCount === 3) {
          fs.rmSync(path.join(tmpDir, ".capture.png.stability-1.png"));
        }
        return bytes;
      });

      await expect(
        captureReadyPage(page, {
          outPath: path.join(tmpDir, "capture.png"),
          scope: { kind: "page", fullPage: false },
          screenshot: {},
          stabilitySamples: 3,
          timeoutMs: 2_000,
        }),
      ).rejects.toThrow(/ENOENT|no such file/i);
      expect(fs.readdirSync(tmpDir)).toEqual(["capture.png"]);
    } finally {
      vi.restoreAllMocks();
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
        stabilitySamples: 2,
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

  it("rebases a region scope's mask bounds onto the captured crop's own origin, not the viewport", async () => {
    const app = await server();
    // Override the fixture body so #region sits away from the viewport
    // origin (unlike the fixture server's default markup, which happens to
    // place #region at (0,0) and would hide an unrebased-bounds bug).
    const context = await browser.newContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      await page.setContent(`
        <style>
          body { margin: 0; }
          #region { position: relative; margin: 70px 0 0 40px; width: 200px; height: 100px; }
          #secret { position: absolute; top: 20px; left: 30px; width: 40px; height: 40px; background: red; }
        </style>
        <div id="region"><div id="secret"></div></div>
      `);

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "region", selector: "#region" },
        screenshot: { masks: [{ selector: "#secret", reason: "sensitive" }] },
        stabilitySamples: 2,
        timeoutMs: 2_000,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      // #region itself sits at viewport (40, 70); #secret sits at (30, 20)
      // relative to #region. The captured PNG is cropped to #region's own
      // bounding box, so the mask bound must be reported relative to that
      // crop's origin ((30, 20)) -- not #secret's raw viewport position
      // ((70, 90)), which would misplace the mask entirely off a smaller canvas.
      expect(outcome.maskEvidence?.bounds).toEqual([{ x: 30, y: 20, width: 40, height: 40 }]);
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
        stabilitySamples: 2,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected rejection");
      expect(outcome.error).toBe("CAPTURE_PAGE_CLOSED");
    } finally {
      await context.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("captures at real device-pixel resolution when scale matches the context's own deviceScaleFactor", async () => {
    const app = await server();
    const context = await browser.newContext({
      viewport: { width: 100, height: 80 },
      deviceScaleFactor: 2,
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        stabilitySamples: 2,
        timeoutMs: 2_000,
        scale: 2,
      });

      if (!outcome.ok) throw new Error(`capture failed: ${outcome.error} ${outcome.message}`);
      const png = PNG.sync.read(fs.readFileSync(outcome.capturePaths[0]!));
      expect(png.width).toBe(200);
      expect(png.height).toBe(160);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects with CAPTURE_SCALE_MISMATCH instead of silently capturing at the wrong resolution", async () => {
    const app = await server();
    // deviceScaleFactor defaults to 1, but scale: 2 is requested below.
    const context = await browser.newContext({ viewport: { width: 100, height: 80 } });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-ready-capture-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const outcome = await captureReadyPage(page, {
        outPath: path.join(tmpDir, "capture.png"),
        scope: { kind: "page", fullPage: false },
        screenshot: {},
        stabilitySamples: 2,
        timeoutMs: 2_000,
        scale: 2,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected rejection");
      expect(outcome.error).toBe("CAPTURE_SCALE_MISMATCH");
      expect(fs.existsSync(path.join(tmpDir, "capture.png"))).toBe(false);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
