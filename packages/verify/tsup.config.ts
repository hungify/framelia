import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    internal: "src/internal.ts",
    cli: "src/cli.ts",
    env: "src/load-env.ts",
    testing: "src/testing.ts",
  },
  format: "esm",
  target: "node22",
  platform: "node",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
});
