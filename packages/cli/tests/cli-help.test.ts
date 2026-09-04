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

/**
 * Phase 2 update (Stricli application shell): wording/stream assertions below are
 * updated to Stricli's actual, live-verified diagnostics -- see golden-baseline.test.ts's
 * header comment for the general rule (scanner-level behavior updated in place, stub-
 * dependent behavior `.skip`ped with a `TODO(Phase N)`).
 */
describe("published CLI", () => {
  it("prints help successfully through the package bin", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), "--help"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    // Documented stream change: Stricli's `help` integration writes to stdout (verified
    // live), not stderr -- see golden-baseline.test.ts's `--version` fixture for the
    // same, related change.
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("framelia contract create");
    expect(result.stdout).not.toContain("mcp");
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
      'Expected "audit" to be one of (page|component/strict|component/dev)',
    ],
    ["schema", ["--target", "request"], 'Expected "request" to be one of (contract|artifact)'],
  ])("rejects invalid %s enum flags at usage boundary", (command, args, expectedMessage) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), command, ...args],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(expectedMessage);
  });

  // Documented wording change from Commander's messages below; Stricli does not echo a
  // full usage banner alongside a scanner error (see golden-baseline.test.ts's alias-route
  // fixture for the same point), so these no longer assert a trailing "Usage:" line.
  // Exit code (2) and stderr-only routing are unchanged, verified live for every case.
  it.each([
    [
      "unknown option",
      ["status", "--project-rooot", packageRoot],
      "No flag registered for --project-rooot",
    ],
    ["missing required option", ["done-gate"], "Expected input for flag --artifact"],
    [
      "missing option value",
      ["status", "--project-root"],
      "Expected input for flag --project-root",
    ],
    [
      "duplicate option",
      ["status", "--project-root", packageRoot, "--project-root", packageRoot],
      "Too many arguments for --project-root",
    ],
    ["extra argument", ["status", "unexpected"], "Too many arguments, expected 0"],
  ])("rejects unsafe CLI input: %s", (_label, args, message) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "framelia.js"), ...args],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });
});
