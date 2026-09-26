import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  initializeProject,
  planProjectInitialization,
  projectInitCommand,
} from "../src/internal/project-init.ts";
import { nonInteractivePrompts } from "../src/internal/prompts.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const roots: string[] = [];

function temporaryProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-init-workflow-"));
  roots.push(root);
  return root;
}

function runtime(root: string): CliRuntime {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.resume();
  stderr.resume();
  return {
    cwd: () => root,
    env: {},
    stdin: new PassThrough(),
    stdout,
    stderr,
    exitCode: undefined,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project initialization workflow", () => {
  it("dry-runs a complete plan without mutating the project", async () => {
    const root = temporaryProject();
    const result = await projectInitCommand(
      { projectRoot: root, dryRun: true, force: undefined },
      nonInteractivePrompts,
      runtime(root),
    );

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      body: {
        kind: "framelia.init-outcome",
        command: "init",
        executionState: "completed",
        dryRun: true,
        reporter: { status: "configured", configPath: "playwright.config.ts" },
        changes: expect.arrayContaining([
          expect.objectContaining({ path: "framelia.config.ts", action: "create" }),
          expect.objectContaining({ path: "playwright.config.ts", action: "create" }),
          expect.objectContaining({ path: ".framelia/auth/.gitignore", action: "create" }),
        ]),
      },
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("creates minimal Framelia and Playwright policy without editing package metadata", async () => {
    const root = temporaryProject();
    const packageJson = `${JSON.stringify({ type: "commonjs", scripts: { test: "custom-test" } }, null, 2)}\n`;
    fs.writeFileSync(path.join(root, "package.json"), packageJson);

    const result = await projectInitCommand(
      { projectRoot: root, dryRun: false, force: undefined },
      nonInteractivePrompts,
      runtime(root),
    );

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(packageJson);
    expect(fs.readFileSync(path.join(root, "framelia.config.ts"), "utf8")).toContain(
      'contracts: [".framelia/contracts/**/visual-contract.json"]',
    );
    expect(fs.readFileSync(path.join(root, "framelia.config.ts"), "utf8")).toContain(
      'playwright: { config: "playwright.config.ts", projects: [""] }',
    );
    expect(fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8")).toContain(
      '["@framelia/playwright/reporter"]',
    );
    expect(fs.readFileSync(path.join(root, ".framelia/auth/.gitignore"), "utf8")).toBe(
      "*\n!.gitignore\n",
    );
  });

  it("preserves an existing Playwright config byte-for-byte and gives precise manual instructions", async () => {
    const root = temporaryProject();
    const playwright = `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n  projects: [{ name: "webkit", use: { colorScheme: "dark" } }],\n  webServer: { command: "pnpm dev", port: 4173 },\n});\n`;
    fs.writeFileSync(path.join(root, "playwright.config.mts"), playwright);

    const result = await projectInitCommand(
      { projectRoot: root, dryRun: false, force: undefined },
      nonInteractivePrompts,
      runtime(root),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      body: {
        reporter: {
          status: "manual",
          configPath: "playwright.config.mts",
          instructions: expect.stringContaining("remains byte-for-byte unchanged"),
        },
        changes: expect.arrayContaining([
          expect.objectContaining({ path: "playwright.config.mts", action: "manual" }),
        ]),
      },
    });
    expect(result.body.reporter?.instructions).toContain("do not replace, reorder, or change");
    expect(fs.readFileSync(path.join(root, "playwright.config.mts"), "utf8")).toBe(playwright);
    expect(fs.readFileSync(path.join(root, "framelia.config.ts"), "utf8")).not.toContain(
      "playwright:",
    );
  });

  it("is idempotent and treats force as a non-destructive compatibility flag", () => {
    const root = temporaryProject();
    initializeProject(root);
    const before = new Map(
      ["framelia.config.ts", "playwright.config.ts", ".framelia/auth/.gitignore"].map(
        (file) => [file, fs.readFileSync(path.join(root, file))] as const,
      ),
    );

    const repeated = initializeProject(root, true);
    for (const [file, bytes] of before) {
      expect(fs.readFileSync(path.join(root, file))).toEqual(bytes);
    }
    expect(repeated.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "framelia.config.ts", action: "unchanged" }),
        expect.objectContaining({ path: "playwright.config.ts", action: "manual" }),
        expect.objectContaining({ path: ".framelia/auth/.gitignore", action: "unchanged" }),
      ]),
    );
  });

  it("refuses ambiguous Framelia or Playwright configuration without writing anything", async () => {
    const root = temporaryProject();
    fs.writeFileSync(path.join(root, "framelia.config.ts"), "export default {};\n");
    fs.writeFileSync(path.join(root, "framelia.config.mjs"), "export default {};\n");
    const result = await projectInitCommand(
      { projectRoot: root, dryRun: false, force: true },
      nonInteractivePrompts,
      runtime(root),
    );
    expect(result).toMatchObject({
      exitCode: 2,
      body: { executionState: "error", diagnostics: [{ code: "INIT_FAILED" }] },
    });
    expect(fs.existsSync(path.join(root, ".framelia"))).toBe(false);

    const other = temporaryProject();
    fs.writeFileSync(path.join(other, "playwright.config.ts"), "export default {};\n");
    fs.writeFileSync(path.join(other, "playwright.config.mjs"), "export default {};\n");
    expect(() => planProjectInitialization(other)).toThrow(/Multiple Playwright configs/);
    expect(fs.readdirSync(other).toSorted()).toEqual([
      "playwright.config.mjs",
      "playwright.config.ts",
    ]);
  });
});
