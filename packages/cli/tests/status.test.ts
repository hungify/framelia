import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { statusCommand } from "../src/internal/status.ts";
import type { CliRuntime } from "../src/runtime-types.ts";
import { testEnvironment } from "./test-environment.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(config?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-status-"));
  roots.push(root);
  if (config !== undefined) fs.writeFileSync(path.join(root, "framelia.config.mjs"), config);
  return root;
}

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

function checkOf(body: { checks: readonly { name: string }[] }, name: string) {
  return body.checks.find((check) => check.name === name);
}

describe("statusCommand", () => {
  it("returns the documented fields for a valid project, resolving the explicit root", async () => {
    const root = project("export default {};\n");
    const result = await statusCommand(
      { projectRoot: root },
      testEnvironment(fakeRuntime(), {}, { version: "1.2.3" }),
    );
    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      body: {
        ok: true,
        name: "framelia",
        version: "1.2.3",
        mode: "cli",
        baselineKinds: ["figma"],
        projectRoot: root,
        configPath: "framelia.config.mjs",
        figmaTokenAvailable: false,
        diagnostics: [],
      },
    });
    expect(checkOf(result.body, "config")).toMatchObject({ status: "ok" });
    expect(checkOf(result.body, "playwright")).toMatchObject({
      status: "warning",
      code: "PROJECT_POLICY_INCOMPLETE",
    });
    expect(checkOf(result.body, "figma-token")).toMatchObject({ status: "warning" });
  });

  it("loads the config: an invalid one fails status with its own code (exit 2)", async () => {
    const root = project("export default { totallyMadeUpOption: true };\n");
    const result = await statusCommand({ projectRoot: root }, testEnvironment(fakeRuntime()));
    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      body: { ok: false, diagnostics: [{ code: "INVALID_PROJECT_CONFIG", stage: "config" }] },
    });
  });

  it("reports an uninitialized project and points at init", async () => {
    const root = project();
    const result = await statusCommand({ projectRoot: root }, testEnvironment(fakeRuntime()));
    expect(result.exitCode).toBe(2);
    expect(result.body.next).toEqual({
      command: "framelia",
      argv: ["init", "--project-root", root],
    });
  });

  it("flags a configured Playwright whose CLI the project cannot resolve", async () => {
    const root = project(
      'export default { playwright: { config: "playwright.config.ts", projects: [""] } };\n',
    );
    fs.writeFileSync(path.join(root, "playwright.config.ts"), "export default {};\n");
    const result = await statusCommand({ projectRoot: root }, testEnvironment(fakeRuntime()));
    expect(checkOf(result.body, "playwright")).toMatchObject({ status: "ok" });
    expect(checkOf(result.body, "playwright-cli")).toMatchObject({
      status: "error",
      code: "PLAYWRIGHT_NOT_INSTALLED",
    });
    expect(result.exitCode).toBe(2);
  });

  it("falls back to the injected runtime's cwd when --project-root is not given", async () => {
    const root = project("export default {};\n");
    const result = await statusCommand(
      { projectRoot: undefined },
      testEnvironment(fakeRuntime({ cwd: () => root })),
    );
    expect(result.body.projectRoot).toBe(root);
  });

  it("derives figmaTokenAvailable from the injected runtime's env, never global process.env", async () => {
    const root = project("export default {};\n");
    const withToken = await statusCommand(
      { projectRoot: root },
      testEnvironment(fakeRuntime({ env: { FIGMA_ACCESS_TOKEN: "secret" } })),
    );
    expect(withToken.body.figmaTokenAvailable).toBe(true);
    expect(checkOf(withToken.body, "figma-token")).toMatchObject({ status: "ok" });

    const withoutToken = await statusCommand(
      { projectRoot: root },
      testEnvironment(fakeRuntime({ env: {} })),
    );
    expect(withoutToken.body.figmaTokenAvailable).toBe(false);
  });
});
