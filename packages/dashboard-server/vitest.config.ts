import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: [...defaultClientConditions, "framelia-dev"],
  },
  ssr: {
    resolve: {
      conditions: [...defaultServerConditions, "framelia-dev"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
