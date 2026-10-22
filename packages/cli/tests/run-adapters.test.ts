import type { FetchBaselineOptions, FetchBaselineOutcome } from "@framelia/verify";
import type { SuggestMasksForUrlOptions, SuggestMasksForUrlOutcome } from "@framelia/verify/cli";
import { describe, expect, it, vi } from "vitest";

import { run } from "../src/cli.ts";
import { defaultAdapters } from "../src/environment.ts";
import { createFakeProcess } from "./fake-process.ts";

/** These drive the real Stricli routes, so flag parsing and flag-to-option mapping are covered. */
describe("run() with injected adapters", () => {
  it("maps capture flags onto one Figma fetch and exits 2 when nothing was fetched", async () => {
    const fetchBaseline = vi
      .fn<(options: FetchBaselineOptions) => Promise<FetchBaselineOutcome>>()
      .mockResolvedValue({ ok: false, fetched: false, errorClass: "auth", message: "403" });
    const fakeProcess = createFakeProcess({ FIGMA_ACCESS_TOKEN: "token" });

    await run(["capture", "-k", "file-key", "-n", "1:2", "-o", "out/base.png", "--scale", "2"], {
      process: fakeProcess,
      loadProjectEnv: false,
      adapters: {
        figma: async () => ({ ...(await defaultAdapters.figma()), fetchBaseline }),
      },
    });

    expect(fetchBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: "file-key",
        nodeId: "1:2",
        outPath: "/tmp/framelia-fake-cwd/out/base.png",
        scale: 2,
        token: "token",
      }),
    );
    expect(fakeProcess.exitCode).toBe(2);
    expect(JSON.parse(fakeProcess.stdoutText())).toMatchObject({ errorClass: "auth" });
  });

  it("maps suggest-masks viewport and headed flags onto the browser scan", async () => {
    const suggestMasksForUrl = vi
      .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
      .mockResolvedValue({ ok: true, url: "https://example.test/", suggestions: [] });
    const fakeProcess = createFakeProcess();

    await run(
      ["contract", "suggest-masks", "-t", "https://example.test", "-w", "1440", "-H", "900", "-e"],
      {
        process: fakeProcess,
        loadProjectEnv: false,
        adapters: {
          browser: async () => ({ ...(await defaultAdapters.browser()), suggestMasksForUrl }),
        },
      },
    );

    expect(suggestMasksForUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.test",
        viewport: { width: 1440, height: 900 },
        headless: false,
      }),
    );
    expect(fakeProcess.exitCode).toBe(0);
  });
});
