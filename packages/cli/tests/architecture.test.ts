import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Static, no-execution check for the rewrite plan's Architecture §2 dependency-direction
 * rule -- a small purpose-built check instead of a lint plugin, per the plan's explicit
 * preference (~10 lines, no new tooling). Uses an import-STATEMENT regex, not a bare
 * substring, so a doc comment merely mentioning "@stricli/core" (as `runtime-types.ts`/
 * `dashboard-types.ts` do) doesn't false-positive -- see Phase 1's fork report.
 */

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

// Matches `import ... from "@stricli/core"`, `import "@stricli/core"`,
// `export ... from "@stricli/core"`, and `require("@stricli/core")` -- not a bare
// substring match, so comments/prose mentioning the package name don't trigger it.
const STRICLI_IMPORT_PATTERN =
  /\b(?:import|export)\b[^;]*\bfrom\s*["']@stricli\/core["']|require\(\s*["']@stricli\/core["']\s*\)/;

// Matches a relative import/require reaching into `../commands/` (or deeper, e.g.
// `../../commands/`) from anywhere under `src/internal/`.
const COMMANDS_IMPORT_PATTERN =
  /\b(?:import|export)\b[^;]*\bfrom\s*["'](?:\.\.\/)+commands\/[^"']*["']|require\(\s*["'](?:\.\.\/)+commands\/[^"']*["']\s*\)/;

// Static (non-lazy) imports of these in a `commands/*.ts` declaration file would defeat
// Architecture §1's lazy-loading -- same heavy-package list `chunk-graph.test.ts` uses.
const HEAVY_PACKAGES = [
  "playwright",
  "@playwright/test",
  "@framelia/dashboard-server",
  "@clack/prompts",
];

function heavyStaticImportPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*import\\b[^;]*\\bfrom\\s*["']${escaped}["']`, "m");
}

function listFilesRecursively(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursively(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

describe("architecture: dependency direction", () => {
  it("no file under src/internal/ imports @stricli/core", () => {
    const internalDir = path.join(srcRoot, "internal");
    const files = listFilesRecursively(internalDir);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .map((file) => ({ file, content: fs.readFileSync(file, "utf8") }))
      .filter(({ content }) => STRICLI_IMPORT_PATTERN.test(content))
      .map(({ file }) => path.relative(srcRoot, file));

    expect(
      offenders,
      `internal/*.ts must never import @stricli/core: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no file under src/internal/ imports from src/commands/", () => {
    const internalDir = path.join(srcRoot, "internal");
    const files = listFilesRecursively(internalDir);

    const offenders = files
      .map((file) => ({ file, content: fs.readFileSync(file, "utf8") }))
      .filter(({ content }) => COMMANDS_IMPORT_PATTERN.test(content))
      .map(({ file }) => path.relative(srcRoot, file));

    expect(
      offenders,
      `internal/*.ts must never import from ../commands/: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no commands/*.ts file statically imports a heavy dashboard/Playwright/prompts module", () => {
    const commandsDir = path.join(srcRoot, "commands");
    const files = fs
      .readdirSync(commandsDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.join(commandsDir, name));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const pkg of HEAVY_PACKAGES) {
        if (heavyStaticImportPattern(pkg).test(content)) {
          offenders.push(`${path.relative(srcRoot, file)} statically imports "${pkg}"`);
        }
      }
    }

    expect(
      offenders,
      `commands/*.ts must not statically import heavy runtime packages: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});
