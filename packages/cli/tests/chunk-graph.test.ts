import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metafilePath = path.join(packageRoot, "dist", "metafile-esm.json");

const HEAVY_PACKAGES = [
  "playwright",
  "@playwright/test",
  "@hono/node-server",
  "@framelia/dashboard-server",
  "@clack/prompts",
];

/** See tests/architecture.test.ts: this entry has no imports of its own. */
const WEIGHTLESS_ENTRIES = new Set(["@framelia/dashboard-server/constants"]);

interface MetafileOutput {
  readonly imports: readonly { path: string; kind: string; external?: boolean }[];
}

interface Metafile {
  readonly outputs: Record<string, MetafileOutput>;
}

/**
 * Every output chunk reachable from `entryOutputPath`. With `splitting: true`
 * esbuild records shared code as a separate chunk the entry pulls in with a
 * plain `import-statement`, so restricting the walk to `dynamic-import` edges
 * would hide whatever those shared chunks import.
 */
function transitiveChunks(metafile: Metafile, entryOutputPath: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entryOutputPath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const output = metafile.outputs[current];
    if (!output) continue;
    for (const imp of output.imports) {
      if (imp.external === true || visited.has(imp.path)) continue;
      if (metafile.outputs[imp.path]) queue.push(imp.path);
    }
  }
  return visited;
}

describe("chunk graph: status does not statically import heavy runtime modules", () => {
  it("every chunk reachable from status excludes Playwright/Hono/dashboard-server/clack", (ctx) => {
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

    const graph = transitiveChunks(metafile, statusChunkImport!.path);
    expect(graph.size).toBeGreaterThan(0);

    for (const chunkPath of graph) {
      const output = metafile.outputs[chunkPath];
      if (!output) continue;
      for (const imp of output.imports) {
        for (const heavyPackage of HEAVY_PACKAGES) {
          const pullsHeavyPackage =
            (imp.path === heavyPackage || imp.path.startsWith(`${heavyPackage}/`)) &&
            !WEIGHTLESS_ENTRIES.has(imp.path);
          expect(
            pullsHeavyPackage,
            `${chunkPath} imports "${imp.path}" -- ${heavyPackage} must not be in status's transitive static import graph`,
          ).toBe(false);
        }
      }
    }
  });
});
