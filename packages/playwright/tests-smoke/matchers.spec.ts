import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect } from "@framelia/playwright";
import { promotePageBaseline } from "@framelia/verify";
import { makeSolidPng } from "@framelia/verify/internal";
import { test } from "@playwright/test";
import { PNG } from "pngjs";

const SIZE = { width: 100, height: 80 };
const HTML = `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(100,150,200)}</style>`;
const DIFFERENT_HTML = `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:rgb(10,20,30)}</style>`;
const PNG_BODY = PNG.sync.write(makeSolidPng(100, 80, [100, 150, 200, 255]));
const NODE_ID = "1:2";

test.beforeEach(() => {
  process.env.FIGMA_ACCESS_TOKEN = "smoke-token";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/files/"))
      return new Response(
        JSON.stringify({ lastModified: "2026-08-15T00:00:00Z", nodes: { [NODE_ID]: {} } }),
        { status: 200 },
      );
    if (url.includes("/v1/images/"))
      return new Response(
        JSON.stringify({ images: { [NODE_ID]: "https://cdn.test/baseline.png" } }),
        {
          status: 200,
        },
      );
    return new Response(PNG_BODY, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
});

test("real runner executes toMatchFigma and emits pass/fail attachments", async ({ page }) => {
  await page.setContent(HTML);
  await expect(page).toMatchFigma(NODE_ID, { fileKey: "smoke-file" });

  await page.setContent(DIFFERENT_HTML);
  await expect(expect(page).toMatchFigma(NODE_ID, { fileKey: "smoke-file" })).rejects.toThrow(
    /did not match Figma baseline/,
  );
});

test("real runner executes toMatchPage", async ({ page }) => {
  const reference = await page.context().newPage();
  await page.setContent(HTML);
  await reference.setContent(HTML);
  await expect(page).toMatchPage(reference);

  await reference.setContent(DIFFERENT_HTML);
  await expect(expect(page).toMatchPage(reference)).rejects.toThrow(/pages did not match/);
  await reference.close();
});

test("real runner executes toMatchPageBaseline against a promoted baseline", async ({ page }) => {
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-smoke-page-baseline-"));
  const sourcePath = path.join(baselineDir, "source.png");
  fs.writeFileSync(sourcePath, PNG_BODY);
  promotePageBaseline({ sourcePath, outDir: baselineDir, promotedBy: "smoke-test" });

  await page.setContent(HTML);
  await expect(page).toMatchPageBaseline("smoke-key", { baselineDir });

  await page.setContent(DIFFERENT_HTML);
  await expect(expect(page).toMatchPageBaseline("smoke-key", { baselineDir })).rejects.toThrow(
    /did not match promoted baseline/,
  );
});

test("real runner executes toMatchUrl in caller context", async ({ page }) => {
  await page.setContent(HTML);
  const dataUrl = `data:text/html,${encodeURIComponent(HTML)}`;
  await expect(page).toMatchUrl(dataUrl);

  const differentUrl = `data:text/html,${encodeURIComponent(DIFFERENT_HTML)}`;
  await expect(expect(page).toMatchUrl(differentUrl)).rejects.toThrow(/pages did not match/);
});
