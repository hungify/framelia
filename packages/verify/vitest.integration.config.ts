import { defineConfig } from "vitest/config";

// Real-network tests only. Requires FIGMA_ACCESS_TOKEN to actually assert
// anything -- without it, tests inside tests/integration self-skip via
// `describe.runIf(Boolean(token))`. Run with `pnpm test:integration`.
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
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Must exceed HTTP_REQUEST_TIMEOUT_MS (30s, see src/constants.ts) so the
    // fetch's own AbortSignal.timeout always fires first, giving a real HTTP
    // error instead of racing vitest's own test-level timeout. The real
    // fetch happens in beforeAll, so hookTimeout needs the same headroom.
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
