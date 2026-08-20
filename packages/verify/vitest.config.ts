import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve workspace @framelia/* packages from source, not dist -- tests
    // shouldn't depend on sibling packages having been built first.
    conditions: ["framelia-dev"],
  },
  ssr: {
    resolve: {
      conditions: ["framelia-dev"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Real-network tests live under tests/integration and are opt-in only
    // (see vitest.integration.config.ts / `pnpm test:integration`) -- they
    // need a live FIGMA_ACCESS_TOKEN and must never run in the default
    // `pnpm test` / CI-on-every-PR path.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    testTimeout: 60_000,
  },
});
