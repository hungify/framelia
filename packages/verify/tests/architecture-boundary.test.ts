import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Owns every import-boundary invariant for this package in one place, using
 * the TypeScript compiler API to inspect real ImportDeclaration nodes -- a
 * source-level fact, not a string search, and independent of the
 * `verbatimModuleSyntax` tsconfig flag (which today happens to force a
 * type-only-looking import to actually behave as type-only, but a future
 * flag change wouldn't be caught by grepping for the word "type").
 *
 * Folds in the narrower rule scripts/check-domain-boundary.mjs used to
 * enforce on its own (capture/domain/** must never mention
 * @playwright/test), plus a new assertion that nothing under src/ imports
 * @framelia/cli, @framelia/dashboard-server, or @framelia/playwright --
 * already true today, now enforced rather than informal.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "../src");
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const PLAYWRIGHT_TEST = "@playwright/test";
const BANNED_CONSUMER_PACKAGES = [
  "@framelia/cli",
  "@framelia/dashboard-server",
  "@framelia/playwright",
];

interface ImportInfo {
  specifier: string;
  /** True only when *every* imported binding is erased at compile time --
   *  a whole-declaration `import type ...`, or a mixed named-import where
   *  every element carries its own `type` modifier. False for a namespace
   *  import, a default import, a side-effect-only import, or any named
   *  import with at least one non-type-only binding: all of those leave a
   *  real runtime module-resolution dependency on the imported specifier. */
  isTypeOnly: boolean;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (TS_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Collects both `import ... from "specifier"` and re-export
 * `export ... from "specifier"` declarations -- src/index.ts is a curated
 * barrel built almost entirely out of the latter (`export { x } from
 * "./file.ts"`), so building the reachable-from-index graph purely from
 * ImportDeclaration nodes would silently miss most of the real barrel and
 * make the "sanity check this test exercises the fragile spot" assertion
 * below pass for the wrong reason (nothing reachable, not everything clean).
 */
function parseImports(file: string): ImportInfo[] {
  const text = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: ImportInfo[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, isTypeOnly: isTypeOnlyImport(node) });
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({ specifier: node.moduleSpecifier.text, isTypeOnly: isTypeOnlyExport(node) });
    }
  });
  return imports;
}

/** See ImportInfo.isTypeOnly's doc comment for exactly what this decides. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // side-effect import: `import "specifier";`
  if (clause.isTypeOnly) return true; // `import type ... from "specifier";`
  if (clause.name) return false; // real default import
  const bindings = clause.namedBindings;
  if (!bindings) return true; // an empty import clause has nothing real to bind
  if (ts.isNamespaceImport(bindings)) return false; // `import * as ns from ...`
  return bindings.elements.every((element) => element.isTypeOnly);
}

/** Mirrors isTypeOnlyImport for `export ... from "specifier"` re-exports:
 *  `export type {...} from ...` (whole-declaration) or `export { type X }
 *  from ...` (per-element) are erased at compile time; anything else keeps
 *  a real runtime module-resolution dependency on the specifier. */
function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const bindings = node.exportClause;
  if (!bindings) return false; // bare `export * from "specifier"`
  if (ts.isNamespaceExport(bindings)) return false; // `export * as ns from ...`
  return bindings.elements.every((element) => element.isTypeOnly);
}

const allFiles = listTsFiles(SRC_ROOT);
const filesByAbsolutePath = new Map(allFiles.map((file) => [file, parseImports(file)]));

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return filesByAbsolutePath.has(resolved) ? resolved : null;
}

/** Every file transitively reachable from src/index.ts via relative imports
 *  -- the "safe root barrel" real external consumers (e.g. @framelia/
 *  playwright's matchers, @framelia/dashboard-server) import without
 *  expecting a real @playwright/test module-resolution dependency. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const imp of filesByAbsolutePath.get(current) ?? []) {
      const resolved = resolveRelativeImport(current, imp.specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

describe("architecture boundary", () => {
  it("never imports @playwright/test as a real (non-type-only) dependency from the safe root barrel (src/index.ts)", () => {
    const reachable = reachableFrom(path.join(SRC_ROOT, "index.ts"));
    const violations: string[] = [];
    for (const file of reachable) {
      for (const imp of filesByAbsolutePath.get(file) ?? []) {
        if (imp.specifier === PLAYWRIGHT_TEST && !imp.isTypeOnly) {
          violations.push(path.relative(SRC_ROOT, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("has at least one file in the safe barrel's closure with a type-only @playwright/test import (sanity check that this test actually exercises the fragile spot)", () => {
    const reachable = reachableFrom(path.join(SRC_ROOT, "index.ts"));
    const typeOnlyPlaywrightFiles = [...reachable].filter((file) =>
      (filesByAbsolutePath.get(file) ?? []).some(
        (imp) => imp.specifier === PLAYWRIGHT_TEST && imp.isTypeOnly,
      ),
    );
    expect(typeOnlyPlaywrightFiles.length).toBeGreaterThan(0);
  });

  it("never imports @playwright/test (type-only or not) under capture/domain/ -- pure decision logic only", () => {
    const domainRoot = path.join(SRC_ROOT, "capture", "domain");
    const domainFiles = allFiles.filter((file) => file.startsWith(`${domainRoot}${path.sep}`));
    expect(domainFiles.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of domainFiles) {
      for (const imp of filesByAbsolutePath.get(file) ?? []) {
        if (imp.specifier === PLAYWRIGHT_TEST) violations.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("never imports @framelia/cli, @framelia/dashboard-server, or @framelia/playwright from anywhere under src/", () => {
    const violations: string[] = [];
    for (const file of allFiles) {
      for (const imp of filesByAbsolutePath.get(file) ?? []) {
        if (
          BANNED_CONSUMER_PACKAGES.some(
            (pkg) => imp.specifier === pkg || imp.specifier.startsWith(`${pkg}/`),
          )
        ) {
          violations.push(`${path.relative(SRC_ROOT, file)} -> ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
