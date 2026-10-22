import config from "./stryker.config.mjs";

// Run from packages/contracts (`pnpm test:mutation:smoke`). Fails when the runner stops running tests
// per mutant (every mutant then "survives", e.g. after a Vitest or Stryker upgrade); this file's
// mutants are all but one detected today.
export default {
  ...config,
  mutate: ["src/paths.ts"],
  reporters: ["clear-text"],
  thresholds: { ...config.thresholds, break: 50 },
};
