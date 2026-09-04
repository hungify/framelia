import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadFrameliaConfig } from "../src/config.ts";
import { UsageError } from "../src/exit.ts";
import { openProject } from "../src/internal/project.ts";
import { createFakeProcess } from "./fake-process.ts";
const temporaryDirectories: string[] = [];
const originalFrameliaTestEnv = process.env.FRAMELIA_TEST_ENV;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
  if (originalFrameliaTestEnv === undefined) delete process.env.FRAMELIA_TEST_ENV;
  else process.env.FRAMELIA_TEST_ENV = originalFrameliaTestEnv;
});

describe("framelia config boundary", () => {
  it("rejects screen-specific fields and points to visual contracts", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-boundary-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { route: '/login' };\n",
    );

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(
      "Put route, baseline, viewport, and state in a visual-contract.json file.",
    );
  });

  it("keeps shared config limited to environment and auth state", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-shared-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      'export default { envFile: ".env.e2e", storageStatePath: ".framelia/auth/user.json" };\n',
    );
    fs.writeFileSync(path.join(projectRoot, ".env.e2e"), "FRAMELIA_TEST_ENV=1\n");

    await expect(loadFrameliaConfig(projectRoot)).resolves.toMatchObject({
      envFile: ".env.e2e",
      storageStatePath: ".framelia/auth/user.json",
    });
  });

  it("accepts project-wide capture-tuning defaults", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-defaults-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { stabilitySamples: 3, timeoutMs: 15_000, deviceScaleFactor: 2 };\n",
    );

    await expect(loadFrameliaConfig(projectRoot)).resolves.toMatchObject({
      stabilitySamples: 3,
      timeoutMs: 15_000,
      deviceScaleFactor: 2,
    });
  });

  it("only lets maxMaskedAreaRatio lower the conservative default cap, never raise it", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-mask-cap-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { maxMaskedAreaRatio: 0.3 };\n",
    );

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(/too big|must be <|0\.15/i);
  });

  it("accepts a custom devtoolsSelector string", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-devtools-string-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { devtoolsSelector: '[data-vite-devtools]' };\n",
    );
    await expect(loadFrameliaConfig(projectRoot)).resolves.toMatchObject({
      devtoolsSelector: "[data-vite-devtools]",
    });
  });

  it("accepts devtoolsSelector: true to use the built-in default selector", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-devtools-bool-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { devtoolsSelector: true };\n",
    );
    await expect(loadFrameliaConfig(projectRoot)).resolves.toMatchObject({
      devtoolsSelector: true,
    });
  });

  it("rejects devtoolsSelector: false", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-devtools-false-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { devtoolsSelector: false };\n",
    );
    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(/devtoolsSelector/);
  });

  it("returns an empty config when no config file exists", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-none-"));
    temporaryDirectories.push(projectRoot);

    await expect(loadFrameliaConfig(projectRoot)).resolves.toEqual({});
  });

  it("rejects multiple config files as ambiguous", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-multiple-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");
    fs.writeFileSync(path.join(projectRoot, "framelia.config.js"), "export default {};\n");

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(
      "Multiple Framelia config files found",
    );
  });

  it("rejects a truly unknown (non-screen-specific) config key", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-unknown-key-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { totallyMadeUpOption: true };\n",
    );

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(
      "Unknown Framelia config option: totallyMadeUpOption.",
    );
  });

  it("rejects an envFile path that escapes the project root via parent traversal", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-unsafe-env-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      'export default { envFile: "../secret.env" };\n',
    );

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(
      "must be project-relative without parent traversal",
    );
  });

  it("rejects an absolute envFile path", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-absolute-env-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      'export default { envFile: "/etc/secret.env" };\n',
    );

    await expect(loadFrameliaConfig(projectRoot)).rejects.toThrow(
      "must be project-relative without parent traversal",
    );
  });
});

describe("Project config intake", () => {
  it("loads config lazily through the opened project", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-adapter-ok-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { stabilitySamples: 5 };\n",
    );

    await expect(openProject(projectRoot, createFakeProcess()).loadConfig()).resolves.toMatchObject(
      { stabilitySamples: 5 },
    );
  });

  it("reclassifies a config loading failure as UsageError, preserving the message", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-config-adapter-fail-"));
    temporaryDirectories.push(projectRoot);
    fs.writeFileSync(
      path.join(projectRoot, "framelia.config.mjs"),
      "export default { totallyMadeUpOption: true };\n",
    );

    expect(() => openProject(projectRoot, createFakeProcess())).not.toThrow();
    const project = openProject(projectRoot, createFakeProcess());

    await expect(project.loadConfig()).rejects.toBeInstanceOf(UsageError);
    await expect(project.loadConfig()).rejects.toThrow(
      "Unknown Framelia config option: totallyMadeUpOption.",
    );
  });
});
