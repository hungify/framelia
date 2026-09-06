import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageError } from "../src/exit.ts";
import { initializeProject, projectInitCommand } from "../src/internal/project-init.ts";
import { nonInteractivePrompts } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

function captureThrown(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

function tempProjectRoot(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-project-init-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

describe("initializeProject (scaffold step)", () => {
  it("creates config without enabling auth globally", () => {
    const projectRoot = tempProjectRoot();

    const result = initializeProject(projectRoot);
    const config = fs.readFileSync(result.configPath, "utf8");

    expect(config).toContain('// storageStatePath: ".framelia/auth/user.json"');
    expect(config).toContain('// envFile: ".env.e2e"');
    expect(config).toContain("// stabilitySamples: 3");
    expect(config).toContain("// timeoutMs: 60_000");
    expect(config).toContain("// devtoolsSelector: true");
    expect(config).toContain("// deviceScaleFactor: 1");
    expect(config).toContain('// fontPolicy: "required"');
    expect(config).toContain('// animationPolicy: "freeze"');
    expect(config).toContain("// retry: { attempts: 2, delayMs: 1_000 }");
    expect(config).toContain("// maxMaskedAreaRatio: 0.15");
    expect(fs.readFileSync(result.authGitignorePath, "utf8")).toBe("*\n!.gitignore\n");
    expect(fs.existsSync(result.authStatePath)).toBe(false);
  });

  it("refuses accidental config overwrite with an ordinary Error, not UsageError", () => {
    const projectRoot = tempProjectRoot();
    initializeProject(projectRoot);

    expect(() => initializeProject(projectRoot)).toThrow("Refusing to overwrite existing file");
    const overwriteError = captureThrown(() => initializeProject(projectRoot));
    expect(overwriteError).not.toBeInstanceOf(UsageError);
    expect(overwriteError).toBeInstanceOf(Error);
    expect(() => initializeProject(projectRoot, true)).not.toThrow();
  });

  it("does not create a second config format", () => {
    const projectRoot = tempProjectRoot();
    const configPath = path.join(projectRoot, "framelia.config.mjs");
    fs.writeFileSync(configPath, "export default {};\n");

    expect(() => initializeProject(projectRoot)).toThrow("Refusing to overwrite existing file");
    expect(initializeProject(projectRoot, true).configPath).toBe(configPath);
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(false);
  });
});

describe("projectInitCommand (CLI adapter)", () => {
  it("resolves projectRoot from the explicit option over the injected runtime's cwd", async () => {
    const projectRoot = tempProjectRoot();
    await projectInitCommand(
      { projectRoot, force: undefined },
      nonInteractivePrompts,
      fakeRuntime({ cwd: () => "/should-not-be-used" }),
    );
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(true);
  });

  it("falls back to the injected runtime's cwd when --project-root is not given", async () => {
    const projectRoot = tempProjectRoot();
    await projectInitCommand(
      { projectRoot: undefined, force: undefined },
      nonInteractivePrompts,
      fakeRuntime({ cwd: () => projectRoot }),
    );
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(true);
  });

  it("reclassifies overwrite refusal as UsageError at the CLI adapter boundary", async () => {
    const projectRoot = tempProjectRoot();
    await projectInitCommand(
      { projectRoot, force: undefined },
      nonInteractivePrompts,
      fakeRuntime(),
    );

    await expect(
      projectInitCommand({ projectRoot, force: undefined }, nonInteractivePrompts, fakeRuntime()),
    ).rejects.toBeInstanceOf(UsageError);
    await expect(
      projectInitCommand({ projectRoot, force: undefined }, nonInteractivePrompts, fakeRuntime()),
    ).rejects.toThrow("Refusing to overwrite existing file");
  });

  it("does not throw when --force is set on an existing config", async () => {
    const projectRoot = tempProjectRoot();
    await projectInitCommand(
      { projectRoot, force: undefined },
      nonInteractivePrompts,
      fakeRuntime(),
    );
    await expect(
      projectInitCommand({ projectRoot, force: true }, nonInteractivePrompts, fakeRuntime()),
    ).resolves.toBeUndefined();
  });
});
