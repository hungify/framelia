import type { SuggestMasksForUrlOptions, SuggestMasksForUrlOutcome } from "@framelia/verify/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { suggestMasksCommand } from "../src/commands/contract.ts";

const { suggestMasksForUrlMock } = vi.hoisted(() => ({
  suggestMasksForUrlMock:
    vi.fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>(),
}));

vi.mock("@framelia/verify/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@framelia/verify/cli")>();
  return { ...actual, suggestMasksForUrl: suggestMasksForUrlMock };
});

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(() => {
  suggestMasksForUrlMock.mockReset();
  logSpy.mockRestore();
  process.exitCode = 0;
});

function loggedJson(): unknown {
  const call = logSpy.mock.calls.at(-1);
  return call ? JSON.parse(String(call[0])) : undefined;
}

describe("suggestMasksCommand", () => {
  it("rejects a non-http(s) --target-url before scanning anything", async () => {
    await expect(suggestMasksCommand({ targetUrl: "ftp://example.test" })).rejects.toThrow(
      /--target-url must use http/,
    );
    expect(suggestMasksForUrlMock).not.toHaveBeenCalled();
  });

  it("requires --viewport-width and --viewport-height together", async () => {
    await expect(
      suggestMasksCommand({ targetUrl: "https://example.test", viewportWidth: 1440 }),
    ).rejects.toThrow(/--viewport-width and --viewport-height must be supplied together/);
    expect(suggestMasksForUrlMock).not.toHaveBeenCalled();
  });

  it("prints candidate selectors as proposals only and never touches a contract file", async () => {
    suggestMasksForUrlMock.mockResolvedValue({
      ok: true,
      url: "https://example.test/",
      suggestions: [
        {
          selector: "time",
          reason: "<time> elements render a timestamp that changes between runs.",
          heuristic: "time-element",
          matchedCount: 1,
        },
      ],
    });

    await suggestMasksCommand({ targetUrl: "https://example.test" });

    expect(suggestMasksForUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.test", headless: true }),
    );
    const printed = loggedJson();
    expect(printed).toMatchObject({
      url: "https://example.test/",
      suggestions: [{ selector: "time", heuristic: "time-element" }],
    });
    expect(JSON.stringify(printed)).toMatch(/nothing was written/i);
    expect(process.exitCode).toBe(0);
  });

  it("reports a non-zero exit code and the failure reason when the scan fails", async () => {
    suggestMasksForUrlMock.mockResolvedValue({
      ok: false,
      error: "CAPTURE_NAVIGATION_FAILED",
      message: "navigation to https://example.test failed: timeout",
    });

    await suggestMasksCommand({ targetUrl: "https://example.test" });

    expect(loggedJson()).toMatchObject({ error: "CAPTURE_NAVIGATION_FAILED" });
    expect(process.exitCode).not.toBe(0);
  });

  it("passes viewport and headed flags through to the scan", async () => {
    suggestMasksForUrlMock.mockResolvedValue({
      ok: true,
      url: "https://example.test/",
      suggestions: [],
    });

    await suggestMasksCommand({
      targetUrl: "https://example.test",
      viewportWidth: 1440,
      viewportHeight: 900,
      headed: true,
    });

    expect(suggestMasksForUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 1440, height: 900 },
        headless: false,
      }),
    );
  });
});
