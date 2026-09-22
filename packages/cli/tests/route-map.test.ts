import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { AUTHORITY_AUDIENCE_ENV, PROTECTED_JOB_IDENTITY_ENV } from "../src/cli-constants.ts";
import { run } from "../src/cli.ts";
import { createFakeProcess } from "./fake-process.ts";

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

describe("done-gate protected environment", () => {
  it("does not load job identity or audience from a checkout-controlled .env", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-done-gate-env-"));
    try {
      fs.writeFileSync(
        path.join(root, ".env"),
        `${PROTECTED_JOB_IDENTITY_ENV}=checkout-job\n${AUTHORITY_AUDIENCE_ENV}=checkout-audience\n`,
      );
      const fakeProcess = createFakeProcess();
      const runtime = { ...fakeProcess, cwd: () => root };

      await run(["done-gate"], { process: runtime });

      expect(fakeProcess.env[PROTECTED_JOB_IDENTITY_ENV]).toBeUndefined();
      expect(fakeProcess.env[AUTHORITY_AUDIENCE_ENV]).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
      expect(aliasProcess.stdoutText()).toContain(`framelia ${canonical}`);
      expect(canonicalProcess.stdoutText()).toContain(`framelia ${alias}`);
      expect(flagsOf(aliasProcess.stdoutText())).toEqual(flagsOf(canonicalProcess.stdoutText()));
    },
  );
});

describe("route map: default command", () => {
  it("bare invocation routes to `dashboard`, not an 'unknown command' error", async () => {
    const fakeProcess = createFakeProcess();
    await run(["--port", "-1"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(2);
    expect(fakeProcess.stderrText()).not.toContain("No command registered");
    expect(fakeProcess.stderrText()).toContain("--run");
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

  it.each(["--version", "-V"])(
    "`%s` prints the current version to stdout with exit 0",
    async (flag) => {
      const fakeProcess = createFakeProcess();
      await run([flag], { process: fakeProcess, loadProjectEnv: false });
      expect(fakeProcess.exitCode).toBe(0);
      expect(fakeProcess.stderrText()).toBe("");
      expect(fakeProcess.stdoutText().trim()).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );

  it("does not accept Stricli's default -v alias for --version (uses -V instead, per the plan)", async () => {
    const fakeProcess = createFakeProcess();
    await run(["-v"], { process: fakeProcess, loadProjectEnv: false });
    expect(fakeProcess.exitCode).toBe(2);
    expect(fakeProcess.stdoutText()).not.toMatch(/^\d+\.\d+\.\d+$/);
  });
});
