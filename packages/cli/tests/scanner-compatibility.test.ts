import { describe, expect, it } from "vitest";

import { run } from "../src/cli.ts";
import { createFakeProcess } from "./fake-process.ts";

/**
 * Stricli's argument scanner, exercised through the exported `run(argv, { process })`
 * seam (see the rewrite plan's Architecture §4). Confirms every scanner failure is
 * normalized to exit `2` on stderr only (never a negative `ExitCode`, never stdout) --
 * see `application-text.ts`'s `normalizeStricliExitCode` and `cli.ts`'s call to it.
 * Diagnostic wording itself is allowed to differ from the old Commander CLI (see
 * golden-baseline.test.ts and cli-help.test.ts for the documented wording changes);
 * this file only asserts the exit-code/stream contract plus enough content to identify
 * the failure category.
 */
function assertUsageError(fakeProcess: ReturnType<typeof createFakeProcess>): void {
  expect(fakeProcess.exitCode).toBe(2);
  expect(fakeProcess.stdoutText()).toBe("");
  expect(fakeProcess.stderrText()).not.toBe("");
}

describe("scanner compatibility: duplicate flags", () => {
  it("rejects a repeated flag with exit 2, stderr only", async () => {
    const fakeProcess = createFakeProcess();
    await run(["status", "--project-root", "/a", "--project-root", "/b"], {
      process: fakeProcess,
      loadProjectEnv: false,
    });
    assertUsageError(fakeProcess);
    expect(fakeProcess.stderrText()).toContain("--project-root");
  });
});

describe("scanner compatibility: unknown flag", () => {
  it("rejects an unrecognized flag with exit 2, stderr only", async () => {
    const fakeProcess = createFakeProcess();
    await run(["status", "--not-a-real-flag", "value"], {
      process: fakeProcess,
      loadProjectEnv: false,
    });
    assertUsageError(fakeProcess);
    expect(fakeProcess.stderrText()).toContain("--not-a-real-flag");
  });
});

describe("scanner compatibility: unknown route", () => {
  it("an unrecognized token under a route map (not the root) is a real 'unknown command'", async () => {
    // Unlike the root (which has `defaultCommand: "dashboard"` and so never reports
    // "unknown command" -- see golden-baseline.test.ts), `contract` has no default
    // command, so an unrecognized subroute here does hit Stricli's native
    // `UnknownCommand` scanner path.
    const fakeProcess = createFakeProcess();
    await run(["contract", "not-a-real-subroute"], {
      process: fakeProcess,
      loadProjectEnv: false,
    });
    assertUsageError(fakeProcess);
    expect(fakeProcess.stderrText()).toContain("not-a-real-subroute");
  });
});

describe("scanner compatibility: missing required flag value", () => {
  it("rejects a required flag with no value, exit 2, stderr only", async () => {
    const fakeProcess = createFakeProcess();
    await run(["done-gate"], { process: fakeProcess, loadProjectEnv: false });
    assertUsageError(fakeProcess);
    expect(fakeProcess.stderrText()).toContain("--artifact");
  });
});

describe("scanner compatibility: a value beginning with '-'", () => {
  it("accepts a flag value that itself starts with a hyphen when explicitly assigned", async () => {
    const fakeProcess = createFakeProcess();
    // `--project-root=-weird-path` (assignment form) unambiguously binds the value to
    // the flag, so the scanner does not mistake `-weird-path` for another flag.
    await run(["status", "--project-root=-weird-path"], {
      process: fakeProcess,
      loadProjectEnv: false,
    });
    // Reaching the command body (rather than a scanner error) is what proves the value
    // was accepted as `--project-root`'s argument; `status` succeeding end-to-end confirms it.
    expect(fakeProcess.stderrText()).toBe("");
    const parsed = JSON.parse(fakeProcess.stdoutText()) as { projectRoot: string };
    expect(parsed.projectRoot.endsWith("-weird-path")).toBe(true);
  });
});

describe("scanner compatibility: `--` argument termination", () => {
  it("a bare `--` with nothing to consume it is an excess-argument scanner error, exit 2", async () => {
    const fakeProcess = createFakeProcess();
    await run(["status", "--", "--project-root"], { process: fakeProcess, loadProjectEnv: false });
    assertUsageError(fakeProcess);
    expect(fakeProcess.stderrText()).toContain('"--"');
  });
});

describe("scanner compatibility: aliases", () => {
  it("`fetch-gold` and `diff` route without an 'unknown command' scanner error", async () => {
    for (const alias of ["fetch-gold", "diff"]) {
      const fakeProcess = createFakeProcess();
      await run([alias, "--help"], { process: fakeProcess, loadProjectEnv: false });
      expect(fakeProcess.exitCode).toBe(0);
      expect(fakeProcess.stdoutText()).toContain("USAGE");
    }
  });
});

describe("scanner compatibility: nested-route defaults", () => {
  it("root default command (`dashboard`) is reached with zero args, not an 'unknown command' error", async () => {
    const fakeProcess = createFakeProcess();
    // `dashboard` is a real, long-running command as of Phase 9 -- an invalid `--port`
    // fails fast via its own Zod validation instead of starting a server, which is
    // enough to prove routing (not "unknown command" fallback) handled the empty argv.
    await run(["--port", "-1"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.stderrText()).not.toContain("No command registered");
    expect(fakeProcess.stderrText().toLowerCase()).toContain("port");
    expect(fakeProcess.exitCode).toBe(2);
  });

  it("`contract`/`baseline` route maps with no `defaultCommand` print their own help instead", async () => {
    for (const routeMap of ["contract", "baseline"]) {
      const fakeProcess = createFakeProcess();
      await run([routeMap], { process: fakeProcess, loadProjectEnv: false });
      expect(fakeProcess.exitCode).toBe(0);
      expect(fakeProcess.stdoutText()).toContain("USAGE");
    }
  });
});
