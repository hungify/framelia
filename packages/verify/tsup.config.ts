import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", internal: "src/internal.ts" },
  format: "esm",
  target: "node22",
  platform: "node",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
});
