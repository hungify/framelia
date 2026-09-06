import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
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
    env: { NO_COLOR: "1" },
  },
});
