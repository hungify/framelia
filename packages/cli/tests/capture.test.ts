import { describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/errors.ts";
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
    // A token is supplied so this can only fail on --scale: with a token-less runtime,
    // the missing-token check below would raise the same UsageError and let a regressed
    // scale schema pass unnoticed.
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: -1, canvasFill: undefined },
        fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "test-token" } }),
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("throws a UsageError, not a generic Error, when FIGMA_ACCESS_TOKEN is not set", async () => {
    // Fails fast on the injected runtime's own env instead of letting the missing
    // token fall through to `fetchBaseline`'s `resolveToken` (which would otherwise
    // reach for the real host `process.env` -- see internal/capture.ts's doc comment).
    await expect(
      captureCommand(
        { fileKey: "abc", nodeId: "1:1", out: "out.png", scale: undefined, canvasFill: undefined },
        fakeRuntime({ env: {} }),
      ),
    ).rejects.toBeInstanceOf(UsageError);
  });
});
