import * as http from "node:http";

import { chromium, type Page } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import {
  countDevtoolsMatches,
  fontIncomplete,
  fontReadyTimeoutMs,
  releaseAnimationFreeze,
  settle,
} from "../src/capture/settle.ts";
import type { FontReadiness } from "../src/capture/types.ts";

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

describe("fontIncomplete", () => {
  it("is false only when supported, loaded, and nothing failed", () => {
    expect(fontIncomplete({ supported: true, status: "loaded", failed: [] })).toBe(false);
  });

  it("is true when unsupported", () => {
    expect(fontIncomplete({ supported: false, status: "unknown", failed: [] })).toBe(true);
  });

  it("is true when still loading", () => {
    expect(fontIncomplete({ supported: true, status: "loading", failed: [] })).toBe(true);
  });

  it("is true when at least one face failed", () => {
    const fonts: FontReadiness = { supported: true, status: "loaded", failed: ["Inter"] };
    expect(fontIncomplete(fonts)).toBe(true);
  });
});

describe("settle", () => {
  it("resolves fonts.supported=true on a real page and returns no devtools warning when unset", async () => {
    const app = await server("<p>settle test</p>");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const warnings: string[] = [];
      const fonts = await settle(page, warnings, undefined, "freeze", 2_000);
      expect(fonts.supported).toBe(true);
      expect(warnings).toEqual([]);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("warns when devtoolsSelector matches nothing", async () => {
    const app = await server("<p>no devtools here</p>");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const warnings: string[] = [];
      await settle(page, warnings, '[data-testid="devtools"]', "freeze", 2_000);
      expect(warnings.some((w) => w.includes("matched no elements"))).toBe(true);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("does not warn when devtoolsSelector matches an element", async () => {
    const app = await server('<div data-testid="devtools"></div>');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const warnings: string[] = [];
      await settle(page, warnings, '[data-testid="devtools"]', "freeze", 2_000);
      expect(warnings.some((w) => w.includes("matched no elements"))).toBe(false);
    } finally {
      await context.close();
      await app.close();
    }
  });
});

describe("settle font budget", () => {
  it("gives the font wait only a fraction of the remaining capture budget", async () => {
    const evaluateArgs: unknown[] = [];
    const page = {
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (_fn: unknown, arg: unknown) => {
        evaluateArgs.push(arg);
        return { supported: true, status: "loading", failed: [] };
      },
    } as unknown as Page;
    const fonts = await settle(page, [], undefined, "allow", 10_000);
    expect(fonts.status).toBe("loading");
    // The only evaluate call under "allow" is the font wait; it must end well before the
    // budget so fontPolicy can still reject/warn before an outer matcher timeout.
    expect(evaluateArgs).toHaveLength(1);
    const fontTimeout = evaluateArgs[0] as number;
    expect(fontTimeout).toBeLessThanOrEqual(fontReadyTimeoutMs(10_000));
    expect(fontTimeout).toBeGreaterThan(fontReadyTimeoutMs(10_000) - 100);
    expect(fontReadyTimeoutMs(10_000)).toBeLessThan(10_000);
    expect(fontReadyTimeoutMs(-5)).toBe(0);
  });
});

describe("animation freeze", () => {
  it("is injected once and removed by releaseAnimationFreeze", async () => {
    const app = await server("<p>freeze</p>");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const count = () => page.locator("style[data-framelia-freeze]").count();
      await settle(page, [], undefined, "freeze", 2_000);
      await settle(page, [], undefined, "freeze", 2_000);
      expect(await count()).toBe(1);
      await releaseAnimationFreeze(page);
      expect(await count()).toBe(0);
    } finally {
      await context.close();
      await app.close();
    }
  });
});

describe("countDevtoolsMatches", () => {
  it("counts matches in light DOM", async () => {
    const app = await server('<div class="tsqd-x"></div><div class="tsqd-y"></div>');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      expect(await countDevtoolsMatches(page, '[class*="tsqd" i]')).toBe(2);
    } finally {
      await context.close();
      await app.close();
    }
  });

  it("counts matches nested inside an open shadow root", async () => {
    const app = await server(`
      <div id="host"></div>
      <script>
        const host = document.getElementById("host");
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = '<div class="tsqd-inner"></div>';
      </script>
    `);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      expect(await countDevtoolsMatches(page, '[class*="tsqd" i]')).toBe(1);
    } finally {
      await context.close();
      await app.close();
    }
  });
});
