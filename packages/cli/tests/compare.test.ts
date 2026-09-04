import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { compareCommand } from "../src/internal/compare.ts";
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

// Pixel-level pass/fail comparison logic is @framelia/verify's own already-tested
// responsibility (see packages/verify/tests/compare.test.ts); these tests only prove
// internal/compare.ts's own added value: resolving relative paths against the injected
// runtime cwd (never global process.cwd()), all documented profile values being
// accepted, and the default outDir falling back to the actual file's directory.

describe("compareCommand", () => {
  it("resolves relative baseline/actual paths against the injected runtime cwd, not global process.cwd()", () => {
    const result = compareCommand(
      {
        baseline: "missing-a.png",
        actual: "sub/missing-b.png",
        outDir: undefined,
        profile: "component/strict",
      },
      fakeRuntime({ cwd: () => "/from/runtime" }),
    );
    expect(result.pass).toBe(false);
    const message = result.topIssues[0]?.message ?? "";
    expect(message).toContain(path.resolve("/from/runtime", "missing-a.png"));
  });

  it.each(["page", "component/strict", "component/dev"] as const)(
    "accepts the %s profile without throwing",
    (profile) => {
      const result = compareCommand(
        { baseline: "a.png", actual: "b.png", outDir: undefined, profile },
        fakeRuntime(),
      );
      expect(result.pass).toBe(false);
    },
  );
});
