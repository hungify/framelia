import { describe, expect, it, vi } from "vitest";

import { statusCommand } from "../src/internal/status.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

/**
 * Phase 3 (see the CLI v2 rewrite plan): `internal/status.ts` is a pure function of
 * `(options, runtime)` -- no Stricli, no `CliContext`, no global `process`.
 */

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
    const result = statusCommand(
      { projectRoot: "/explicit/root", version: "1.2.3" },
      fakeRuntime(),
    );
    expect(result).toEqual({
      ok: true,
      name: "framelia",
      version: "1.2.3",
      mode: "cli",
      baselineKinds: ["figma"],
      projectRoot: "/explicit/root",
      figmaTokenAvailable: false,
    });
  });

  it("falls back to the injected runtime's cwd when --project-root is not given", () => {
    const result = statusCommand(
      { projectRoot: undefined, version: "1.2.3" },
      fakeRuntime({ cwd: () => "/from/runtime" }),
    );
    expect(result.projectRoot).toBe("/from/runtime");
  });

  it("derives figmaTokenAvailable from the injected runtime's env, never global process.env", () => {
    const withToken = statusCommand(
      { projectRoot: "/root", version: "1.0.0" },
      fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "secret" } }),
    );
    expect(withToken.figmaTokenAvailable).toBe(true);

    const withoutToken = statusCommand(
      { projectRoot: "/root", version: "1.0.0" },
      fakeRuntime({ env: {} }),
    );
    expect(withoutToken.figmaTokenAvailable).toBe(false);
  });
});
