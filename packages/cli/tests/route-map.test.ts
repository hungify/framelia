import { describe, expect, it } from "vitest";

import { run } from "../src/cli.ts";
import { createFakeProcess } from "./fake-process.ts";

/**
 * Route map structure, aliases, default command, and --help/--version -- the "genuinely
 * requires the whole assembled Application" layer (see the rewrite plan's Architecture
 * §4 layered test strategy). Business logic is never asserted here; see each command's
 * own `tests/*.test.ts` (added in its implementation phase) for that.
 *
 * Runs through the exported `run(argv, { process })` seam (never a subprocess spawn), so
 * assertions read captured bytes/exit code without mutating the real process.
 */
function flagsOf(text: string): string[] {
  return [...text.matchAll(/--[a-z-]+/g)].map((m) => m[0]).toSorted();
}

describe("route map: root routes are reachable", () => {
  it.each([
    "dashboard",
    "open",
    "report",
    "done-gate",
    "status",
    "schema",
    "init",
    "auth",
    "contract",
    "baseline",
    "capture",
    "compare",
  ])("`%s` resolves to a route (not 'unknown command')", async (route) => {
    const fakeProcess = createFakeProcess();
    await run([route, "--help"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(0);
    expect(fakeProcess.stdoutText()).toContain("USAGE");
  });
});

describe("route map: nested routes", () => {
  it.each([
    ["contract", "create"],
    ["contract", "suggest-masks"],
    ["baseline", "promote"],
  ])("`%s %s` resolves to a route (not 'unknown command')", async (route, subroute) => {
    const fakeProcess = createFakeProcess();
    await run([route, subroute, "--help"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(0);
    expect(fakeProcess.stdoutText()).toContain("USAGE");
  });
});

describe("route map: root aliases", () => {
  it.each([
    ["fetch-gold", "capture"],
    ["diff", "compare"],
  ])(
    "`%s` resolves to the same command as `%s` (not a separate/unknown route)",
    async (alias, canonical) => {
      const aliasProcess = createFakeProcess();
      const canonicalProcess = createFakeProcess();
      await run([alias, "--help"], { process: aliasProcess, loadProjectEnv: false });
      await run([canonical, "--help"], { process: canonicalProcess, loadProjectEnv: false });
      expect(aliasProcess.exitCode).toBe(0);
      // Help text for an aliased invocation echoes the invoked name, not the canonical
      // one -- Stricli's own behavior, and consistent with today's Commander CLI. What
      // matters for "same route" is that both share the same flag surface and each
      // cross-references the other as its alias.
      expect(aliasProcess.stdoutText()).toContain(`framelia ${canonical}`);
      expect(canonicalProcess.stdoutText()).toContain(`framelia ${alias}`);
      expect(flagsOf(aliasProcess.stdoutText())).toEqual(flagsOf(canonicalProcess.stdoutText()));
    },
  );
});

describe("route map: default command", () => {
  it("bare invocation routes to `dashboard`, not an 'unknown command' error", async () => {
    const fakeProcess = createFakeProcess();
    // `dashboard` is a real, long-running command as of Phase 9 -- an invalid `--port`
    // makes its own Zod validation fail fast (a `UsageError` mentioning "port") instead
    // of actually starting a server, which is enough to prove routing reached the
    // dashboard command body rather than falling through to "unknown command".
    await run(["--port", "-1"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(2);
    expect(fakeProcess.stderrText()).not.toContain("No command registered");
    expect(fakeProcess.stderrText().toLowerCase()).toContain("port");
  });
});

describe("route map: --help and --version", () => {
  it("--help lists every top-level route, sibling dashboard commands, and nested route maps", async () => {
    const fakeProcess = createFakeProcess();
    await run(["--help"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(0);
    const stdout = fakeProcess.stdoutText();
    for (const route of [
      "dashboard",
      "open",
      "report",
      "done-gate",
      "status",
      "schema",
      "init",
      "auth",
      "contract",
      "baseline",
      "capture",
      "compare",
    ]) {
      expect(stdout).toContain(route);
    }
  });

  it("--version and -V print the same current version to stdout with exit 0", async () => {
    for (const flag of ["--version", "-V"]) {
      const fakeProcess = createFakeProcess();
      await run([flag], { process: fakeProcess, loadProjectEnv: false });
      expect(fakeProcess.exitCode).toBe(0);
      expect(fakeProcess.stderrText()).toBe("");
      expect(fakeProcess.stdoutText().trim()).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("does not accept Stricli's default -v alias for --version (uses -V instead, per the plan)", async () => {
    const fakeProcess = createFakeProcess();
    await run(["-v"], { process: fakeProcess, loadProjectEnv: false });
    // -v is unrecognized -- it should NOT print a version, and should fail as a usage error.
    expect(fakeProcess.exitCode).toBe(2);
    expect(fakeProcess.stdoutText()).not.toMatch(/^\d+\.\d+\.\d+$/);
  });
});
