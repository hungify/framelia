import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ExitCode } from "@stricli/core";
import { afterEach, describe, expect, it } from "vitest";

import { applicationText } from "../src/application-text.ts";
import { run } from "../src/cli.ts";
import { buildContext } from "../src/context.ts";
import {
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  UsageError,
  normalizeStricliExitCode,
} from "../src/exit.ts";
import { emitResult } from "../src/output.ts";
import { createFakeProcess } from "./fake-process.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("run: project env", () => {
  it("loads .env from the injected runtime's cwd into that runtime's env, not the global one", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-env-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, ".env"), "FIGMA_ACCESS_TOKEN=token-from-dotenv\n");
    const fakeProc = { ...createFakeProcess({}), cwd: () => projectRoot };

    await run(["status"], { process: fakeProc });

    expect(fakeProc.env.FIGMA_ACCESS_TOKEN).toBe("token-from-dotenv");
    expect(process.env.FIGMA_ACCESS_TOKEN).not.toBe("token-from-dotenv");
    const parsed = JSON.parse(fakeProc.stdoutText()) as { figmaTokenAvailable: boolean };
    expect(parsed.figmaTokenAvailable).toBe(true);
  });
});

describe("emitResult", () => {
  it("writes indented JSON with a trailing newline and sets exit code 0 on success", () => {
    const fakeProc = createFakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, { ok: true, body: { ok: true } });
    expect(fakeProc.stdoutText()).toBe('{\n  "ok": true\n}\n');
    expect(fakeProc.exitCode).toBe(EXIT_OK);
  });

  it("sets exit code 1 (EXIT_VISUAL_FAIL) when the result is not ok", () => {
    const fakeProc = createFakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, { ok: false, body: { pass: false } });
    expect(fakeProc.exitCode).toBe(EXIT_VISUAL_FAIL);
  });

  it("writes to stdout, never stderr", () => {
    const fakeProc = createFakeProcess();
    const context = buildContext({ process: fakeProc, version: "1.0.0" });
    emitResult(context, { ok: true, body: {} });
    expect(fakeProc.stderrText()).toBe("");
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
