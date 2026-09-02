import * as http from "node:http";

import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import { resolveSelector } from "../src/capture/readiness.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

async function server(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const app = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => app.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("resolveSelector", () => {
  it("resolves cleanly (returns null) when the selector matches exactly one element", async () => {
    const app = await server('<div id="unique">one</div>');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      expect(await resolveSelector(page, "#unique")).toBeNull();
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("rejects with SELECTOR_NOT_FOUND when nothing matches", async () => {
    const app = await server("<div>nothing matches this</div>");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const result = await resolveSelector(page, "#does-not-exist");
      expect(result).toMatchObject({ ok: false, error: "SELECTOR_NOT_FOUND" });
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("rejects with SELECTOR_AMBIGUOUS when more than one element matches", async () => {
    const app = await server('<div class="dup">a</div><div class="dup">b</div>');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const result = await resolveSelector(page, ".dup");
      expect(result).toMatchObject({ ok: false, error: "SELECTOR_AMBIGUOUS", matchCount: 2 });
    } finally {
      await context.close();
      await app.close();
    }
  });
});
