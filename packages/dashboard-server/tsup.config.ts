import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", constants: "src/constants.ts" },
  format: "esm",
  target: "node22",
  platform: "node",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  // Never clean: `dist/dashboard` is the Vue client build, built separately
  // (see package.json `build`) and must survive this package's own TS build.
  clean: false,
});
