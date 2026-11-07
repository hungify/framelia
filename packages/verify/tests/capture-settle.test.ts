import * as http from "node:http";

import { chromium, type Page } from "@playwright/test";
import { afterAll, describe, expect, it } from "vitest";

import {
  countDevtoolsMatches,
  fontIncomplete,
  releaseAnimationFreeze,
  settle,
} from "../src/capture/settle.ts";
import { NETWORK_IDLE_BEST_EFFORT_MS } from "../src/constants.ts";
import type { FontReadiness } from "../src/internal.ts";

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
      const fonts = await settle(page, warnings, undefined, "freeze", 20_000);
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
      await settle(page, warnings, '[data-testid="devtools"]', "freeze", 20_000);
      expect(warnings.some((w) => w.includes("matched no elements"))).toBe(true);
    } finally {
      await context.close();
      await app.close();
    }
  });

  describe("when the network never goes idle", () => {
    it("gives up on idle at half the capture budget and says so, so settle stays within the budget", async () => {
      const app = http.createServer((request, response) => {
        if (request.url === "/hang") return;
        response.setHeader("content-type", "text/html");
        response.end("<p>pending request</p><script>fetch('/hang')</script>");
      });
      await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
      const address = app.address();
      if (!address || typeof address === "string") throw new Error("server address unavailable");
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${address.port}`);
        const warnings: string[] = [];
        const startedAt = Date.now();
        await settle(page, warnings, undefined, "freeze", 2_000);
        expect(Date.now() - startedAt).toBeLessThan(4_000);
        expect(warnings).toContainEqual(expect.stringContaining("within 1000ms"));
      } finally {
        await context.close();
        app.closeAllConnections();
        await new Promise<void>((resolve) => app.close(() => resolve()));
      }
    });
  });

  it("does not warn when devtoolsSelector matches an element", async () => {
    const app = await server('<div data-testid="devtools"></div>');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app.url);
      const warnings: string[] = [];
      await settle(page, warnings, '[data-testid="devtools"]', "freeze", 20_000);
      expect(warnings.some((w) => w.includes("matched no elements"))).toBe(false);
    } finally {
      await context.close();
      await app.close();
    }
  });
});

function fakePage(networkIdle: (timeout: number | undefined) => Promise<void>): {
  page: Page;
  networkIdleTimeouts: Array<number | undefined>;
} {
  const networkIdleTimeouts: Array<number | undefined> = [];
  const page = {
    waitForLoadState: async (_state: string, options?: { timeout?: number }) => {
      networkIdleTimeouts.push(options?.timeout);
      await networkIdle(options?.timeout);
    },
    waitForTimeout: async () => {},
    evaluate: async () => ({ supported: true, status: "loaded", failed: [] }),
  } as unknown as Page;
  return { page, networkIdleTimeouts };
}

describe("settle network-idle budget", () => {
  it("keeps the best-effort ceiling for a large budget", async () => {
    const { page, networkIdleTimeouts } = fakePage(async () => {});
    await settle(page, [], undefined, "allow", 600_000);
    expect(networkIdleTimeouts).toEqual([NETWORK_IDLE_BEST_EFFORT_MS]);
  });

  it("keeps the plain warning when the full best-effort wait elapsed", async () => {
    const { page } = fakePage(async () => {
      throw new Error("Timeout exceeded");
    });
    const warnings: string[] = [];
    await settle(page, warnings, undefined, "allow", 600_000);
    expect(warnings).toEqual([
      `network did not become idle within ${NETWORK_IDLE_BEST_EFFORT_MS}ms; capture may include pending requests.`,
    ]);
  });

  it("never passes Playwright's unbounded timeout 0 when no budget is left", async () => {
    const { page, networkIdleTimeouts } = fakePage(async () => {});
    await settle(page, [], undefined, "allow", 0);
    expect(networkIdleTimeouts).toEqual([1]);
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
      await settle(page, [], undefined, "freeze", 20_000);
      await settle(page, [], undefined, "freeze", 20_000);
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
