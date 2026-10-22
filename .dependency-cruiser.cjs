// @ts-check
// Deep-module enforcement for dependency-cruiser (`pnpm lint:boundaries`).
//
// Each workspace package under packages/ is a DEEP MODULE: a lot of behaviour behind a small
// interface. Its PUBLIC SURFACE is its ENTRY POINTS: the files its package.json `exports` map points
// at (the `framelia-dev` source condition, e.g. src/index.ts, src/run-bundle/index.ts). Every other
// file is private, wherever it sits.
//
// Adapted from the setup-ts-deep-modules skill: there, entry points are a package's root files and
// even a package's own tests may not reach its internals. Here, entry points come from `exports`
// (what consumers can actually import), and a package's own tests may unit-test its internals, as in
// Nx/Turborepo boundaries: the boundary that matters is between packages. packages/README.md has
// the convention.

const fs = require("node:fs");
const path = require("node:path");

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "packages";

const R = PACKAGES_ROOT;
const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every package's entry files, read from its package.json `exports`. */
const ENTRY_POINTS = fs
  .readdirSync(R, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(R, entry.name, "package.json")))
  .flatMap((entry) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(R, entry.name, "package.json"), "utf8"));
    return Object.values(manifest.exports ?? {}).map((target) => {
      const file = typeof target === "string" ? target : (target["framelia-dev"] ?? target.default);
      return `^${escape(path.posix.join(R, entry.name, file))}$`;
    });
  });

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "Code outside packages/ (apps, scripts) may import a package only through its entry points (package.json `exports`), never its internals.",
      severity: "error",
      from: { pathNot: `^${R}/` },
      to: { path: `^${R}/[^/]+/`, pathNot: ENTRY_POINTS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files (tests included) import each other freely, but reach OTHER packages only through their entry points (package.json `exports`).",
      severity: "error",
      from: { path: `^${R}/([^/]+)/` },
      to: { path: `^${R}/[^/]+/`, pathNot: [`^${R}/$1/`, ...ENTRY_POINTS] },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests: production code never imports fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` },
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles, type-only imports included.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Layering ---------------------------------------------------------------------------------
    // Interface-hiding controls HOW you import (through the entry points). WHICH packages may depend
    // on which (contracts -> verify -> dashboard-server -> playwright / cli) is pinned by the
    // packages' own tests: contracts `check:zero-deps`, verify `architecture-boundary.test.ts`, cli
    // `architecture.test.ts`. See .agents/rules/package-boundaries.md.
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.stryker-tmp|test-results)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".mjs", ".vue", ".json"],
      // dependency-cruiser ignores package.json `exports` unless told to; workspace packages
      // resolve to source through the `framelia-dev` condition, as in tsconfig and vitest.
      exportsFields: ["exports"],
      conditionNames: ["framelia-dev", "import", "types", "default"],
    },
  },
};
