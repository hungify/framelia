import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: "esm",
  target: "node22",
  platform: "node",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  // Every commands/*.ts declaration lazy-loads its internal/*.ts implementation via
  // Stricli's `loader` form (see the rewrite plan's "Startup: lazy-load every command"
  // section); splitting lets tsup emit those as separate chunks instead of inlining
  // everything into cli.js, so e.g. `framelia status` doesn't pay Playwright's load cost.
  splitting: true,
  metafile: true,
});
