import { describe, expect, it, vi } from "vitest";

import { statusCommand } from "../src/internal/status.ts";
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

describe("statusCommand", () => {
  it("returns the documented fields, resolving projectRoot from the explicit option", () => {
    const result = statusCommand({ projectRoot: "/explicit/root" }, fakeRuntime(), "1.2.3");
    expect(result).toEqual({
      ok: true,
      body: {
        ok: true,
        name: "framelia",
        version: "1.2.3",
        mode: "cli",
        baselineKinds: ["figma"],
        projectRoot: "/explicit/root",
        figmaTokenAvailable: false,
      },
    });
  });

  it("falls back to the injected runtime's cwd when --project-root is not given", () => {
    const result = statusCommand(
      { projectRoot: undefined },
      fakeRuntime({ cwd: () => "/from/runtime" }),
      "1.2.3",
    );
    expect(result.body.projectRoot).toBe("/from/runtime");
  });

  it("derives figmaTokenAvailable from the injected runtime's env, never global process.env", () => {
    const withToken = statusCommand(
      { projectRoot: "/root" },
      fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "secret" } }),
      "1.0.0",
    );
    expect(withToken.body.figmaTokenAvailable).toBe(true);

    const withoutToken = statusCommand({ projectRoot: "/root" }, fakeRuntime({ env: {} }), "1.0.0");
    expect(withoutToken.body.figmaTokenAvailable).toBe(false);
  });
});
