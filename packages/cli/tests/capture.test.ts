import { describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import { captureCommand } from "../src/internal/capture.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

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
  it("throws a UsageError, not a generic Error, when --scale is not positive", async () => {
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: -1, canvasFill: undefined },
        fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "test-token" } }),
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("throws a UsageError, not a generic Error, when FIGMA_ACCESS_TOKEN is not set", async () => {
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: undefined, canvasFill: undefined },
        fakeRuntime({ env: {} }),
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });
});
