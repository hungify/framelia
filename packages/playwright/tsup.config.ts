import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    register: "src/register.ts",
    reporter: "src/reporter.ts",
    "create-matchers": "src/create-matchers.ts",
  },
  format: "esm",
  target: "node22",
  platform: "node",
  external: ["@playwright/test", "@playwright/test/reporter"],
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
});
