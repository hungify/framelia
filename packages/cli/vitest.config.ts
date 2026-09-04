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
    // Tests that spawn the real bin assert human-facing banner/help text as plain
    // strings, and a spawned child inherits this process's env. picocolors enables
    // color whenever `CI` is set -- with no TTY required -- so without pinning this
    // the same assertion passes on a dev machine and fails on GitHub Actions, where
    // the asserted text arrives shot through with SGR escapes. `NO_COLOR` is the
    // standard opt-out and picocolors honors it, so pin it here (rather than
    // ANSI-stripping in each test) to keep spawned output byte-stable everywhere.
    env: { NO_COLOR: "1" },
  },
});
