// Shared by every workspace package: each runs `stryker run ../../stryker.config.mjs` from its own
// directory (`pnpm --filter <pkg> test:mutation`), so the globs below are package-relative and the
// package's own vitest.config.ts is picked up.
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/**/*.ts",
    // apps/dashboard keeps its logic at the package root, not under src/.
    "lib/**/*.ts",
    "composables/**/*.ts",
    "!**/*.d.ts",
    "!**/*.test.ts",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incrementalFile: "reports/mutation/stryker-incremental.json",
  thresholds: { high: 90, low: 60, break: null },
  ignorePatterns: [".agents", ".claude", ".framelia", "test-results", "reports", ".env*"],
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
