import type { TestInfo } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  attachDiffTriplet,
  buildAttachContext,
  sanitizeAttachmentBaseName,
} from "../src/attach.ts";

/** Minimal fake of the one TestInfo member buildAttachContext actually calls --
 *  isolated from a live Playwright test context, per the runner-agnostic-core
 *  pattern used throughout this package's matchers. */
function fakeTestInfo(): {
  testInfo: TestInfo;
  calls: Array<{
    name: string;
    options: { body?: string | Buffer; contentType?: string; path?: string };
  }>;
} {
  const calls: Array<{
    name: string;
    options: { body?: string | Buffer; contentType?: string; path?: string };
  }> = [];
  const testInfo = {
    attach: (
      name: string,
      options: { body?: string | Buffer; contentType?: string; path?: string } = {},
    ) => {
      calls.push({ name, options });
      return Promise.resolve();
    },
  } as unknown as TestInfo;
  return { testInfo, calls };
}

describe("buildAttachContext", () => {
  it("attach() forwards name/path with an image/png content type and resolves void", async () => {
    const { testInfo, calls } = fakeTestInfo();
    const { attach } = buildAttachContext(testInfo);

    const result = await attach("expected", "/tmp/expected.png");

    expect(result).toBeUndefined();
    expect(calls).toEqual([
      { name: "expected", options: { path: "/tmp/expected.png", contentType: "image/png" } },
    ]);
  });

  it("attachJson() serializes data with an application/json content type and resolves void", async () => {
    const { testInfo, calls } = fakeTestInfo();
    const { attachJson } = buildAttachContext(testInfo);

    const result = await attachJson("framelia-score", { pass: true, matchRatio: 0.999 });

    expect(result).toBeUndefined();
    expect(calls).toEqual([
      {
        name: "framelia-score",
        options: {
          body: JSON.stringify({ pass: true, matchRatio: 0.999 }),
          contentType: "application/json",
        },
      },
    ]);
  });

  it("each call binds to the TestInfo it was built from, not a shared/global instance", async () => {
    const first = fakeTestInfo();
    const second = fakeTestInfo();

    await buildAttachContext(first.testInfo).attach("a", "/tmp/a.png");
    await buildAttachContext(second.testInfo).attach("b", "/tmp/b.png");

    expect(first.calls).toEqual([
      { name: "a", options: { path: "/tmp/a.png", contentType: "image/png" } },
    ]);
    expect(second.calls).toEqual([
      { name: "b", options: { path: "/tmp/b.png", contentType: "image/png" } },
    ]);
  });
});

describe("sanitizeAttachmentBaseName", () => {
  it("prefixes with framelia- and collapses non-alphanumeric runs to a single dash", () => {
    expect(sanitizeAttachmentBaseName("1:2")).toBe("framelia-1-2");
    expect(sanitizeAttachmentBaseName("a/b//c")).toBe("framelia-a-b-c");
  });
});

describe("attachDiffTriplet", () => {
  it("attaches expected/actual/diff in order when all three paths are present", async () => {
    const calls: Array<{ name: string; path: string }> = [];
    await attachDiffTriplet(
      async (name, path) => {
        calls.push({ name, path });
      },
      "base",
      { expected: "/tmp/e.png", actual: "/tmp/a.png", diff: "/tmp/d.png" },
    );

    expect(calls).toEqual([
      { name: "base-expected", path: "/tmp/e.png" },
      { name: "base-actual", path: "/tmp/a.png" },
      { name: "base-diff", path: "/tmp/d.png" },
    ]);
  });

  it("omits expected/diff attachments when their paths are null or absent", async () => {
    const calls: Array<{ name: string; path: string }> = [];
    await attachDiffTriplet(
      async (name, path) => {
        calls.push({ name, path });
      },
      "base",
      { expected: null, actual: "/tmp/a.png" },
    );

    expect(calls).toEqual([{ name: "base-actual", path: "/tmp/a.png" }]);
  });
});
