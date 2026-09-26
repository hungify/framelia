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

  it("creates a minimal reporter config, then treats it as an existing config on a later run", () => {
    const projectRoot = tempProjectRoot();

    const first = initializeProject(projectRoot);
    const source = fs.readFileSync(first.playwrightConfigPath, "utf8");
    expect(first.reporterRegistration).toBe("configured");
    expect(source).toContain('["@framelia/playwright/reporter"]');
    expect(source).toContain('["list"]');

    const second = initializeProject(projectRoot, true);
    expect(second.reporterRegistration).toBe("manual");
    expect(second.reporterInstructions).toMatch(/verify.*add.*preserv/iu);
    expect(fs.readFileSync(second.playwrightConfigPath, "utf8")).toBe(source);
  });

  it.each(["playwright.config.mjs", "playwright.config.cjs", "playwright.config.ts"])(
    "leaves an existing %s byte-for-byte untouched and returns a manual recipe",
    (fileName) => {
      const projectRoot = tempProjectRoot();
      const playwrightConfigPath = path.join(projectRoot, fileName);
      const source = "module.exports = { reporter: [['line']] }; // preserve me\n";
      fs.writeFileSync(playwrightConfigPath, source);

      const result = initializeProject(projectRoot);

      expect(result.reporterRegistration).toBe("manual");
      expect(result.reporterInstructions).toContain("@framelia/playwright/reporter");
      expect(fs.readFileSync(playwrightConfigPath, "utf8")).toBe(source);
    },
  );

  it("leaves an already-configured Playwright reporter list byte-for-byte untouched and requests manual verification", () => {
    const projectRoot = tempProjectRoot();
    const playwrightConfigPath = path.join(projectRoot, "playwright.config.js");
    const source = "export default { reporter: [['line'], ['@framelia/playwright/reporter']] };\n";
    fs.writeFileSync(playwrightConfigPath, source);

    const result = initializeProject(projectRoot);

    expect(result.reporterRegistration).toBe("manual");
    expect(result.reporterInstructions).toMatch(/verify.*add.*preserv/iu);
    expect(fs.readFileSync(playwrightConfigPath, "utf8")).toBe(source);
  });

  it("does not mistake a Framelia reporter in an unrelated object for configured Playwright", () => {
    const projectRoot = tempProjectRoot();
    const playwrightConfigPath = path.join(projectRoot, "playwright.config.ts");
    const source = [
      'const unrelated = { reporter: [["@framelia/playwright/reporter"]] };',
      'export default { reporter: [["line"]] };',
      "",
    ].join("\n");
    fs.writeFileSync(playwrightConfigPath, source);

    const result = initializeProject(projectRoot);

    expect(result.reporterRegistration).toBe("manual");
    expect(result.reporterInstructions).toMatch(/verify.*add.*preserv/iu);
    expect(fs.readFileSync(playwrightConfigPath, "utf8")).toBe(source);
  });

  it("does not mistake comments, dead strings, or unrelated imports for reporter registration", () => {
    const projectRoot = tempProjectRoot();
    const playwrightConfigPath = path.join(projectRoot, "playwright.config.ts");
    const source = [
      'import reporterPackage from "@framelia/playwright/reporter";',
      '// reporter: [["@framelia/playwright/reporter"]],',
      'const note = "@framelia/playwright/reporter";',
      'export default { reporter: [["line", { outputFile: "@framelia/playwright/reporter" }]] };',
      "",
    ].join("\n");
    fs.writeFileSync(playwrightConfigPath, source);

    const first = initializeProject(projectRoot);
    const second = initializeProject(projectRoot, true);

    expect(first.reporterRegistration).toBe("manual");
    expect(second.reporterRegistration).toBe("manual");
    expect(second.reporterInstructions).toBe(first.reporterInstructions);
    expect(fs.readFileSync(playwrightConfigPath, "utf8")).toBe(source);
  });

  it("rejects multiple Playwright config files without rewriting either one", () => {
    const projectRoot = tempProjectRoot();
    const first = path.join(projectRoot, "playwright.config.ts");
    const second = path.join(projectRoot, "playwright.config.mjs");
    fs.writeFileSync(first, "export default {};\n");
    fs.writeFileSync(second, "export default {};\n");

    expect(() => initializeProject(projectRoot)).toThrow(/Multiple Playwright configs found/);
    expect(fs.readFileSync(first, "utf8")).toBe("export default {};\n");
    expect(fs.readFileSync(second, "utf8")).toBe("export default {};\n");
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
