import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { makeSolidPng } from "@framelia/verify/internal";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
function stubFigmaFetch(
  png: Buffer,
  options: { imageDelayMs?: number; document?: unknown } = {},
): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/files/")) {
      return new Response(
        JSON.stringify({
          lastModified: "2026-08-01T00:00:00Z",
          nodes: {
            [NODE_ID]: options.document !== undefined ? { document: options.document } : {},
          },
        }),
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

  it("masks a page-scope element so its real captured bounds are excluded from the score", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    // #glitch diverges from the Figma baseline's uniform color -- without a
    // mask this would fail the page profile's 0.99 minMatch (a ~3.75% patch).
    const app = await server(
      html.replace(
        "</style>",
        '#glitch{position:absolute;top:10px;left:10px;width:20px;height:15px;background:red}</style><div id="glitch"></div>',
      ),
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const unmasked = await runToMatchFigma(
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
      expect(unmasked.pass).toBe(false);

      const masked = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", masks: [{ selector: "#glitch", reason: "dynamic content" }] },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );
      expect(masked.pass).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("masks a region-scope element whose bounds are rebased onto the crop's own origin", async () => {
    const png = PNG.sync.write(makeSolidPng(40, 30, [10, 20, 30, 255]));
    stubFigmaFetch(png);
    // #region sits away from the viewport origin so an unrebased mask bound
    // would land outside the small cropped comparison canvas entirely.
    const app = await server(`
      <style>
        html,body{margin:0}
        #region{position:relative;margin:70px 0 0 40px;width:40px;height:30px;background:rgb(10,20,30)}
        #secret{position:absolute;top:5px;left:5px;width:10px;height:10px;background:red}
      </style>
      <div id="region"><div id="secret"></div></div>
    `);
    const context = await browser.newContext({ viewport: { width: 400, height: 400 } });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const masked = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          selector: "#region",
          masks: [{ selector: "#secret", reason: "dynamic content" }],
        },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(masked.pass).toBe(true);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("adds a non-blocking style-color topIssue when the component's color diverges from Figma's fill, without affecting pass", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png, {
      document: {
        type: "FRAME",
        fills: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
      },
    });
    const app = await server(html.replace("<style>", "<style>body{color:rgb(255,0,0)}"));
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "body" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      expect(attachJsonCalls[0]?.data).toMatchObject({
        pass: true,
        topIssues: expect.arrayContaining([
          expect.objectContaining({ kind: "style-color", blocking: false }),
        ]),
      });
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("adds no style topIssues when the component's rendered style exactly matches Figma's node", async () => {
    const { html, png } = solidPagePng();
    // solidPagePng's body background is rgb(100,150,200) -- match the FRAME's
    // fill to it so this exercises a real backgroundColor match, not a false
    // one via the (now-fixed) text/background paint conflation. See PR #17.
    stubFigmaFetch(png, {
      document: {
        type: "FRAME",
        fills: [
          {
            type: "SOLID",
            visible: true,
            color: { r: 100 / 255, g: 150 / 255, b: 200 / 255 },
            opacity: 1,
          },
        ],
      },
    });
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "body" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (attachJsonCalls[0]?.data as { topIssues?: Array<{ kind: string }> })
        ?.topIssues;
      expect(topIssues?.some((issue) => issue.kind.startsWith("style-"))).toBe(false);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("reports a non-blocking style-check-error instead of silently skipping when region-scope style capture fails", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png, {
      document: {
        type: "FRAME",
        fills: [
          {
            type: "SOLID",
            visible: true,
            color: { r: 100 / 255, g: 150 / 255, b: 200 / 255 },
            opacity: 1,
          },
        ],
      },
    });
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      // $eval is only ever called by captureElementStyle (see capture-style.ts) --
      // stubbing it to reject simulates a stale/detached selector at style-capture
      // time without disturbing the screenshot capture, which never calls it.
      vi.spyOn(page, "$eval").mockRejectedValue(new Error("boom: detached element"));

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "body" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (
        attachJsonCalls[0]?.data as { topIssues?: Array<{ kind: string; blocking: boolean }> }
      )?.topIssues;
      expect(topIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "style-check-error", blocking: false }),
        ]),
      );
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("reports a non-blocking style-check-error instead of silently skipping when region-scope style capture times out", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png, {
      document: {
        type: "FRAME",
        fills: [
          {
            type: "SOLID",
            visible: true,
            color: { r: 100 / 255, g: 150 / 255, b: 200 / 255 },
            opacity: 1,
          },
        ],
      },
    });
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      // Never resolves -- the style check's own timeout races it out well before
      // this test's own timeout would, leaving the rest of the matcher (baseline
      // fetch + screenshot capture, neither of which calls $eval) unaffected.
      vi.spyOn(page, "$eval").mockImplementation(() => new Promise(() => undefined));

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "body" },
        {
          timeoutMs: 1500,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (
        attachJsonCalls[0]?.data as { topIssues?: Array<{ kind: string; blocking: boolean }> }
      )?.topIssues;
      expect(topIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "style-check-error", blocking: false }),
        ]),
      );
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("skips style comparison entirely in page scope (no selector)", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png, {
      document: {
        type: "FRAME",
        fills: [{ type: "SOLID", visible: true, color: { r: 255, g: 0, b: 0 }, opacity: 1 }],
      },
    });
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
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
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (attachJsonCalls[0]?.data as { topIssues?: Array<{ kind: string }> })
        ?.topIssues;
      expect(topIssues?.some((issue) => issue.kind.startsWith("style-"))).toBe(false);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("runs one style comparison per page-scope check-point, tagging each issue with its own selector", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    // #a/#b sit off-canvas (position:absolute + negative offset) so their presence
    // never perturbs the page-scope pixel comparison itself -- only their computed
    // style, read via captureElementStyle, matters for this test.
    const app = await server(
      html.replace(
        "</style>",
        `#a,#b{position:absolute;top:-9999px;left:-9999px}#a{color:rgb(255,0,0)}#b{font-size:12px}</style><div id="a">a</div><div id="b">b</div>`,
      ),
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          styleChecks: [
            {
              selector: "#a",
              nodeId: "1:3",
              expectStyle: { color: { r: 0, g: 0, b: 0, a: 1 }, colorProperty: "color" },
            },
            {
              selector: "#b",
              nodeId: "1:4",
              expectStyle: { fontSizePx: 20 },
            },
          ],
        },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (
        attachJsonCalls[0]?.data as {
          topIssues?: Array<{ kind: string; selector?: string }>;
        }
      )?.topIssues;
      expect(topIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "style-color", selector: "#a" }),
          expect.objectContaining({ kind: "style-typography", selector: "#b" }),
        ]),
      );
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("tags a page-scope style-check-error with its own check-point selector, same as a real mismatch", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      // The declared check-point selector ("#missing") never resolves on this
      // page, so captureElementStyle's page.$eval rejects for real -- no mock.
      const result = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          styleChecks: [
            {
              selector: "#missing",
              nodeId: "1:3",
              expectStyle: { color: { r: 0, g: 0, b: 0, a: 1 }, colorProperty: "color" },
            },
          ],
        },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (
        attachJsonCalls[0]?.data as {
          topIssues?: Array<{ kind: string; selector?: string; blocking: boolean }>;
        }
      )?.topIssues;
      expect(topIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "style-check-error",
            selector: "#missing",
            blocking: false,
          }),
        ]),
      );
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("tags a page-scope style-check-error with its own selector on timeout, without erasing a sibling check-point's real result", async () => {
    const { html, png } = solidPagePng();
    // #b sits off-canvas so its computed style, read via captureElementStyle,
    // never perturbs the page-scope pixel comparison itself.
    stubFigmaFetch(png);
    const app = await server(
      html.replace(
        "</style>",
        `#b{position:absolute;top:-9999px;left:-9999px;color:rgb(255,0,0)}</style><div id="b">b</div>`,
      ),
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const real$eval = page.$eval.bind(page);
      // Only #a's own capture hangs -- #b resolves through the real implementation,
      // proving the timeout is scoped per check-point rather than shared across the batch.
      vi.spyOn(page, "$eval").mockImplementation(((selector: string, ...rest: unknown[]) =>
        selector === "#a"
          ? new Promise(() => undefined)
          : // @ts-expect-error -- forwarding the real $eval's variadic args through the mock.
            real$eval(selector, ...rest)) as typeof page.$eval);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          styleChecks: [
            {
              selector: "#a",
              nodeId: "1:3",
              expectStyle: { color: { r: 0, g: 0, b: 0, a: 1 }, colorProperty: "color" },
            },
            {
              selector: "#b",
              nodeId: "1:4",
              expectStyle: { color: { r: 0, g: 0, b: 0, a: 1 }, colorProperty: "color" },
            },
          ],
        },
        {
          timeoutMs: 1500,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (
        attachJsonCalls[0]?.data as {
          topIssues?: Array<{ kind: string; selector?: string; blocking: boolean }>;
        }
      )?.topIssues;
      expect(topIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "style-check-error", selector: "#a", blocking: false }),
          expect.objectContaining({ kind: "style-color", selector: "#b" }),
        ]),
      );
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("adds no issue for a check-point whose expectStyle failed to bake in at authoring time", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    const app = await server(
      html.replace(
        "</style>",
        `#a{position:absolute;top:-9999px;left:-9999px}</style><div id="a">a</div>`,
      ),
    );
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          styleChecks: [{ selector: "#a", nodeId: "1:3" }],
        },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (attachJsonCalls[0]?.data as { topIssues?: unknown[] })?.topIssues;
      expect(topIssues ?? []).toHaveLength(0);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("adds no style topIssues when page-scope styleChecks is an empty array", async () => {
    const { html, png } = solidPagePng();
    stubFigmaFetch(png);
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      const result = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", styleChecks: [] },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(result.pass).toBe(true);
      const topIssues = (attachJsonCalls[0]?.data as { topIssues?: unknown[] })?.topIssues;
      expect(topIssues ?? []).toHaveLength(0);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("never routes a region-scope call's cached-baseline fallback into page check-point diagnostics", async () => {
    const { html, png } = solidPagePng();
    const app = await server(html);
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-figma-"));
    try {
      const page = await context.newPage();
      await page.goto(app.url);

      stubFigmaFetch(png);
      const first = await runToMatchFigma(
        page,
        NODE_ID,
        { fileKey: "file-key", selector: "body" },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );
      expect(first.pass).toBe(true);

      // A retryable Figma outage on the second run makes fetchBaseline fall back to the
      // baseline cached by the first run -- whose ResolvedBaseline carries no figmaStyle
      // key at all (see baseline.ts's retryable-cached branch), unlike a fresh fetch's {}.
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v1/files/")) return new Response("Server error", { status: 500 });
        throw new Error(`unexpected fetch to ${url}`);
      }) as typeof fetch;

      const attachJsonCalls: Array<{ name: string; data: unknown }> = [];
      const second = await runToMatchFigma(
        page,
        NODE_ID,
        {
          fileKey: "file-key",
          selector: "body",
          // A region call would never normally carry styleChecks, but nothing in the
          // option types forbids it -- the matcher must still never treat this as page
          // scope just because figmaStyle happens to be unavailable.
          styleChecks: [{ selector: "body", nodeId: "1:9", expectStyle: { fontSizePx: 999 } }],
        },
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async (name, data) => {
            attachJsonCalls.push({ name, data });
          },
        },
      );

      expect(second.pass).toBe(true);
      const topIssues = (attachJsonCalls[0]?.data as { topIssues?: Array<{ selector?: string }> })
        ?.topIssues;
      expect(topIssues?.some((issue) => issue.selector === "body")).toBe(false);
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
