import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const HEAVY_PACKAGES = [
  "playwright",
  "@playwright/test",
  "@framelia/dashboard-server",
  "@clack/prompts",
];

/**
 * Only entries proven weightless may be imported at startup. `.../constants`
 * is a standalone module with zero imports (pinned by that package's own
 * public-api test), so importing it never pulls Hono/dashboard-server code in.
 */
const WEIGHTLESS_ENTRIES = new Set(["@framelia/dashboard-server/constants"]);

/**
 * Every module specifier a file pulls in at load time: `from` clauses (import
 * and re-export alike), bare side-effect imports, and `require()`. `import()`
 * is deliberately absent -- deferring heavy modules to a lazy loader is exactly
 * what these tests are protecting.
 */
function staticImportSpecifiers(content: string): string[] {
  const patterns = [
    /^[ \t]*(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']/gm,
    /^[ \t]*import\s+["']([^"']+)["']/gm,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => match[1]).filter((s) => s !== undefined),
  );
}

function heavyEntry(specifier: string): string | undefined {
  if (WEIGHTLESS_ENTRIES.has(specifier)) return undefined;
  return HEAVY_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`))
    ? specifier
    : undefined;
}

function importsCommandsModule(specifier: string): boolean {
  return specifier.startsWith(".") && /(?:^|\/)commands\//.test(specifier);
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
      .map((file) => ({ file, specifiers: staticImportSpecifiers(fs.readFileSync(file, "utf8")) }))
      .filter(({ specifiers }) => specifiers.includes("@stricli/core"))
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
      .map((file) => ({ file, specifiers: staticImportSpecifiers(fs.readFileSync(file, "utf8")) }))
      .filter(({ specifiers }) => specifiers.some(importsCommandsModule))
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

    const offenders = files.flatMap((file) =>
      staticImportSpecifiers(fs.readFileSync(file, "utf8"))
        .map(heavyEntry)
        .filter((specifier) => specifier !== undefined)
        .map((specifier) => `${path.relative(srcRoot, file)} statically imports "${specifier}"`),
    );

    expect(
      offenders,
      `commands/*.ts must not statically import heavy runtime packages: ${offenders.join("; ")}`,
    ).toEqual([]);
  });
});
