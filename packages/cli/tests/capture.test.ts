import type { FetchBaselineOutcome } from "@framelia/verify";
import { describe, expect, it, vi } from "vitest";

import { EXIT_USAGE_ERROR } from "../src/exit.ts";
import { captureCommand } from "../src/internal/capture.ts";
import type { CliRuntime } from "../src/runtime-types.ts";
import { testEnvironment } from "./test-environment.ts";

function fakeRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    cwd: () => "/project",
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
    ...overrides,
  };
}

describe("captureCommand", () => {
  it("returns a structured exit-2 outcome, not stderr, when --scale is not positive", async () => {
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: -1, canvasFill: undefined },
        testEnvironment(fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "test-token" } })),
      ),
    ).resolves.toMatchObject({
      exitCode: EXIT_USAGE_ERROR,
      body: {
        kind: "framelia.capture-outcome",
        exitCode: 2,
        diagnostics: [{ code: "INVALID_INPUT" }],
      },
    });
  });

  it("explains a missing FIGMA_ACCESS_TOKEN and points at status", async () => {
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: undefined, canvasFill: undefined },
        testEnvironment(fakeRuntime({ env: {} })),
      ),
    ).resolves.toMatchObject({
      exitCode: EXIT_USAGE_ERROR,
      body: {
        diagnostics: [
          { code: "FIGMA_TOKEN_MISSING", message: expect.stringContaining("FIGMA_ACCESS_TOKEN") },
        ],
        next: { command: "framelia", argv: ["status"] },
      },
    });
  });

  it.each<FetchBaselineOutcome>([
    { ok: false, fetched: false, errorClass: "auth", message: "403" },
    { ok: true, fetched: false, errorClass: "retryable", message: "429", warnings: [] },
  ])("exits 2, not the visual-mismatch 1, when no baseline was fetched", async (outcome) => {
    const result = await captureCommand(
      { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: undefined, canvasFill: undefined },
      testEnvironment(fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "test-token" } }), {
        figma: { fetchBaseline: async () => outcome },
      }),
    );
    expect(result).toMatchObject({ ok: false, exitCode: EXIT_USAGE_ERROR, body: outcome });
  });
});
