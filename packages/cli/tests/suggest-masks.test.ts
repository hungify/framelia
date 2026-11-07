import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { SuggestMasksForUrlOptions, SuggestMasksForUrlOutcome } from "@framelia/verify/cli";
import { describe, expect, it, vi } from "vitest";

import type { CommandEnvironment } from "../src/environment.ts";
import { EXIT_USAGE_ERROR } from "../src/exit.ts";
import { suggestMasksCommand } from "../src/internal/contract-suggest-masks.ts";
import { testEnvironment } from "./test-environment.ts";

function depsWith(
  suggestMasksForUrl: (options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>,
): CommandEnvironment {
  return testEnvironment(process, { browser: { suggestMasksForUrl } });
}

describe("suggestMasksCommand", () => {
  it("rejects a non-http(s) --target-url before scanning anything", async () => {
    const mock =
      vi.fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>();
    await expect(
      suggestMasksCommand(
        {
          targetUrl: "ftp://example.test",
          viewportWidth: undefined,
          viewportHeight: undefined,
          storageState: undefined,
          headed: undefined,
        },
        depsWith(mock),
      ),
    ).resolves.toMatchObject({
      exitCode: EXIT_USAGE_ERROR,
      body: { diagnostics: [{ code: "INVALID_INPUT" }] },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it("rejects non-loopback HTTP when browser storage state would be reused", async () => {
    const mock =
      vi.fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>();
    await expect(
      suggestMasksCommand(
        {
          targetUrl: "http://example.test",
          viewportWidth: undefined,
          viewportHeight: undefined,
          storageState: "state.json",
          headed: undefined,
        },
        depsWith(mock),
      ),
    ).resolves.toMatchObject({
      exitCode: EXIT_USAGE_ERROR,
      body: { diagnostics: [{ message: expect.stringMatching(/must use https:\/\//) }] },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it("accepts the bracketed IPv6 loopback with storage state -- URL.hostname keeps the brackets", async () => {
    const mock = vi
      .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
      .mockResolvedValue({
        ok: true,
        url: "http://[::1]:5173/",
        suggestions: [],
      } satisfies SuggestMasksForUrlOutcome);
    const result = await suggestMasksCommand(
      {
        targetUrl: "http://[::1]:5173/",
        viewportWidth: undefined,
        viewportHeight: undefined,
        storageState: "state.json",
        headed: undefined,
      },
      depsWith(mock),
    );
    expect(result.ok).toBe(true);
    expect(mock).toHaveBeenCalledOnce();
  });

  it("requires --viewport-width and --viewport-height together", async () => {
    const mock =
      vi.fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>();
    await expect(
      suggestMasksCommand(
        {
          targetUrl: "https://example.test",
          viewportWidth: 1440,
          viewportHeight: undefined,
          storageState: undefined,
          headed: undefined,
        },
        depsWith(mock),
      ),
    ).resolves.toMatchObject({
      exitCode: EXIT_USAGE_ERROR,
      body: {
        diagnostics: [
          {
            message: expect.stringMatching(
              /--viewport-width and --viewport-height must be supplied together/,
            ),
          },
        ],
      },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns candidate selectors as proposals only and never touches a contract file", async () => {
    const mock = vi
      .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
      .mockResolvedValue({
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
      } satisfies SuggestMasksForUrlOutcome);

    const result = await suggestMasksCommand(
      {
        targetUrl: "https://example.test",
        viewportWidth: undefined,
        viewportHeight: undefined,
        storageState: undefined,
        headed: undefined,
      },
      depsWith(mock),
    );

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.test", headless: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({
      url: "https://example.test/",
      suggestions: [{ selector: "time", heuristic: "time-element" }],
    });
    expect(JSON.stringify(result.body)).toMatch(/nothing was written/i);
  });

  it("reports ok: false and the failure reason when the scan fails", async () => {
    const mock = vi
      .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
      .mockResolvedValue({
        ok: false,
        error: "CAPTURE_NAVIGATION_FAILED",
        message: "navigation to https://example.test failed: timeout",
      } satisfies SuggestMasksForUrlOutcome);

    const result = await suggestMasksCommand(
      {
        targetUrl: "https://example.test",
        viewportWidth: undefined,
        viewportHeight: undefined,
        storageState: undefined,
        headed: undefined,
      },
      depsWith(mock),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(result.body).toMatchObject({ error: "CAPTURE_NAVIGATION_FAILED" });
  });

  it("passes viewport and headed flags through to the scan", async () => {
    const mock = vi
      .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
      .mockResolvedValue({
        ok: true,
        url: "https://example.test/",
        suggestions: [],
      } satisfies SuggestMasksForUrlOutcome);

    await suggestMasksCommand(
      {
        targetUrl: "https://example.test",
        viewportWidth: 1440,
        viewportHeight: 900,
        storageState: undefined,
        headed: true,
      },
      depsWith(mock),
    );

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 1440, height: 900 },
        headless: false,
      }),
    );
  });
});

describe("suggestMasksCommand: default storage state", () => {
  it("uses the project's recorded storageStatePath, but never sends it over plain remote http", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-suggest-state-"));
    try {
      fs.writeFileSync(
        path.join(root, "framelia.config.mjs"),
        'export default { storageStatePath: ".framelia/auth/user.json" };\n',
      );
      fs.mkdirSync(path.join(root, ".framelia", "auth"), { recursive: true });
      fs.writeFileSync(path.join(root, ".framelia", "auth", "user.json"), "{}");
      const mock = vi
        .fn<(options: SuggestMasksForUrlOptions) => Promise<SuggestMasksForUrlOutcome>>()
        .mockResolvedValue({ ok: true, url: "https://example.test/", suggestions: [] });
      const options = {
        projectRoot: root,
        viewportWidth: undefined,
        viewportHeight: undefined,
        storageState: undefined,
        headed: undefined,
      };

      await suggestMasksCommand({ ...options, targetUrl: "https://example.test/" }, depsWith(mock));
      expect(mock.mock.calls[0]?.[0].storageStatePath).toBe(
        path.join(root, ".framelia", "auth", "user.json"),
      );

      await suggestMasksCommand({ ...options, targetUrl: "http://example.test/" }, depsWith(mock));
      expect(mock.mock.calls[1]?.[0].storageStatePath).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
