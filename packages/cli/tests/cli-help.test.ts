import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = (
  JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;
describe("published CLI", () => {
  it("prints help successfully through the package bin", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), "--help"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("framelia contract create");
    expect(result.stderr).not.toContain("mcp");
  });

  it("reports CLI mode without requiring Figma access", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), "status", "--project-root", packageRoot],
      { encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: "framelia",
      version: packageVersion,
      mode: "cli",
      projectRoot: packageRoot,
      baselineKinds: ["figma"],
      figmaTokenAvailable: false,
    });
  });

  it.each([
    ["contract", [], ["schemaVersion", "target", "contracts"]],
    ["artifact", ["--target", "artifact"], ["schemaVersion", "kind", "request", "results"]],
  ])("prints the live %s JSON Schema", (_target, args, expectedProperties) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), "schema", ...args],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const schema = JSON.parse(result.stdout) as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(expectedProperties),
    );
  });

  it.each([
    [
      "compare",
      ["--baseline", "missing.png", "--actual", "missing.png", "--profile", "audit"],
      undefined,
    ],
    ["schema", ["--target", "request"], undefined],
  ])("rejects invalid %s enum flags at usage boundary", (command, args, expectedMessage) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), command, ...args],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(expectedMessage ?? "Usage:");
    expect(result.stderr).toContain("Usage:");
  });

  it.each([
    [
      "unknown option",
      ["status", "--project-rooot", packageRoot],
      "unknown option '--project-rooot'",
    ],
    ["missing required option", ["done-gate"], "required option '--artifact <path>' not specified"],
    [
      "missing option value",
      ["status", "--project-root"],
      "option '--project-root <dir>' argument missing",
    ],
    [
      "duplicate option",
      ["status", "--project-root", packageRoot, "--project-root", packageRoot],
      "used more than once",
    ],
    ["extra argument", ["status", "unexpected"], "too many arguments"],
  ])("rejects unsafe CLI input: %s", (_label, args, message) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), ...args],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("Usage:");
  });
});
