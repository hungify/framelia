import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pageBaselineImagePath, readPageBaselineMeta } from "../../src/baseline/page.ts";
import { captureAndPromotePageBaseline } from "../../src/baseline/promote-page.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-promote-page-baseline-"));
  temporaryDirectories.push(dir);
  return dir;
}

async function withTestServer(html: string, run: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not expose a TCP port.");
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const PAGE_HTML =
  "<style>html,body{margin:0}body{width:120px;height:80px;background:rgb(20,40,60)}</style>";

describe("captureAndPromotePageBaseline", () => {
  it("captures a live page and promotes it as version 1", async () => {
    const outDir = tempDir();
    await withTestServer(PAGE_HTML, async (url) => {
      const result = await captureAndPromotePageBaseline({
        url,
        outDir,
        promotedBy: "alice@example.com",
        headless: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.baselinePath).toBe(pageBaselineImagePath(outDir, 1));
      expect(fs.existsSync(result.baselinePath)).toBe(true);
      expect(fs.statSync(result.baselinePath).size).toBeGreaterThan(0);
      expect(result.meta.current).toMatchObject({ version: 1, promotedBy: "alice@example.com" });
    });
  }, 30_000);

  it("versions a second promotion instead of silently overwriting the first", async () => {
    const outDir = tempDir();
    await withTestServer(PAGE_HTML, async (url) => {
      await captureAndPromotePageBaseline({
        url,
        outDir,
        promotedBy: "alice@example.com",
        headless: true,
      });
      const second = await captureAndPromotePageBaseline({
        url,
        outDir,
        promotedBy: "bob@example.com",
        headless: true,
      });

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.meta.current).toMatchObject({ version: 2, promotedBy: "bob@example.com" });
      expect(second.archivedPath).toBeDefined();
      expect(fs.existsSync(second.archivedPath!)).toBe(true);

      const meta = readPageBaselineMeta(outDir);
      expect(meta?.history).toHaveLength(1);
    });
  }, 30_000);

  it("reports a structured failure when the page never becomes ready to capture", async () => {
    const outDir = tempDir();
    const result = await captureAndPromotePageBaseline({
      url: "http://127.0.0.1:1/unreachable",
      outDir,
      promotedBy: "alice@example.com",
      headless: true,
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBeTruthy();
  }, 30_000);
});
