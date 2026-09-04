import { ExitCode } from "@stricli/core";
import { describe, expect, it, vi } from "vitest";

import { applicationText, normalizeStricliExitCode } from "../src/application-text.ts";
import { EXIT_OK, EXIT_USAGE_ERROR, EXIT_VISUAL_FAIL } from "../src/cli-constants.ts";
import { buildContext, type CliProcess } from "../src/context.ts";
import { UsageError } from "../src/errors.ts";
import { emitResult } from "../src/output.ts";

/**
 * Phase 1 (see the CLI v2 rewrite plan): unit tests for the runtime/error/output
 * seams, independent of any Stricli `Application`/route map -- that wiring is
 * exercised in Phase 2's `route-map.test.ts`/`scanner-compatibility.test.ts`.
 */

function fakeProcess(): CliProcess {
  return {
    cwd: () => "/project",
    env: {},
    stdin: process.stdin,
    stdout: { write: vi.fn<(text: string) => void>() },
    stderr: { write: vi.fn<(text: string) => void>() },
    exitCode: undefined,
  };
}

describe("buildContext", () => {
  it("wires the same process object into both `process` and `runtime`", () => {
    const fakeProc = fakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.2.3" });
    expect(context.process).toBe(fakeProc);
    expect(context.runtime).toBe(fakeProc);
    expect(context.version).toBe("1.2.3");
  });

  it("defaults to the real global process when none is provided", () => {
    const context = buildContext({ version: "0.0.0" });
    expect(context.process).toBe(process);
    expect(context.runtime).toBe(process);
  });
});

describe("emitResult", () => {
  it("writes indented JSON with a trailing newline and sets exit code 0 on success", () => {
    const fakeProc = fakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, { ok: true }, true);
    expect(fakeProc.stdout.write).toHaveBeenCalledWith('{\n  "ok": true\n}\n');
    expect(fakeProc.exitCode).toBe(EXIT_OK);
  });

  it("sets exit code 1 (EXIT_VISUAL_FAIL) when the result is not ok", () => {
    const fakeProc = fakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, { pass: false }, false);
    expect(fakeProc.exitCode).toBe(EXIT_VISUAL_FAIL);
  });

  it("writes to stdout, never stderr", () => {
    const fakeProc = fakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, {}, true);
    expect(fakeProc.stderr.write).not.toHaveBeenCalled();
  });
});

describe("UsageError", () => {
  it("carries exitCode 2 (EXIT_USAGE_ERROR)", () => {
    const error = new UsageError("bad flag combination");
    expect(error.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(error.message).toBe("bad flag combination");
    expect(error.name).toBe("UsageError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("application-text: exceptionWhileRunningCommand", () => {
  it("returns just the error message, matching today's bare `console.error(error.message)` behavior", () => {
    const error = new UsageError("Auth URL must use http:// or https://.");
    expect(applicationText.exceptionWhileRunningCommand(error, false)).toBe(
      "Auth URL must use http:// or https://.",
    );
  });

  it("does not include a stack trace for a plain Error", () => {
    const error = new Error("boom");
    const formatted = applicationText.exceptionWhileRunningCommand(error, false);
    expect(formatted).toBe("boom");
    expect(formatted).not.toContain("at ");
  });

  it("stringifies a thrown non-Error value", () => {
    expect(applicationText.exceptionWhileRunningCommand("plain string throw", false)).toBe(
      "plain string throw",
    );
  });
});

describe("application-text: commandErrorResult", () => {
  it("still just returns the error message (inherited from text_en, no prefix)", () => {
    const error = new UsageError("missing required field");
    expect(applicationText.commandErrorResult(error, false)).toBe("missing required field");
  });
});

describe("normalizeStricliExitCode", () => {
  it("normalizes Stricli's negative scanner/routing exit codes to EXIT_USAGE_ERROR", () => {
    expect(normalizeStricliExitCode(ExitCode.InvalidArgument)).toBe(EXIT_USAGE_ERROR);
    expect(normalizeStricliExitCode(ExitCode.UnknownCommand)).toBe(EXIT_USAGE_ERROR);
    expect(normalizeStricliExitCode(ExitCode.ContextLoadError)).toBe(EXIT_USAGE_ERROR);
    expect(normalizeStricliExitCode(ExitCode.CommandLoadError)).toBe(EXIT_USAGE_ERROR);
    expect(normalizeStricliExitCode(ExitCode.InternalError)).toBe(EXIT_USAGE_ERROR);
  });

  it("leaves Success/CommandRunError and other non-negative codes unchanged", () => {
    expect(normalizeStricliExitCode(ExitCode.Success)).toBe(ExitCode.Success);
    expect(normalizeStricliExitCode(ExitCode.CommandRunError)).toBe(ExitCode.CommandRunError);
    expect(normalizeStricliExitCode(EXIT_VISUAL_FAIL)).toBe(EXIT_VISUAL_FAIL);
  });

  it("passes through undefined/null unchanged", () => {
    expect(normalizeStricliExitCode(undefined)).toBeUndefined();
    expect(normalizeStricliExitCode(null)).toBeNull();
  });
});
