import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveProjectRoot } from "../src/internal/project-root.ts";
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

describe("resolveProjectRoot", () => {
  it("resolves to the injected runtime's cwd when no override is given", () => {
    expect(resolveProjectRoot(undefined, fakeRuntime({ cwd: () => "/from/runtime" }))).toBe(
      "/from/runtime",
    );
  });

  it("resolves a relative override against the injected runtime's cwd, not global process.cwd()", () => {
    expect(resolveProjectRoot("sub/dir", fakeRuntime({ cwd: () => "/project" }))).toBe(
      path.resolve("/project", "sub/dir"),
    );
  });

  it("leaves an absolute override untouched", () => {
    expect(resolveProjectRoot("/explicit/root", fakeRuntime())).toBe("/explicit/root");
  });
});
