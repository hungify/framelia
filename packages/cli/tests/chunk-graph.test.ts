import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Deterministic verification for the rewrite plan's Architecture §1 ("lazy-load every
 * command") -- inspects the esbuild metafile tsup emits (`tsup.config.ts`'s
 * `metafile: true`) rather than timing a cold start or mocking module loading, per the
 * plan's explicit instruction that a timing/instrumented-subprocess comparison is not
 * sufficient evidence.
 *
 * Requires a fresh `pnpm --filter framelia build` (the metafile is build output, not
 * checked in); skips with a clear message if `dist/metafile-esm.json` is missing rather
 * than failing confusingly.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metafilePath = path.join(packageRoot, "dist", "metafile-esm.json");

// Packages that must never appear in `status`'s transitive static import graph --
// exactly the ones the plan calls out as accidentally-eager today (Playwright,
// @hono/node-server via @framelia/dashboard-server, @clack/prompts).
const HEAVY_PACKAGES = [
  "playwright",
  "@playwright/test",
  "@hono/node-server",
  "@framelia/dashboard-server",
  "@clack/prompts",
];

interface MetafileOutput {
  readonly imports: readonly { path: string; kind: string; external?: boolean }[];
}

interface Metafile {
  readonly outputs: Record<string, MetafileOutput>;
}

function transitiveDynamicImportChunks(metafile: Metafile, entryOutputPath: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entryOutputPath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const output = metafile.outputs[current];
    if (!output) continue;
    for (const imp of output.imports) {
      if (imp.kind === "dynamic-import" && !visited.has(imp.path)) queue.push(imp.path);
    }
  }
  return visited;
}

describe("chunk graph: status does not statically import heavy runtime modules", () => {
  it("status's transitive dynamic-import chunk graph excludes Playwright/Hono/dashboard-server/clack", (ctx) => {
    if (!fs.existsSync(metafilePath)) {
      ctx.skip(
        `${metafilePath} does not exist -- run \`pnpm --filter framelia build\` first (tsup.config.ts's metafile: true emits it).`,
      );
    }
    const metafile = JSON.parse(fs.readFileSync(metafilePath, "utf8")) as Metafile;

    const cliOutputPath = Object.keys(metafile.outputs).find((key) => key.endsWith("/cli.js"));
    expect(cliOutputPath).toBeDefined();
    const cliOutput = metafile.outputs[cliOutputPath as string];

    const statusChunkImport = cliOutput?.imports.find(
      (imp) => imp.kind === "dynamic-import" && /\/status-[^/]+\.js$/.test(imp.path),
    );
    expect(statusChunkImport).toBeDefined();

    const graph = transitiveDynamicImportChunks(metafile, statusChunkImport!.path);
    expect(graph.size).toBeGreaterThan(0);

    for (const chunkPath of graph) {
      const output = metafile.outputs[chunkPath];
      if (!output) continue;
      for (const imp of output.imports) {
        for (const heavyPackage of HEAVY_PACKAGES) {
          expect(
            imp.path === heavyPackage,
            `${chunkPath} imports "${imp.path}" -- ${heavyPackage} must not be in status's transitive static import graph`,
          ).toBe(false);
        }
      }
    }
  });
});
