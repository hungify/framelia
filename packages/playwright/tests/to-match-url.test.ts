import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import { runToMatchUrl } from "../src/matchers/to-match-url.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

const SIZE = { width: 100, height: 80 };

function solidBody(color: string): string {
  return `<style>html,body{margin:0}body{width:${SIZE.width}px;height:${SIZE.height}px;background:${color}}</style>`;
}

async function server(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = http.createServer(handler);
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("runToMatchUrl", () => {
  it("navigates a new page in the caller's context and diffs it (happy path)", async () => {
    const app = await server((_request, response) => {
      response.end(solidBody("rgb(20,40,60)"));
    });
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-url-"));
    try {
      const received = await context.newPage();
      await received.goto(app.url);

      const result = await runToMatchUrl(
        received,
        `${app.url}/other`,
        "url",
        {},
        {
          timeoutMs: 5_000,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(result.pass).toBe(true);
      expect(context.pages()).toHaveLength(1); // toMatchUrl's own page closed itself
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("reuses the caller's session cookie without a separate login", async () => {
    const app = await server((request, response) => {
      const authed = (request.headers.cookie ?? "").includes("session=ok");
      if (request.url === "/protected") {
        response.end(solidBody(authed ? "rgb(10,20,30)" : "rgb(200,10,10)"));
        return;
      }
      response.writeHead(200, { "Set-Cookie": "session=ok" });
      response.end(solidBody("rgb(10,20,30)"));
    });
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-url-"));
    try {
      const received = await context.newPage();
      await received.goto(app.url); // sets session cookie in the shared context

      const result = await runToMatchUrl(
        received,
        `${app.url}/protected`,
        "url",
        {},
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

  it("fails with a clear message instead of hanging when navigation times out", async () => {
    const app = await server(() => {
      // Never respond — forces goto's own timeout.
    });
    const context = await browser.newContext({ viewport: SIZE });
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-to-match-url-"));
    try {
      const received = await context.newPage();
      await received.goto("about:blank");

      const startedAt = Date.now();
      const result = await runToMatchUrl(
        received,
        app.url,
        "url",
        {},
        {
          timeoutMs: 200,
          workDir,
          attach: async () => undefined,
          attachJson: async () => undefined,
        },
      );

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/timeout|timed out/i);
    } finally {
      await context.close();
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
