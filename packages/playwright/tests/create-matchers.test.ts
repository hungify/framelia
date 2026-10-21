import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { chromium, type ExpectMatcherState, type Page, type TestInfo } from "@playwright/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFrameliaMatchers } from "../src/create-matchers.ts";

const browser = await chromium.launch();
afterAll(() => browser.close());

const FILE_KEY_ENV_VAR = "FRAMELIA_FIGMA_FILE_KEY";
let savedFileKey: string | undefined;
beforeEach(() => {
  savedFileKey = process.env[FILE_KEY_ENV_VAR];
  delete process.env[FILE_KEY_ENV_VAR];
});
afterEach(() => {
  if (savedFileKey === undefined) delete process.env[FILE_KEY_ENV_VAR];
  else process.env[FILE_KEY_ENV_VAR] = savedFileKey;
});

/** A fake `test` handle whose `info()` records every `outputPath` segment requested. */
function fakeHandle(): { handle: { info(): TestInfo }; outputPaths: string[] } {
  const outputPaths: string[] = [];
  const testInfo = {
    outputPath: (segment: string) => {
      outputPaths.push(segment);
      return path.join(os.tmpdir(), "framelia-create-matchers", segment);
    },
    attach: async () => undefined,
    config: { updateSnapshots: "none" },
  } as unknown as TestInfo;
  return { handle: { info: () => testInfo }, outputPaths };
}

function state(isNot: boolean, timeout = 5_000): ExpectMatcherState {
  return { isNot, timeout } as ExpectMatcherState;
}

const SOLID = (rgb: string) =>
  `<style>html,body{margin:0}body{width:100px;height:80px;background:rgb(${rgb})}</style>`;

describe("createFrameliaMatchers", () => {
  it("gives every toMatchFigma call its own work directory, even for the same node", async () => {
    const { handle, outputPaths } = fakeHandle();
    const { toMatchFigma } = createFrameliaMatchers(handle);
    const page = {} as Page;

    await toMatchFigma.call(state(false), page, "1:2");
    await toMatchFigma.call(state(false), page, "1:2");

    expect(outputPaths).toHaveLength(2);
    expect(outputPaths[0]).toMatch(/^framelia-1-2-/);
    expect(outputPaths[1]).toMatch(/^framelia-1-2-/);
    expect(outputPaths[0]).not.toBe(outputPaths[1]);
  });

  it("returns an operational failure as pass: false, but throws it under .not", async () => {
    const { handle } = fakeHandle();
    const { toMatchFigma } = createFrameliaMatchers(handle);
    const page = {} as Page;

    const result = await toMatchFigma.call(state(false), page, "1:2");
    expect(result.pass).toBe(false);
    expect(result.message()).toMatch(/no Figma file key/);

    // `.not` would otherwise invert "could not fetch/capture" into a silent pass.
    await expect(toMatchFigma.call(state(true), page, "1:2")).rejects.toThrow(/no Figma file key/);
  });

  it("still returns a genuine mismatch under .not so Playwright can invert it", async () => {
    const { handle } = fakeHandle();
    const { toMatchPage } = createFrameliaMatchers(handle);
    const context = await browser.newContext({ viewport: { width: 100, height: 80 } });
    try {
      const page = await context.newPage();
      const reference = await context.newPage();
      await page.setContent(SOLID("10,20,30"));
      await reference.setContent(SOLID("200,20,20"));

      const result = await toMatchPage.call(state(true), page, reference);
      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/pages did not match/);
    } finally {
      await context.close();
    }
  });

  it("uses a per-call timeout option over the expect timeout", async () => {
    const { handle } = fakeHandle();
    const { toMatchUrl } = createFrameliaMatchers(handle);
    // Accepts connections but never answers, so only the deadline can end navigation.
    const hanging = http.createServer(() => undefined);
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const address = hanging.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const result = await toMatchUrl.call(
        state(false, 30_000),
        page,
        `http://127.0.0.1:${address.port}/`,
        { timeout: 200 },
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toMatch(/200ms/);
    } finally {
      await context.close();
      hanging.closeAllConnections();
      await new Promise<void>((resolve) => hanging.close(() => resolve()));
    }
  });
});
