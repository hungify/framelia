import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.*",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["./consumer-reporter.ts"], ["json", { outputFile: "playwright-report.json" }]],
  use: {
    viewport: { width: 160, height: 120 },
  },
});
