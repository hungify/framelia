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
 * Every output chunk reachable from `startPath`. With `splitting: true`
 * esbuild records shared code as a separate chunk the entry pulls in with a
 * plain `import-statement`, so restricting the walk to `dynamic-import` edges
 * would hide whatever those shared chunks import. `staticOnly` skips the
 * `dynamic-import` edges: what loads before any command loader runs.
 */
function transitiveChunks(
  metafile: Metafile,
  startPath: string,
  options: { readonly staticOnly?: boolean } = {},
): Set<string> {
  const visited = new Set<string>();
  const queue = [startPath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const output = metafile.outputs[current];
    if (!output) continue;
    for (const imp of output.imports) {
      if (imp.external === true || visited.has(imp.path)) continue;
      if (options.staticOnly === true && imp.kind === "dynamic-import") continue;
      if (metafile.outputs[imp.path]) queue.push(imp.path);
    }
  }
  return visited;
}

function readMetafile(ctx: { skip: (note: string) => void }): Metafile {
  if (!fs.existsSync(metafilePath)) {
    ctx.skip(
      `${metafilePath} does not exist -- run \`pnpm --filter framelia build\` first (tsup.config.ts's metafile: true emits it).`,
    );
  }
  return JSON.parse(fs.readFileSync(metafilePath, "utf8")) as Metafile;
}

function entryOutputPath(metafile: Metafile, fileName: string): string {
  const outputPath = Object.keys(metafile.outputs).find((key) => key.endsWith(`/${fileName}`));
  expect(outputPath, `${fileName} is a build entry`).toBeDefined();
  return outputPath as string;
}

/** `chunk imports "specifier"` for every import of a forbidden package in `graph`. */
function forbiddenImports(
  metafile: Metafile,
  graph: Iterable<string>,
  forbidden: readonly string[],
): string[] {
  return [...graph].flatMap((chunkPath) =>
    (metafile.outputs[chunkPath]?.imports ?? [])
      .filter(
        (imp) =>
          !WEIGHTLESS_ENTRIES.has(imp.path) &&
          forbidden.some((pkg) => imp.path === pkg || imp.path.startsWith(`${pkg}/`)),
      )
      .map((imp) => `${chunkPath} imports "${imp.path}"`),
  );
}

describe("chunk graph: status does not statically import heavy runtime modules", () => {
  it("every chunk reachable from status excludes Playwright/Hono/dashboard-server/clack", (ctx) => {
    const metafile = readMetafile(ctx);
    const cliGraph = transitiveChunks(metafile, entryOutputPath(metafile, "cli.js"), {
      staticOnly: true,
    });

    // The route tree may live in a chunk shared with bash-complete.js, not in cli.js itself.
    const statusChunkImport = [...cliGraph]
      .flatMap((chunkPath) => metafile.outputs[chunkPath]?.imports ?? [])
      .find((imp) => imp.kind === "dynamic-import" && /\/status-[^/]+\.js$/.test(imp.path));
    expect(statusChunkImport).toBeDefined();

    const graph = transitiveChunks(metafile, statusChunkImport!.path);
    expect(graph.size).toBeGreaterThan(0);
    expect(
      forbiddenImports(metafile, graph, HEAVY_PACKAGES),
      "heavy packages must not be in status's transitive static import graph",
    ).toEqual([]);
  });
});

describe("chunk graph: bash completion entry stays light", () => {
  it("loads no heavy runtime, .env loader, or completion installer before a command runs", (ctx) => {
    const metafile = readMetafile(ctx);
    const graph = transitiveChunks(metafile, entryOutputPath(metafile, "bash-complete.js"), {
      staticOnly: true,
    });

    expect(
      forbiddenImports(metafile, graph, [
        ...HEAVY_PACKAGES,
        "@framelia/verify/env",
        "@stricli/auto-complete",
      ]),
      "__framelia_bash_complete runs on every <TAB>; it must only build the route tree",
    ).toEqual([]);
  });
});
