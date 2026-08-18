import { defineConfig } from "vitest/config";

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
    testTimeout: 60_000,
  },
});
