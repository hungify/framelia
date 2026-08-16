import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeProject } from "../src/init.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("project init", () => {
  it("creates config without enabling auth globally", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-project-init-"));
    temporaryDirectories.push(projectRoot);

    const result = initializeProject(projectRoot);
    const config = fs.readFileSync(result.configPath, "utf8");

    expect(config).toContain('// storageStatePath: ".framelia/auth/user.json"');
    expect(config).toContain('// envFile: ".env.playwright"');
    expect(fs.readFileSync(result.authGitignorePath, "utf8")).toBe("*\n!.gitignore\n");
    expect(fs.existsSync(result.authStatePath)).toBe(false);
  });

  it("refuses accidental config overwrite", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-project-init-"));
    temporaryDirectories.push(projectRoot);
    initializeProject(projectRoot);

    expect(() => initializeProject(projectRoot)).toThrow("Refusing to overwrite existing file");
    expect(() => initializeProject(projectRoot, true)).not.toThrow();
  });

  it("does not create a second config format", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-project-init-"));
    temporaryDirectories.push(projectRoot);
    const configPath = path.join(projectRoot, "framelia.config.mjs");
    fs.writeFileSync(configPath, "export default {};\n");

    expect(() => initializeProject(projectRoot)).toThrow("Refusing to overwrite existing file");
    expect(initializeProject(projectRoot, true).configPath).toBe(configPath);
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(false);
  });
});
